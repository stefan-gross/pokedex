'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BINDER_ICON_KEYS, BinderIcon, pokemonArtworkUrl } from '@/lib/binder-icons';
import { searchCatalog, type CatalogCard } from '@/lib/firestore/catalog';
import { EnergyIcon } from '@/components/ui/EnergyIcon';
import { SearchableSelect } from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';
import { TCG_TYPES } from '@/lib/hooks/useCardBrowser';
import { getAllSets, type TcgSet } from '@/lib/firestore/sets';
import { SERIES_NAMES_DE } from '@/lib/card-constants';

type PickerTab = 'icons' | 'types' | 'set' | 'pokemon';

/**
 * Icon-Auswahl (4 Tabs: Basis/Typen/Sets/Pokémon) — extrahiert aus
 * `CreateBinderModal`, damit Sammlungen UND Wunschlisten dieselbe Auswahl
 * nutzen. Der Icon-Wert ist ein String mit Präfix-Konvention (`type:`/`set:`/
 * `pokemon:<dex>` oder ein Basis-Key), gerendert via `BinderIcon`. Kapselt
 * Tab-State, Sets-Lazy-Load und die entprellte Pokémon-Remote-Suche selbst.
 */
export function IconPicker({
  value, onChange, accent = '#e53e3e', lockBasis = false, initialPokemonName = null,
}: {
  value: string;
  onChange: (icon: string) => void;
  /** Akzent der Auswahl-Hervorhebung (unabhängig von der gewählten Farbe). */
  accent?: string;
  /** Nur Basis-Icons anbieten (z.B. Illustrator-Vorlage) — keine Tabs. */
  lockBasis?: boolean;
  /** Name des vorgewählten Pokémon (Dropdown-Trigger), falls `value` `pokemon:`. */
  initialPokemonName?: string | null;
}) {
  const [pickerTab, setPickerTab] = useState<PickerTab>(
    value.startsWith('set:') ? 'set'
      : value.startsWith('type:') ? 'types'
      : value.startsWith('pokemon:') ? 'pokemon'
      : 'icons',
  );
  const [allSets, setAllSets] = useState<TcgSet[]>([]);
  const setsLoadedRef = useRef(false);
  const [pokeQuery, setPokeQuery] = useState('');
  const [pokeResults, setPokeResults] = useState<{ dex: number; name: string }[]>([]);
  const [selectedPokeName, setSelectedPokeName] = useState<string | null>(
    value.startsWith('pokemon:') ? initialPokemonName : null,
  );
  const pokeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pickerTab === 'set' && !setsLoadedRef.current) {
      setsLoadedRef.current = true;
      getAllSets().then(setAllSets).catch(() => {});
    }
  }, [pickerTab]);

  useEffect(() => {
    if (pokeDebounceRef.current) clearTimeout(pokeDebounceRef.current);
    const q = pokeQuery.trim();
    if (q.length < 2) { setPokeResults([]); return; }
    pokeDebounceRef.current = setTimeout(async () => {
      const hits = await searchCatalog(q, '', 60);
      const byDex = new Map<number, CatalogCard>();
      for (const c of hits) {
        if (c.nationalDexNumber != null && !byDex.has(c.nationalDexNumber)) byDex.set(c.nationalDexNumber, c);
      }
      setPokeResults([...byDex.values()]
        .sort((a, b) => a.nationalDexNumber! - b.nationalDexNumber!)
        .map(c => ({ dex: c.nationalDexNumber!, name: c.nameDe ?? c.name })));
    }, 350);
    return () => { if (pokeDebounceRef.current) clearTimeout(pokeDebounceRef.current); };
  }, [pokeQuery]);

  const setOptions = useMemo(
    () => [...allSets]
      .sort((a, b) => (a.nameDe ?? a.name).localeCompare(b.nameDe ?? b.name, 'de'))
      .map(s => ({
        value: s.id,
        label: s.nameDe ?? s.name,
        keywords: `${s.ptcgoCode ?? ''} ${s.name} ${SERIES_NAMES_DE[s.series] ?? s.series}`,
        sub: SERIES_NAMES_DE[s.series] ?? s.series,
        hint: s.ptcgoCode,
        // eslint-disable-next-line @next/next/no-img-element
        icon: s.logoUrl ? <img src={s.logoUrl} alt="" className="w-8 h-5 object-contain shrink-0" /> : undefined,
      })),
    [allSets],
  );

  const pokeDex = value.startsWith('pokemon:') ? value.slice(8) : null;
  const pokeOptions = useMemo(() => {
    const opts = pokeResults.map(p => ({
      value: String(p.dex),
      label: p.name,
      hint: `#${String(p.dex).padStart(3, '0')}`,
      // eslint-disable-next-line @next/next/no-img-element
      icon: <img src={pokemonArtworkUrl(p.dex)} alt="" className="w-6 h-6 object-contain shrink-0" />,
    }));
    if (pokeDex && !opts.some(o => o.value === pokeDex)) {
      opts.unshift({
        value: pokeDex,
        label: selectedPokeName ?? `#${pokeDex}`,
        hint: `#${String(pokeDex).padStart(3, '0')}`,
        // eslint-disable-next-line @next/next/no-img-element
        icon: <img src={pokemonArtworkUrl(pokeDex)} alt="" className="w-6 h-6 object-contain shrink-0" />,
      });
    }
    return opts;
  }, [pokeResults, pokeDex, selectedPokeName]);

  return (
    <>
      {!lockBasis && (
        <Tabs
          className="mb-3"
          value={pickerTab}
          onChange={setPickerTab}
          accentColor={accent}
          options={[
            { value: 'icons',   label: 'Basis' },
            { value: 'types',   label: 'Typen' },
            { value: 'set',     label: 'Sets' },
            { value: 'pokemon', label: 'Pokémon' },
          ]}
        />
      )}

      {(lockBasis || pickerTab === 'icons') && (
        <div className="flex flex-wrap gap-2">
          {BINDER_ICON_KEYS.map(key => (
            <button
              key={key}
              onClick={() => onChange(key)}
              className={`w-11 h-11 rounded-xl flex items-center justify-center border-2 transition-colors ${value === key ? '' : 'glass-inner'}`}
              style={{ borderColor: value === key ? accent : 'transparent', background: value === key ? `${accent}20` : undefined }}
            >
              <BinderIcon name={key} size={18} style={{ color: value === key ? accent : 'var(--muted-foreground)' }} />
            </button>
          ))}
        </div>
      )}

      {pickerTab === 'types' && !lockBasis && (
        <div className="flex flex-wrap gap-2">
          {TCG_TYPES.map(t => (
            <button
              key={t}
              onClick={() => onChange(`type:${t}`)}
              className={`w-11 h-11 rounded-xl flex items-center justify-center border-2 transition-colors ${value === `type:${t}` ? '' : 'glass-inner'}`}
              style={{ borderColor: value === `type:${t}` ? accent : 'transparent', background: value === `type:${t}` ? `${accent}20` : undefined }}
            >
              <EnergyIcon type={t} size={24} />
            </button>
          ))}
        </div>
      )}

      {pickerTab === 'set' && !lockBasis && (
        <SearchableSelect
          fullWidth
          aria-label="Set wählen"
          value={value.startsWith('set:') ? value.slice(4) : null}
          onChange={(id) => onChange(`set:${id}`)}
          options={setOptions}
          placeholder={allSets.length === 0 ? 'Lade Sets…' : 'Set wählen'}
          searchPlaceholder="Name oder Kürzel (z.B. PAL)"
          emptyMessage="Kein Set gefunden"
        />
      )}

      {pickerTab === 'pokemon' && !lockBasis && (
        <SearchableSelect
          fullWidth
          aria-label="Pokémon wählen"
          value={pokeDex}
          onChange={(dex) => {
            onChange(`pokemon:${dex}`);
            setSelectedPokeName(pokeResults.find(p => String(p.dex) === dex)?.name ?? null);
          }}
          options={pokeOptions}
          onQueryChange={setPokeQuery}
          placeholder="Pokémon wählen"
          searchPlaceholder="Pokémon suchen (z.B. Glumanda)"
          emptyMessage="Mind. 2 Buchstaben eingeben"
        />
      )}
    </>
  );
}
