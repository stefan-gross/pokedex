'use client';

import { useMemo } from 'react';
import type { CardInfo } from '@/lib/card-info';
import { rarityLabelOf } from '@/lib/card-constants';
import { ButtonGroup } from '@/components/ui/button-group';
import { CustomSelect, MultiSelect } from '@/components/ui/select';
import { RarityFilterBar } from '@/components/card/RarityFilterBar';
import { EnergyIcon, ENERGY_META } from '@/components/ui/EnergyIcon';
import { TCG_TYPES, type TcgType } from '@/lib/hooks/useCardBrowser';
import type { OwnedFilter, Supertype } from '@/lib/search/facet-filter';
import { cn } from '@/lib/utils';

/**
 * Gemeinsame, KONFIGURIERBARE Filterleiste für In-Memory-Kartenlisten
 * (Set-Detail, Wunschliste, Vorlagen-Binder, Deck-Kartensuche). Jede Dimension
 * wird NUR gerendert, wenn ihr `value`+`onChange` übergeben wird — so blendet
 * jede Stelle genau die Filter ein/aus, die sie braucht (Vorgabe des Nutzers).
 *
 * Rein präsentational: der Aufrufer hält den State und filtert selbst (die
 * Datenform unterscheidet sich — plain `CardInfo[]` vs. Wunschlisten-Einträge).
 * Die Leiste berechnet nur die **kreuzreaktiven Zähler** aus dem `cards`-Pool
 * (jede Dimension zählt mit allen ANDEREN aktiven Filtern, aber ohne sich
 * selbst) — identisch zur Logik der Hauptsuche/Deck-Kartensuche.
 *
 * Reihenfolge fix: Vorhanden → Kartenart → Pokémon-Typ → Seltenheit.
 */

const OWNED_OPTIONS: { value: OwnedFilter; label: string }[] = [
  { value: 'all',     label: 'Alle'      },
  { value: 'owned',   label: 'Vorhanden' },
  { value: 'missing', label: 'Fehlen'    },
];

interface Selection {
  owned?: OwnedFilter;
  supertype?: Supertype | 'all';
  types?: Set<TcgType>;
  rarities?: Set<string>;
}

/** Wendet alle aktiven Dimensionen außer `skip` an — Basis der kreuzreaktiven
 *  Zähler (siehe `applyFacetFilters`, hier mit Mehrfach-Seltenheit als Set). */
function applyExcept(cards: CardInfo[], sel: Selection, ownedIds: Set<string>, skip: keyof Selection): CardInfo[] {
  let r = cards;
  if (skip !== 'owned' && sel.owned && sel.owned !== 'all') {
    r = sel.owned === 'owned' ? r.filter(c => ownedIds.has(c.id)) : r.filter(c => !ownedIds.has(c.id));
  }
  if (skip !== 'supertype' && sel.supertype && sel.supertype !== 'all') {
    r = r.filter(c => c.supertype?.toLowerCase() === sel.supertype!.toLowerCase());
  }
  if (skip !== 'types' && sel.types && sel.types.size > 0) {
    r = r.filter(c => c.types?.some(t => sel.types!.has(t as TcgType)));
  }
  if (skip !== 'rarities' && sel.rarities && sel.rarities.size > 0) {
    r = r.filter(c => sel.rarities!.has(rarityLabelOf(c.rarity)));
  }
  return r;
}

export interface CardFilterBarProps {
  /** Karten-Pool für kreuzreaktive Zähler + Rarity-Breakdown (die geladene
   *  In-Memory-Menge, VOR Owned/Rarity/Typ, aber gern schon suchgefiltert). */
  cards: CardInfo[];
  ownedIds: Set<string>;

  // Jede Dimension erscheint nur, wenn value UND onChange gesetzt sind:
  /** Vorhanden/Fehlen. */
  owned?: OwnedFilter;
  onOwnedChange?: (v: OwnedFilter) => void;
  /** Kartenart (Alle|Pokémon|Trainer|Energie). */
  supertype?: Supertype | 'all';
  onSupertypeChange?: (v: Supertype | 'all') => void;
  /** Pokémon-Typ (Mehrfach). Wird bei Kartenart≠Pokémon automatisch verborgen. */
  types?: Set<TcgType>;
  onTypesChange?: (s: Set<TcgType>) => void;
  /** Seltenheiten (Mehrfach) — toggelt per Label (wie `RarityFilterBar.onToggle`). */
  rarities?: Set<string>;
  onRaritiesToggle?: (label: string) => void;

  className?: string;
}

export function CardFilterBar({
  cards, ownedIds,
  owned, onOwnedChange,
  supertype, onSupertypeChange,
  types, onTypesChange,
  rarities, onRaritiesToggle,
  className,
}: CardFilterBarProps) {
  const showOwned     = owned !== undefined && !!onOwnedChange;
  const showSupertype = supertype !== undefined && !!onSupertypeChange;
  // Typen nur bei „Alle"/„Pokémon" (Trainer/Energie haben keinen Pokémon-Typ).
  const showTypes     = types !== undefined && !!onTypesChange && (supertype === undefined || supertype === 'all' || supertype === 'Pokémon');
  const showRarity    = rarities !== undefined && !!onRaritiesToggle;

  const sel: Selection = useMemo(() => ({ owned, supertype, types, rarities }), [owned, supertype, types, rarities]);

  const ownedOptions = useMemo(() => {
    const base = applyExcept(cards, sel, ownedIds, 'owned');
    return OWNED_OPTIONS.map(o => ({
      ...o,
      count: o.value === 'all' ? base.length
        : o.value === 'owned' ? base.filter(c => ownedIds.has(c.id)).length
        : base.filter(c => !ownedIds.has(c.id)).length,
    }));
  }, [cards, sel, ownedIds]);

  const supertypeOptions = useMemo(() => {
    const base = applyExcept(cards, sel, ownedIds, 'supertype');
    const countFor = (s: string) => base.filter(c => c.supertype?.toLowerCase() === s.toLowerCase()).length;
    return [
      { value: 'all' as const,     label: 'Alle',    count: base.length },
      { value: 'Pokémon' as const, label: 'Pokémon', count: countFor('Pokémon') },
      { value: 'Trainer' as const, label: 'Trainer', count: countFor('Trainer') },
      { value: 'Energy' as const,  label: 'Energie', count: countFor('Energy') },
    ];
  }, [cards, sel, ownedIds]);

  const typeOptions = useMemo(() => {
    const base = applyExcept(cards, sel, ownedIds, 'types');
    return TCG_TYPES.map(t => {
      const count = base.filter(c => c.types?.includes(t)).length;
      return { value: t, label: ENERGY_META[t].de, icon: <EnergyIcon type={t} size={16} />, count, disabled: count === 0, color: ENERGY_META[t].bg };
    });
  }, [cards, sel, ownedIds]);

  // Rarity-Pool: alle anderen aktiven Filter angewandt (ohne Rarity selbst).
  const rarityPool = useMemo(() => applyExcept(cards, sel, ownedIds, 'rarities'), [cards, sel, ownedIds]);

  if (!showOwned && !showSupertype && !showTypes && !showRarity) return null;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {showOwned && (
        <ButtonGroup
          options={ownedOptions.map(o => ({ ...o, disabled: o.count === 0 }))}
          value={owned!}
          onChange={v => onOwnedChange!(v as OwnedFilter)}
        />
      )}

      {showSupertype && (
        <CustomSelect
          value={supertype!}
          onChange={v => {
            onSupertypeChange!(v as Supertype | 'all');
            // Typ-Auswahl verwerfen, wenn auf Nicht-Pokémon gewechselt wird.
            if (v !== 'all' && v !== 'Pokémon') onTypesChange?.(new Set());
          }}
          options={supertypeOptions.map(o => ({ value: o.value, label: o.label, count: o.count, disabled: o.count === 0 && o.value !== 'all' }))}
          height="sm"
          fullWidth
          aria-label="Kartenart"
        />
      )}

      {showTypes && (
        <MultiSelect
          values={[...types!]}
          onChange={vals => onTypesChange!(new Set(vals as TcgType[]))}
          options={typeOptions}
          placeholder="Alle Typen"
          aria-label="Pokémon-Typ"
        />
      )}

      {showRarity && (
        <RarityFilterBar
          cards={rarityPool}
          ownedIds={ownedIds}
          activeRarities={rarities!}
          onToggle={onRaritiesToggle!}
        />
      )}
    </div>
  );
}
