'use client';

/**
 * TEMPORÄRE Seite zur Verifikation der Archetyp-Datenschicht (nicht in der Nav).
 * • „Sync jetzt" ruft /api/admin/sync-archetypes (Admin) → füllt deck_archetypes.
 * • Liste zeigt die gespeicherten Archetypen (Popularität, beste Platzierung, Typen).
 * • Klick auf einen Archetyp löst dessen Deckliste gegen den Katalog auf
 *   (resolvePtcglDeck) und zeigt die Trefferquote. Später entfernbar.
 */
import { useEffect, useState } from 'react';
import { getArchetypes } from '@/lib/firestore/archetypes';
import type { ArchetypeDeck } from '@/lib/decks/archetypes';
import { decklistToPtcglText } from '@/lib/decks/limitless';
import { resolvePtcglDeck, type PtcglResolveResult } from '@/lib/decks/ptcgl';
import { EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';
import { Button } from '@/components/ui/button';

export default function ArchetypesPocPage() {
  const [list, setList] = useState<ArchetypeDeck[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState<ArchetypeDeck | null>(null);
  const [resolved, setResolved] = useState<PtcglResolveResult | null>(null);
  const [resolving, setResolving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setList(await getArchetypes({ format: 'STANDARD' })); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Laden fehlgeschlagen'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const sync = async () => {
    setSyncing(true); setMsg('Sync läuft (Limitless → deck_archetypes) …');
    try {
      const r = await fetch('/api/admin/sync-archetypes?limit=25&top=16&min=16');
      const data = await r.json();
      if (!r.ok) { setMsg(`Fehler ${r.status}: ${data.error ?? ''}`); return; }
      setMsg(`Fertig: ${data.tournamentsScanned} Turniere · ${data.decklistsCollected} Decklisten · ${data.archetypes} Archetypen`);
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Sync fehlgeschlagen'); }
    finally { setSyncing(false); }
  };

  const openArchetype = async (a: ArchetypeDeck) => {
    setSel(a); setResolved(null); setResolving(true);
    try { setResolved(await resolvePtcglDeck(decklistToPtcglText(a.decklist))); }
    finally { setResolving(false); }
  };

  const resolvedCards = resolved?.resolved.reduce((s, c) => s + c.count, 0) ?? 0;
  const hit = sel?.totalCards ? Math.round((resolvedCards / sel.totalCards) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto">
      <div className="glass rounded-2xl p-4 flex flex-col gap-3">
        <h1 className="text-lg font-bold">Turnier-Archetypen (Datenschicht)</h1>
        <p className="text-role-label text-muted-foreground">
          Sync zieht neueste Standard-Turniere von Limitless, clustert Top-Decklisten zu Archetypen und
          speichert sie in <code>deck_archetypes</code>. Klick auf einen Archetyp löst dessen Liste gegen den Katalog auf.
        </p>
        <Button variant="primary" accentColor="#3182ce" onClick={sync} disabled={syncing}>
          {syncing ? 'Sync läuft …' : 'Sync jetzt'}
        </Button>
        {msg && <p className="text-role-label text-muted-foreground">{msg}</p>}
      </div>

      <div className="glass rounded-2xl p-4 flex flex-col gap-2">
        <span className="font-semibold">Archetypen ({list.length})</span>
        {loading && <span className="text-role-label text-muted-foreground">lädt …</span>}
        {!loading && list.length === 0 && <span className="text-role-label text-muted-foreground">Noch keine — „Sync jetzt" klicken.</span>}
        {list.map(a => (
          <button key={a.id} onClick={() => openArchetype(a)}
            className={`flex items-center gap-2 rounded-xl px-2 py-1.5 text-left ${sel?.id === a.id ? 'glass-inner' : ''}`}>
            <span className="flex gap-0.5 shrink-0">
              {a.types.slice(0, 2).map(t => <EnergyIcon key={t} type={t as EnergyType} size={16} />)}
            </span>
            <span className="flex-1 truncate text-sm font-semibold">{a.name}</span>
            <span className="text-role-label text-muted-foreground shrink-0 tabular-nums">×{a.popularity} · #{a.bestPlacing}</span>
          </button>
        ))}
      </div>

      {sel && (
        <div className="glass rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{sel.name}</span>
            {resolving
              ? <span className="text-role-label text-muted-foreground">löst auf …</span>
              : <span className="text-lg font-bold tabular-nums" style={{ color: hit >= 90 ? '#2f855a' : hit >= 70 ? '#b7791f' : '#c53030' }}>{hit}%</span>}
          </div>
          <span className="text-role-label text-muted-foreground">
            {sel.totalCards} Karten · {sel.types.join('/') || '—'} · Quelle: {sel.source.player} @ {sel.source.tournamentName} (#{sel.source.placing})
          </span>
          {resolved && resolved.unresolved.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-role-label font-semibold" style={{ color: '#c53030' }}>Nicht aufgelöst ({resolved.unresolved.length})</span>
              {resolved.unresolved.map((u, i) => <span key={i} className="text-role-label text-muted-foreground truncate">{u.raw} — {u.reason}</span>)}
            </div>
          )}
          {resolved && (
            <div className="flex flex-col gap-0.5">
              {resolved.resolved.map(r => (
                <div key={r.card.id} className="text-role-label flex justify-between gap-2">
                  <span className="truncate">{r.count}× {r.card.nameDe ?? r.card.name}</span>
                  <span className="text-muted-foreground shrink-0">{r.card.setCode} {r.card.number}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
