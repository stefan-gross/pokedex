'use client';

import { useState, useMemo } from 'react';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { deckToPtcglCode, resolvePtcglDeck, type PtcglResolveResult } from '@/lib/decks/ptcgl';
import type { CatalogCard } from '@/lib/firestore/catalog';
import type { DeckCardRef } from '@/types';

/**
 * Import/Export im Pokémon-TCG-Live-Format. `mode`:
 *  - 'export': zeigt den generierten Deckcode (kopierbar).
 *  - 'import': Textfeld → „Analysieren" (resolvePtcglDeck) → aufgelöste +
 *    nicht gefundene Zeilen sichtbar → „Karten übernehmen" (merge/add).
 */
export function DeckCodeSheet({ open, onClose, mode, cards, byId, onImport }: {
  open: boolean;
  onClose: () => void;
  mode: 'export' | 'import';
  cards: DeckCardRef[];
  byId: Map<string, CatalogCard>;
  /** Import: aufgelöste Karten ins Deck übernehmen (merge/add). */
  onImport: (resolved: { card: CatalogCard; count: number }[]) => Promise<void>;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={mode === 'export' ? 'Als Code exportieren' : 'Code importieren'} dragToClose elevated>
      {mode === 'export'
        ? <ExportView cards={cards} byId={byId} />
        : <ImportView onImport={onImport} onClose={onClose} />}
    </Sheet>
  );
}

function ExportView({ cards, byId }: { cards: DeckCardRef[]; byId: Map<string, CatalogCard> }) {
  const code = useMemo(() => deckToPtcglCode(cards, byId), [cards, byId]);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch (e) { console.error('[deck] copy error', e); }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-role-label text-glass-muted px-1">Kompatibel mit Pokémon TCG Live (Import per „Deck importieren").</p>
      <textarea
        readOnly
        value={code}
        className="w-full h-64 rounded-2xl glass-inner p-3 text-role-label font-mono text-glass resize-none"
        onFocus={e => e.currentTarget.select()}
      />
      <Button variant="secondary" size="lg" onClick={copy} icon={copied ? <Check size={18} /> : <Copy size={18} />} className="w-full">
        {copied ? 'Kopiert' : 'Code kopieren'}
      </Button>
    </div>
  );
}

function ImportView({ onImport, onClose }: {
  onImport: (resolved: { card: CatalogCard; count: number }[]) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<PtcglResolveResult | null>(null);

  const analyze = async () => {
    if (!text.trim() || analyzing) return;
    setAnalyzing(true);
    try { setResult(await resolvePtcglDeck(text)); }
    catch (e) { console.error('[deck] analyze error', e); }
    finally { setAnalyzing(false); }
  };

  const apply = async () => {
    if (!result || importing) return;
    setImporting(true);
    try { await onImport(result.resolved); onClose(); }
    catch (e) { console.error('[deck] import error', e); }
    finally { setImporting(false); }
  };

  const resolvedTotal = result?.resolved.reduce((s, r) => s + r.count, 0) ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {!result ? (
        <>
          <p className="text-role-label text-glass-muted px-1">Deckliste aus Pokémon TCG Live einfügen.</p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'Pokémon: 6\n3 Charizard ex PAF 54\n…'}
            className="w-full h-56 rounded-2xl glass-inner p-3 text-role-label font-mono text-glass resize-none"
            autoFocus
          />
          <Button variant="primary" accentColor="#3182ce" size="lg" onClick={analyze} disabled={!text.trim() || analyzing} className="w-full">
            {analyzing ? 'Analysiere …' : 'Analysieren'}
          </Button>
        </>
      ) : (
        <>
          <div className="rounded-2xl px-4 py-3 text-sm font-semibold" style={{ background: 'rgba(47,133,90,0.12)', color: '#2f855a' }}>
            {result.resolved.length} Karten erkannt ({resolvedTotal} Exemplare)
          </div>

          {result.resolved.length > 0 && (
            <div className="flex flex-col gap-1 max-h-48 overflow-auto" data-scroll-lock-allow>
              {result.resolved.map(r => (
                <div key={r.card.id} className="flex items-center gap-2 text-role-label">
                  <span className="w-6 text-right font-bold tabular-nums shrink-0">{r.count}×</span>
                  <span className="truncate text-glass">{r.card.nameDe ?? r.card.name}</span>
                  <span className="text-glass-muted shrink-0 ml-auto">{r.card.setCode ?? r.card.setId} {r.card.number}</span>
                </div>
              ))}
            </div>
          )}

          {result.unresolved.length > 0 && (
            <div className="rounded-2xl px-3 py-2.5 flex flex-col gap-1" style={{ background: 'rgba(183,121,31,0.12)' }}>
              <span className="flex items-center gap-1.5 text-role-label font-semibold" style={{ color: '#b7791f' }}>
                <AlertTriangle size={14} /> {result.unresolved.length} nicht gefunden
              </span>
              {result.unresolved.map((u, i) => (
                <span key={i} className="text-role-label truncate" style={{ color: '#b7791f' }}>{u.raw} — {u.reason}</span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="ghost" size="lg" onClick={() => setResult(null)} className="flex-1">Zurück</Button>
            <Button variant="primary" accentColor="#2f855a" size="lg" onClick={apply} disabled={importing || result.resolved.length === 0} className="flex-1">
              {importing ? 'Übernehme …' : 'Karten übernehmen'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
