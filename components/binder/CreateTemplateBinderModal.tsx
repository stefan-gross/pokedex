'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Search, BookOpen, Repeat2, Package, ChevronLeft } from 'lucide-react';
import { getAllSets, filterSets, type TcgSet } from '@/lib/firestore/sets';
import { SERIES_NAMES_DE } from '@/lib/card-constants';
import { searchCatalog, type CatalogCard } from '@/lib/firestore/catalog';
import { CardImage } from '@/components/card/CardImage';
import { getEvolutionFamilyDexNumbers } from '@/lib/pokeapi';
import {
  resolveMasterSetTemplate, resolvePokedexTemplate, resolvePokemonTemplate,
} from '@/lib/template-binders/resolve';
import { CreateBinderModal } from './CreateBinderModal';
import type { BinderTemplate } from '@/types';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

/** Vorbereitetes Ergebnis, mit dem `CreateBinderModal` aufgerufen wird —
 *  gemeinsamer Konvergenzpunkt für alle drei Vorlagen-Typen unten. */
interface ReadyTemplate {
  template: BinderTemplate;
  initialName: string;
  initialIcon?: string;
  initialColor?: string;
}

type Kind = 'choose' | 'masterSet' | 'pokedex' | 'pokemon';

/** Einstieg für Vorlagen-Binder: Pokédex, Evolutionslinie und Master-Set
 *  (Illustrator nutzt bereits denselben Sync-/Sperren-/Hinweis-Mechanismus,
 *  lib/template-binders/*, bekommt aber vorerst keine eigene Erstellungs-UI
 *  — bleibt bewusst ein separater, späterer Schritt). Nach der jeweiligen
 *  Parameter-Auswahl übergibt dieser Screen an das bestehende
 *  `CreateBinderModal` (Name/Icon/Farbe/Größe bleiben dort wie gewohnt
 *  änderbar, bevor der Binder tatsächlich angelegt wird). */
export function CreateTemplateBinderModal({ onClose, onSaved }: Props) {
  const [kind, setKind] = useState<Kind>('choose');
  const [ready, setReady] = useState<ReadyTemplate | null>(null);

  // ── Master-Set ───────────────────────────────────────────────────────
  const [setQuery, setSetQuery] = useState('');
  const [allSets, setAllSets] = useState<TcgSet[]>([]);
  const [selectedSet, setSelectedSet] = useState<TcgSet | null>(null);
  const [masterSlotCount, setMasterSlotCount] = useState<number | null>(null);
  const [masterLoading, setMasterLoading] = useState(false);
  const setsLoadedRef = useRef(false);

  useEffect(() => {
    if (kind !== 'masterSet' || setsLoadedRef.current) return;
    setsLoadedRef.current = true;
    getAllSets().then(setAllSets).catch(() => {});
  }, [kind]);

  const filteredSets = useMemo(() => filterSets(allSets, setQuery).slice(0, 15), [allSets, setQuery]);

  async function pickSet(s: TcgSet) {
    setSelectedSet(s);
    setMasterSlotCount(null);
    setMasterLoading(true);
    try {
      const slots = await resolveMasterSetTemplate(s.id);
      setMasterSlotCount(slots.length);
    } finally {
      setMasterLoading(false);
    }
  }

  function confirmMasterSet() {
    if (!selectedSet) return;
    setReady({
      template: { type: 'masterSet', setId: selectedSet.id },
      initialName: selectedSet.nameDe ?? selectedSet.name,
      initialIcon: `set:${selectedSet.id}`,
      initialColor: '#4299e1',
    });
  }

  // ── Pokédex ───────────────────────────────────────────────────────────
  const [pokedexSlotCount, setPokedexSlotCount] = useState<number | null>(null);
  const [pokedexLoading, setPokedexLoading] = useState(false);
  const pokedexLoadedRef = useRef(false);

  useEffect(() => {
    if (kind !== 'pokedex' || pokedexLoadedRef.current) return;
    pokedexLoadedRef.current = true;
    setPokedexLoading(true);
    resolvePokedexTemplate()
      .then(slots => setPokedexSlotCount(slots.length))
      .finally(() => setPokedexLoading(false));
  }, [kind]);

  function confirmPokedex() {
    setReady({
      template: { type: 'pokedex' },
      initialName: 'Pokédex',
      initialColor: '#e53e3e',
    });
  }

  // ── Pokémon (optional inkl. Entwicklungslinie) ───────────────────────
  const [evoQuery, setEvoQuery] = useState('');
  const [evoResults, setEvoResults] = useState<CatalogCard[]>([]);
  const [evoSearching, setEvoSearching] = useState(false);
  const [evoPicked, setEvoPicked] = useState<{ dexNumber: number; name: string } | null>(null);
  const [includeFamily, setIncludeFamily] = useState(false);
  const [evoDexNumbers, setEvoDexNumbers] = useState<number[] | null>(null);
  const [evoSlotCount, setEvoSlotCount] = useState<number | null>(null);
  const [evoResolving, setEvoResolving] = useState(false);
  const evoDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (kind !== 'pokemon') return;
    if (evoDebounceRef.current) clearTimeout(evoDebounceRef.current);
    if (evoQuery.trim().length < 2) { setEvoResults([]); return; }
    evoDebounceRef.current = setTimeout(async () => {
      setEvoSearching(true);
      try {
        const hits = await searchCatalog(evoQuery.trim(), '', 60);
        // Nur Pokémon-Karten (haben eine Dex-Nummer), pro Dex-Nummer nur ein
        // Treffer in der Auswahlliste.
        const byDex = new Map<number, CatalogCard>();
        for (const c of hits) {
          if (c.nationalDexNumber != null && !byDex.has(c.nationalDexNumber)) byDex.set(c.nationalDexNumber, c);
        }
        setEvoResults([...byDex.values()].sort((a, b) => (a.nationalDexNumber! - b.nationalDexNumber!)));
      } finally {
        setEvoSearching(false);
      }
    }, 350);
    return () => { if (evoDebounceRef.current) clearTimeout(evoDebounceRef.current); };
  }, [evoQuery, kind]);

  // Löst die Kachel-/Slot-Anzahl für die aktuelle Auswahl auf — läuft sowohl
  // direkt nach dem Antippen eines Treffers als auch erneut, wenn die
  // "Entwicklungslinie einschließen"-Checkbox umgeschaltet wird.
  async function resolveFor(dexNumber: number, withFamily: boolean) {
    setEvoResolving(true);
    try {
      const dexNumbers = withFamily ? await getEvolutionFamilyDexNumbers(dexNumber) : [dexNumber];
      const slots = await resolvePokemonTemplate(dexNumbers);
      setEvoDexNumbers(dexNumbers);
      setEvoSlotCount(slots.length);
    } finally {
      setEvoResolving(false);
    }
  }

  async function pickEvoCandidate(c: CatalogCard) {
    if (c.nationalDexNumber == null) return;
    setEvoPicked({ dexNumber: c.nationalDexNumber, name: c.nameDe ?? c.name });
    await resolveFor(c.nationalDexNumber, includeFamily);
  }

  async function toggleIncludeFamily() {
    const next = !includeFamily;
    setIncludeFamily(next);
    if (evoPicked) await resolveFor(evoPicked.dexNumber, next);
  }

  function confirmPokemon() {
    if (!evoPicked || !evoDexNumbers) return;
    setReady({
      template: { type: 'pokemon', dexNumbers: evoDexNumbers },
      initialName: includeFamily ? `${evoPicked.name}-Linie` : evoPicked.name,
      initialColor: '#48bb78',
    });
  }

  // ── Konvergenzpunkt: sobald ein Typ konfiguriert ist, übernimmt das
  //    bestehende CreateBinderModal (Name/Icon/Farbe/Größe editierbar). ──
  if (ready) {
    return (
      <CreateBinderModal
        templateDraft={ready.template}
        initialName={ready.initialName}
        initialIcon={ready.initialIcon}
        initialColor={ready.initialColor}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }

  const titles: Record<Kind, string> = {
    choose: 'Vorlage wählen',
    masterSet: 'Master-Set anlegen',
    pokedex: 'Pokédex anlegen',
    pokemon: 'Pokémon anlegen',
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      <div className="absolute inset-0 transition-opacity duration-[250ms] glass-sheet-backdrop" onClick={onClose} />
      <div className="relative w-full rounded-t-2xl glass-sheet max-h-[85dvh] flex flex-col">
        <div className="w-9 h-1 rounded-full bg-[rgba(46,46,50,0.2)] dark:bg-white/30 mx-auto mt-3 mb-1 shrink-0" />
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-1">
              {kind !== 'choose' && (
                <button
                  onClick={() => { setKind('choose'); setSelectedSet(null); setMasterSlotCount(null); setEvoPicked(null); setEvoDexNumbers(null); setEvoSlotCount(null); setIncludeFamily(false); }}
                  className="w-9 h-9 -ml-1.5 rounded-full glass-inner flex items-center justify-center"
                  aria-label="Zurück"
                >
                  <ChevronLeft size={18} />
                </button>
              )}
              <h2 className="font-semibold">{titles[kind]}</h2>
            </div>
            <button onClick={onClose} className="w-11 h-11 rounded-full glass-inner flex items-center justify-center" aria-label="Schließen">
              <X size={20} />
            </button>
          </div>

          {kind === 'choose' && (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setKind('pokedex')}
                className="flex items-center gap-3 px-4 py-3 rounded-xl glass-inner text-left"
              >
                <BookOpen size={20} className="text-glass-muted shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Pokédex</p>
                  <p className="text-xs text-muted-foreground">Alle ~1025 Pokémon, eine Kachel pro Nummer</p>
                </div>
              </button>
              <button
                onClick={() => setKind('pokemon')}
                className="flex items-center gap-3 px-4 py-3 rounded-xl glass-inner text-left"
              >
                <Repeat2 size={20} className="text-glass-muted shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Pokémon</p>
                  <p className="text-xs text-muted-foreground">Alle Karten eines Pokémon, optional inkl. Entwicklungslinie</p>
                </div>
              </button>
              <button
                onClick={() => setKind('masterSet')}
                className="flex items-center gap-3 px-4 py-3 rounded-xl glass-inner text-left"
              >
                <Package size={20} className="text-glass-muted shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Master-Set</p>
                  <p className="text-xs text-muted-foreground">Alle Karten einer Erweiterung, eine Kachel pro Nummer</p>
                </div>
              </button>
            </div>
          )}

          {kind === 'masterSet' && (
            selectedSet ? (
              <div className="text-center py-6">
                <p className="text-sm font-semibold mb-1">{selectedSet.nameDe ?? selectedSet.name}</p>
                <p className="text-xs text-muted-foreground mb-4">
                  {masterLoading ? 'Ermittle Kartenanzahl…' : `${masterSlotCount} Slots`}
                </p>
                {!masterLoading && (
                  <button
                    onClick={confirmMasterSet}
                    className="h-11 px-6 rounded-full text-sm font-semibold text-white"
                    style={{ background: 'var(--action-add)' }}
                  >
                    Weiter
                  </button>
                )}
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-3">
                  Wähle eine Erweiterung — der Binder füllt sich automatisch mit
                  allen Karten (vorhandene + fehlende), eine Kachel pro Nummer.
                </p>
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    type="search"
                    value={setQuery}
                    onChange={e => setSetQuery(e.target.value)}
                    placeholder="Name oder Kürzel (z.B. PAF)"
                    className="w-full h-9 pl-7 pr-3 rounded-lg glass-inner text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                  />
                </div>
                {allSets.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">Lade Sets…</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {filteredSets.map(s => (
                      <button
                        key={s.id}
                        onClick={() => pickSet(s)}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg glass-inner text-left"
                      >
                        <div className="w-14 shrink-0 flex items-center justify-center">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={s.logoUrl ?? `https://images.pokemontcg.io/${s.id}/logo.png`}
                            alt={s.id}
                            className="max-h-7 max-w-[56px] object-contain"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate">{s.nameDe ?? s.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{SERIES_NAMES_DE[s.series] ?? s.series}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )
          )}

          {kind === 'pokedex' && (
            <div className="text-center py-6">
              <p className="text-xs text-muted-foreground mb-4">
                {pokedexLoading
                  ? 'Ermittle Kartenanzahl…'
                  : `${pokedexSlotCount} Dex-Nummern mit synchronisierten Katalogkarten (bevorzugt deutsche Drucke, fehlende werden als Platzhalter angezeigt).`}
              </p>
              {!pokedexLoading && (
                <button
                  onClick={confirmPokedex}
                  className="h-11 px-6 rounded-full text-sm font-semibold text-white"
                  style={{ background: 'var(--action-add)' }}
                >
                  Weiter
                </button>
              )}
            </div>
          )}

          {kind === 'pokemon' && (
            evoPicked ? (
              <div className="text-center py-6">
                <p className="text-sm font-semibold mb-1">{evoPicked.name}</p>
                <label className="flex items-center justify-center gap-2 mb-3 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeFamily}
                    onChange={toggleIncludeFamily}
                    className="w-4 h-4 accent-[var(--action-add)]"
                  />
                  Entwicklungslinie einschließen (z.B. Drapfel, Sirapfel, Hydrapfel)
                </label>
                <p className="text-xs text-muted-foreground mb-4">
                  {evoResolving ? 'Ermittle Kartenanzahl…' : `${evoDexNumbers?.length ?? 1} Pokémon · ${evoSlotCount} Karten`}
                </p>
                {!evoResolving && (
                  <button
                    onClick={confirmPokemon}
                    className="h-11 px-6 rounded-full text-sm font-semibold text-white"
                    style={{ background: 'var(--action-add)' }}
                  >
                    Weiter
                  </button>
                )}
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-3">
                  Suche ein Pokémon — der Binder umfasst automatisch jede
                  existierende Karte davon (jede Variante, Promo, VMAX, ex,
                  GX, … eine eigene Kachel). Die Entwicklungslinie kann im
                  nächsten Schritt optional mit eingeschlossen werden.
                </p>
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    type="search"
                    value={evoQuery}
                    onChange={e => setEvoQuery(e.target.value)}
                    placeholder="z.B. Knapfel, Glumanda"
                    className="w-full h-9 pl-7 pr-3 rounded-lg glass-inner text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                  />
                </div>
                {evoSearching ? (
                  <p className="text-xs text-muted-foreground text-center py-3">Suche…</p>
                ) : evoQuery.trim().length >= 2 && evoResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">Keine Treffer.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {evoResults.map(c => (
                      <button
                        key={c.nationalDexNumber}
                        onClick={() => pickEvoCandidate(c)}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg glass-inner text-left"
                      >
                        <div className="w-10 shrink-0 flex items-center justify-center">
                          <CardImage
                            srcDe={c.imgSmallDe}
                            src={c.imgSmall}
                            alt={c.nameDe ?? c.name}
                            width={40}
                            height={56}
                            className="max-h-9 max-w-[40px] object-contain rounded"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate">{c.nameDe ?? c.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">#{String(c.nationalDexNumber).padStart(3, '0')}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
