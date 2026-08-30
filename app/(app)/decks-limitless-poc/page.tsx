'use client';

/**
 * TEMPORÄRE PoC-Seite (nicht in der Navigation). Zieht eine echte Limitless-
 * Turnier-Siegerliste (über /api/decks/limitless) und löst sie mit unserem
 * bestehenden resolvePtcglDeck gegen den Katalog auf — zeigt die Trefferquote
 * und die nicht auflösbaren Zeilen. Dient nur der Machbarkeitsprüfung, ob echte
 * Decklisten-Daten sauber auf tcg_catalog mappen. Kann danach gelöscht werden.
 */
import { useState } from 'react';
import { resolvePtcglDeck, type PtcglResolveResult } from '@/lib/decks/ptcgl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ApiResp {
  tournament: { id: string; name: string; date?: string; players?: number; format?: string };
  player: { name: string; placing: number };
  structured: { pokemon: Card[]; trainer: Card[]; energy: Card[] };
  totalCards: number;
  ptcglText: string;
  error?: string;
}
interface Card { count: number; set?: string; number?: string; name: string }

export default function LimitlessPocPage() {
  const [id, setId] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [meta, setMeta] = useState<ApiResp | null>(null);
  const [result, setResult] = useState<PtcglResolveResult | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true); setError(''); setResult(null); setMeta(null);
    try {
      setStatus('Hole Turnier-Deckliste von Limitless …');
      const res = await fetch(`/api/decks/limitless${id.trim() ? `?id=${encodeURIComponent(id.trim())}` : ''}`);
      const data: ApiResp = await res.json();
      if (!res.ok || data.error) { setError(data.error || `Fehler ${res.status}`); return; }
      setMeta(data);
      setStatus('Löse Karten gegen tcg_catalog auf …');
      const r = await resolvePtcglDeck(data.ptcglText);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally { setLoading(false); setStatus(''); }
  };

  const resolvedCards = result?.resolved.reduce((s, c) => s + c.count, 0) ?? 0;
  const unresolvedCards = result?.unresolved.reduce((s, c) => s + c.count, 0) ?? 0;
  const totalLines = (result ? result.resolved.length + result.unresolved.length : 0);
  const hitByCards = meta?.totalCards ? Math.round((resolvedCards / meta.totalCards) * 100) : 0;
  const hitByLines = totalLines ? Math.round((result!.resolved.length / totalLines) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto">
      <div className="glass rounded-2xl p-4 flex flex-col gap-3">
        <h1 className="text-lg font-bold">Limitless-Deckliste → Katalog (PoC)</h1>
        <p className="text-role-label text-muted-foreground">
          Zieht die Siegerliste eines Standard-Turniers von der Limitless-Platform-API und misst,
          wie viele Karten sich gegen unseren Katalog auflösen lassen. Turnier-ID optional
          (leer = neuestes passendes Turnier).
        </p>
        <div className="flex gap-2">
          <Input value={id} onChange={setId} placeholder="Turnier-ID (optional)" />
          <Button variant="primary" accentColor="#3182ce" onClick={run} disabled={loading}>
            {loading ? '…' : 'Laden & auflösen'}
          </Button>
        </div>
        {loading && <p className="text-role-label text-muted-foreground">{status}</p>}
        {error && <p className="text-role-label" style={{ color: '#c53030' }}>{error}</p>}
      </div>

      {meta && (
        <div className="glass rounded-2xl p-4 flex flex-col gap-1">
          <span className="font-semibold">{meta.tournament.name}</span>
          <span className="text-role-label text-muted-foreground">
            {meta.tournament.format} · {meta.tournament.players ?? '?'} Spieler
            {meta.tournament.date ? ` · ${new Date(meta.tournament.date).toLocaleDateString('de')}` : ''}
          </span>
          <span className="text-role-label text-muted-foreground">
            Sieger: {meta.player.name} · {meta.totalCards} Karten
          </span>
          <span className="text-role-label text-muted-foreground break-all">ID: {meta.tournament.id}</span>
        </div>
      )}

      {result && (
        <>
          <div className="glass rounded-2xl p-4 flex items-center justify-around text-center">
            <div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: hitByCards >= 90 ? '#2f855a' : hitByCards >= 70 ? '#b7791f' : '#c53030' }}>{hitByCards}%</div>
              <div className="text-role-label text-muted-foreground">Karten<br />{resolvedCards}/{meta?.totalCards}</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{hitByLines}%</div>
              <div className="text-role-label text-muted-foreground">Zeilen<br />{result.resolved.length}/{totalLines}</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: unresolvedCards ? '#c53030' : '#2f855a' }}>{unresolvedCards}</div>
              <div className="text-role-label text-muted-foreground">fehlende<br />Karten</div>
            </div>
          </div>

          {result.unresolved.length > 0 && (
            <div className="glass rounded-2xl p-4 flex flex-col gap-1">
              <span className="font-semibold" style={{ color: '#c53030' }}>Nicht aufgelöst ({result.unresolved.length})</span>
              {result.unresolved.map((u, i) => (
                <div key={i} className="text-role-label flex justify-between gap-2">
                  <span className="truncate">{u.raw}</span>
                  <span className="text-muted-foreground shrink-0">{u.reason}</span>
                </div>
              ))}
            </div>
          )}

          <div className="glass rounded-2xl p-4 flex flex-col gap-1">
            <span className="font-semibold">Aufgelöst ({result.resolved.length})</span>
            {result.resolved.map((r) => (
              <div key={r.card.id} className="text-role-label flex justify-between gap-2">
                <span className="truncate">{r.count}× {r.card.nameDe ?? r.card.name}</span>
                <span className="text-muted-foreground shrink-0">{r.card.setCode} {r.card.number}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
