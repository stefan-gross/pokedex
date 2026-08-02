'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { getAllSets, type TcgSet } from '@/lib/firestore/sets';
import { SERIES_NAMES_DE } from '@/lib/card-constants';
import { searchCatalog, searchCatalogByArtist, type CatalogCard } from '@/lib/firestore/catalog';
import { pokemonArtworkUrl } from '@/lib/binder-icons';
import { SearchableSelect } from '@/components/ui/select';
import { Sheet } from '@/components/ui/modal';
import { Switch } from '@/components/ui/switch';
import { getEvolutionFamilyDexNumbers } from '@/lib/pokeapi';
import {
  resolveMasterSetTemplate,
} from '@/lib/template-binders/resolve';
import { CreateBinderModal } from './CreateBinderModal';
import type { BinderTemplate } from '@/types';

interface Props {
  onClose: () => void;
  onSaved: () => void;
  /** Öffnet das Modal direkt im Master-Set-Flow mit diesem Set vorausgewählt
   *  (z.B. von der Set-Detailseite aus „Sammlung erstellen"). */
  initialMasterSetId?: string;
  /** Vorlagen-Typ, mit dem das Modal direkt startet — die Typ-Auswahl passiert
   *  jetzt im ersten „Neue Sammlung"-Sheet (binders/page). Default 'masterSet'. */
  initialKind?: Kind;
  /** Zurück-Pfeil auf der Einstiegs-Stufe eines Typs → zurück zum ersten Sheet;
   *  ohne Handler wird stattdessen geschlossen (`onClose`). */
  onBack?: () => void;
}

/** Vorbereitetes Ergebnis, mit dem `CreateBinderModal` aufgerufen wird —
 *  gemeinsamer Konvergenzpunkt für alle drei Vorlagen-Typen unten. */
interface ReadyTemplate {
  template: BinderTemplate;
  initialName: string;
  initialIcon?: string;
  initialColor?: string;
  /** Klarer Pokémon-Name für den Icon-Picker-Trigger (sonst zeigt er nur die
   *  Dex-Nummer, weil im Icon `pokemon:<dex>` kein Name steckt). */
  initialPokemonName?: string;
  /** Set-Anzeige für die (fixe) Icon-Kachel bei Master-Set-Vorlagen —
   *  Name, Zyklus, Kürzel, analog zur Dropdown-Zeile. */
  initialSetDisplay?: { label: string; sub?: string; hint?: string };
}

type Kind = 'masterSet' | 'pokedex' | 'pokemon' | 'artist';

/** Einstieg für Vorlagen-Binder: Pokédex, Evolutionslinie und Master-Set
 *  (Illustrator nutzt bereits denselben Sync-/Sperren-/Hinweis-Mechanismus,
 *  lib/template-binders/*, bekommt aber vorerst keine eigene Erstellungs-UI
 *  — bleibt bewusst ein separater, späterer Schritt). Nach der jeweiligen
 *  Parameter-Auswahl übergibt dieser Screen an das bestehende
 *  `CreateBinderModal` (Name/Icon/Farbe/Größe bleiben dort wie gewohnt
 *  änderbar, bevor der Binder tatsächlich angelegt wird). */
export function CreateTemplateBinderModal({ onClose, onSaved, initialMasterSetId, initialKind, onBack }: Props) {
  const [kind, setKind] = useState<Kind>(initialMasterSetId ? 'masterSet' : (initialKind ?? 'masterSet'));
  // Pokédex hat keine Auswahl (immer alle ~1025 Dex-Nummern) — daher direkt in
  // den letzten Schritt (Settings) springen, ohne redundanten Info-Zwischenschritt.
  const [ready, setReady] = useState<ReadyTemplate | null>(
    initialKind === 'pokedex'
      ? { template: { type: 'pokedex' }, initialName: 'Pokédex', initialColor: '#e53e3e' }
      : null,
  );

  // ── Master-Set ───────────────────────────────────────────────────────
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

  // Dropdown-Optionen: Logo (Icon), Name (Label), Zyklus (Sub-Zeile), Kürzel
  // (Hint). Autosuggest client-seitig über Name + Kürzel (`keywords`).
  const masterSetOptions = useMemo(
    () => allSets.map(s => ({
      value: s.id,
      label: s.nameDe ?? s.name,
      keywords: `${s.name} ${s.ptcgoCode ?? ''}`,
      sub: SERIES_NAMES_DE[s.series] ?? s.series,
      hint: s.ptcgoCode,
      icon: s.logoUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={s.logoUrl} alt="" className="w-8 h-5 object-contain shrink-0" />
        : undefined,
    })),
    [allSets],
  );

  // Vorausgewähltes Set (Aufruf von der Set-Detailseite): sobald die Set-Liste
  // geladen ist, das passende Set einmalig automatisch auswählen und auflösen —
  // der Nutzer landet direkt auf der „X Slots · Weiter"-Ansicht.
  const autoPickRef = useRef(false);
  useEffect(() => {
    if (!initialMasterSetId || autoPickRef.current || allSets.length === 0) return;
    const s = allSets.find(x => x.id === initialMasterSetId);
    if (s) { autoPickRef.current = true; pickSet(s); }
    // pickSet ist stabil genug; bewusst nicht in den Deps (sonst Re-Run bei jedem Render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMasterSetId, allSets]);

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
      initialSetDisplay: {
        label: selectedSet.nameDe ?? selectedSet.name,
        sub: SERIES_NAMES_DE[selectedSet.series] ?? selectedSet.series,
        hint: selectedSet.ptcgoCode,
      },
    });
  }

  // ── Pokémon (optional inkl. Entwicklungslinie) ───────────────────────
  const [evoQuery, setEvoQuery] = useState('');
  const [evoResults, setEvoResults] = useState<CatalogCard[]>([]);
  const [includeFamily, setIncludeFamily] = useState(false);
  const [evoPicked, setEvoPicked] = useState<{ dexNumber: number; name: string } | null>(null);
  const evoDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (kind !== 'pokemon') return;
    if (evoDebounceRef.current) clearTimeout(evoDebounceRef.current);
    if (evoQuery.trim().length < 2) { setEvoResults([]); return; }
    evoDebounceRef.current = setTimeout(async () => {
      const hits = await searchCatalog(evoQuery.trim(), '', 60);
      // Nur Pokémon-Karten (haben eine Dex-Nummer), pro Dex-Nummer nur ein Treffer.
      const byDex = new Map<number, CatalogCard>();
      for (const c of hits) {
        if (c.nationalDexNumber != null && !byDex.has(c.nationalDexNumber)) byDex.set(c.nationalDexNumber, c);
      }
      setEvoResults([...byDex.values()].sort((a, b) => (a.nationalDexNumber! - b.nationalDexNumber!)));
    }, 350);
    return () => { if (evoDebounceRef.current) clearTimeout(evoDebounceRef.current); };
  }, [evoQuery, kind]);

  // Auswahl eines Pokémon merken — der Sprung in die Settings passiert erst
  // beim manuellen „Weiter" (Header-Chevron), damit man die Auswahl und den
  // Entwicklungs-Switch noch prüfen/ändern kann.
  function pickEvoCandidate(c: CatalogCard) {
    if (c.nationalDexNumber == null) return;
    setEvoPicked({ dexNumber: c.nationalDexNumber, name: c.nameDe ?? c.name });
  }

  // „Weiter": löst die Dex-Nummern je nach Entwicklungs-Switch auf und übergibt
  // an die Sammlungs-Settings.
  async function confirmPokemon() {
    if (!evoPicked) return;
    const { dexNumber, name } = evoPicked;
    const dexNumbers = includeFamily ? await getEvolutionFamilyDexNumbers(dexNumber) : [dexNumber];
    setReady({
      template: { type: 'pokemon', dexNumbers },
      initialName: includeFamily ? `${name}-Linie` : name,
      // Offizielles Artwork des gewählten Pokémon als Icon vorschlagen.
      initialIcon: `pokemon:${dexNumber}`,
      initialColor: '#48bb78',
      initialPokemonName: name,
    });
  }

  // ── Illustrator (Template-Typ `artist`) ──────────────────────────────
  const [artistQuery, setArtistQuery] = useState('');
  const [artistResults, setArtistResults] = useState<string[]>([]);
  const [artistPicked, setArtistPicked] = useState<string | null>(null);
  const artistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (kind !== 'artist') return;
    if (artistDebounceRef.current) clearTimeout(artistDebounceRef.current);
    if (artistQuery.trim().length < 2) { setArtistResults([]); return; }
    artistDebounceRef.current = setTimeout(async () => {
      const hits = await searchCatalogByArtist(artistQuery.trim(), 300);
      // Eindeutige Illustrator-Namen (die Suche liefert Karten, mehrere pro Name).
      const names = [...new Set(hits.map(c => c.artist).filter(Boolean) as string[])];
      names.sort((a, b) => a.localeCompare(b, 'de'));
      setArtistResults(names.slice(0, 50));
    }, 350);
    return () => { if (artistDebounceRef.current) clearTimeout(artistDebounceRef.current); };
  }, [artistQuery, kind]);

  function confirmArtist() {
    if (!artistPicked) return;
    setReady({
      template: { type: 'artist', artist: artistPicked },
      initialName: artistPicked,
      initialColor: '#805ad5',
    });
  }

  // Schritt-3-Überschrift (Settings) — trägt den Vorlagentyp.
  const settingsTitles: Record<Kind, string> = {
    masterSet: 'Neue Master-Set Sammlung',
    pokedex: 'Neue Pokédex Sammlung',
    pokemon: 'Neue Pokémon Sammlung',
    artist: 'Neue Illustrator Sammlung',
  };

  // ── Konvergenzpunkt: sobald ein Typ konfiguriert ist, übernimmt das
  //    bestehende CreateBinderModal (Name/Icon/Farbe/Größe editierbar). ──
  if (ready) {
    return (
      <CreateBinderModal
        templateDraft={ready.template}
        initialName={ready.initialName}
        initialIcon={ready.initialIcon}
        initialColor={ready.initialColor}
        initialPokemonName={ready.initialPokemonName}
        initialSetDisplay={ready.initialSetDisplay}
        title={settingsTitles[kind]}
        // Pokédex hat keinen Zwischenschritt → Zurück führt zum Chooser; die
        // anderen Typen kehren zur Auswahl (Schritt 2) zurück.
        onBack={ready.template.type === 'pokedex' ? (onBack ?? onClose) : () => setReady(null)}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }

  // Schritt-2-Überschrift (Vorlage konfigurieren) — „wählen", wo es eine
  // Auswahl gibt; Pokédex konfiguriert nur, hat aber der Einheitlichkeit halber
  // dieselbe Sprachform.
  const titles: Record<Kind, string> = {
    masterSet: 'Master-Set wählen',
    pokedex: 'Pokédex wählen',
    pokemon: 'Pokémon wählen',
    artist: 'Illustrator wählen',
  };

  // Zurück-Pfeil: immer „einen Schritt hoch" zum ersten Sheet (`onBack`) bzw.
  // schließen. Eine getroffene Auswahl muss nicht extra geleert werden — die
  // Dropdowns (Set/Pokémon) erlauben die Korrektur direkt an Ort und Stelle.
  function goBack() {
    (onBack ?? onClose)();
  }

  // „Weiter"-Aktion für den Header-Chevron (symmetrisch zum Zurück-Chevron):
  // Master-Set sobald ein Set gewählt ist, Pokémon sobald eines gewählt wurde.
  // (Pokédex hat keinen Zwischenschritt — springt direkt in die Settings.)
  const nextAction: (() => void) | null =
    kind === 'masterSet' && selectedSet && !masterLoading ? confirmMasterSet
    : kind === 'pokemon' && evoPicked ? confirmPokemon
    : kind === 'artist' && artistPicked ? confirmArtist
    : null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={titles[kind]}
      onBack={goBack}
      onNext={nextAction ?? undefined}
      showClose={false}
    >
          {kind === 'masterSet' && (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Wähle eine Erweiterung — der Binder füllt sich automatisch mit
                allen Karten (vorhandene + fehlende), eine Kachel pro Nummer.
              </p>
              {/* Dropdown mit Autosuggest: Logo · Name · Zyklus · Kürzel. Das
                  gewählte Set bleibt sichtbar/änderbar; „Weiter" oben rechts. */}
              <SearchableSelect
                fullWidth
                aria-label="Master-Set wählen"
                value={selectedSet?.id ?? null}
                onChange={(id) => { const s = allSets.find(x => x.id === id); if (s) pickSet(s); }}
                options={masterSetOptions}
                placeholder={allSets.length === 0 ? 'Lade Sets…' : 'Set wählen'}
                searchPlaceholder="Name des Sets (z.B. Paldea)"
                emptyMessage={allSets.length === 0 ? 'Lade Sets…' : 'Kein Set gefunden'}
              />
              {selectedSet && (
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  {masterLoading ? 'Ermittle Kartenanzahl…' : `${masterSlotCount} Slots · tippe oben rechts auf „Weiter"`}
                </p>
              )}
            </>
          )}

          {kind === 'pokemon' && (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Suche ein Pokémon — der Binder umfasst automatisch jede
                existierende Karte davon (jede Variante, Promo, VMAX, ex,
                GX, … eine eigene Kachel). Entwicklungen lassen sich optional
                mit einbeziehen.
              </p>
              {/* Gleiches Auswahl-Dropdown mit Autosuggest wie im Icon-Picker
                  (Remote-Suche → offizielles Artwork nach Dex-Nummer). Das
                  gewählte Pokémon bleibt sichtbar; „Weiter" oben rechts. */}
              <SearchableSelect
                fullWidth
                aria-label="Pokémon wählen"
                value={evoPicked ? String(evoPicked.dexNumber) : null}
                onChange={(dex) => {
                  const c = evoResults.find(x => String(x.nationalDexNumber) === dex);
                  if (c) pickEvoCandidate(c);
                }}
                onQueryChange={setEvoQuery}
                options={[
                  // Gewähltes Pokémon sicher als Option führen, auch wenn die
                  // aktuelle Trefferliste es (nach Query-Reset) nicht enthält.
                  ...(evoPicked && !evoResults.some(c => c.nationalDexNumber === evoPicked.dexNumber)
                    ? [{
                        value: String(evoPicked.dexNumber),
                        label: evoPicked.name,
                        hint: `#${String(evoPicked.dexNumber).padStart(3, '0')}`,
                        // eslint-disable-next-line @next/next/no-img-element
                        icon: <img src={pokemonArtworkUrl(evoPicked.dexNumber)} alt="" className="w-6 h-6 object-contain shrink-0" />,
                      }]
                    : []),
                  ...evoResults.map(c => ({
                    value: String(c.nationalDexNumber),
                    label: c.nameDe ?? c.name,
                    hint: `#${String(c.nationalDexNumber).padStart(3, '0')}`,
                    // eslint-disable-next-line @next/next/no-img-element
                    icon: <img src={pokemonArtworkUrl(c.nationalDexNumber!)} alt="" className="w-6 h-6 object-contain shrink-0" />,
                  })),
                ]}
                placeholder="Pokémon wählen"
                searchPlaceholder="z.B. Knapfel, Glumanda"
                emptyMessage="Mind. 2 Buchstaben eingeben"
              />
              {/* Entwicklungs-Switch — `includeFamily` wird beim „Weiter"
                  ausgewertet, ist also unabhängig von der Reihenfolge. */}
              <div className="mt-3">
                <Switch
                  checked={includeFamily}
                  onChange={setIncludeFamily}
                  accentColor="#2f855a"
                  label="Entwicklungen mit einbeziehen"
                />
              </div>
              {evoPicked && (
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  {evoPicked.name} gewählt · tippe oben rechts auf „Weiter"
                </p>
              )}
            </>
          )}

          {kind === 'artist' && (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Wähle einen Illustrator — der Binder umfasst automatisch jede
                Karte, die er gezeichnet hat, eine Kachel pro Karte.
              </p>
              {/* Dropdown mit Autosuggest über den Illustrator-Namen. Die
                  Auswahl bleibt sichtbar/änderbar; „Weiter" oben rechts. */}
              <SearchableSelect
                fullWidth
                aria-label="Illustrator wählen"
                value={artistPicked}
                onChange={(name) => setArtistPicked(name)}
                onQueryChange={setArtistQuery}
                options={[
                  ...(artistPicked && !artistResults.includes(artistPicked)
                    ? [{ value: artistPicked, label: artistPicked }]
                    : []),
                  ...artistResults.map(a => ({ value: a, label: a })),
                ]}
                placeholder="Illustrator wählen"
                searchPlaceholder="Name des Illustrators (z.B. Mitsuhiro Arita)"
                emptyMessage="Mind. 2 Buchstaben eingeben"
              />
              {artistPicked && (
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  {artistPicked} gewählt · tippe oben rechts auf „Weiter"
                </p>
              )}
            </>
          )}
    </Sheet>
  );
}
