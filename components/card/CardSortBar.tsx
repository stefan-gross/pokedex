'use client';

import { ChevronDown, ArrowUp, ArrowDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';

/**
 * Sortierfeld-Select + Richtungs-Pfeil + optionaler Zusatzinhalt/Ergebniszahl —
 * geteilt zwischen Suche (Browse- und Suchmodus) und Set-Detailseite, damit die
 * Kartenlisten-Steuerung nicht dreifach separat gepflegt werden muss. Welche
 * Sortierfelder gültig sind (und damit welches Sublabel `getSublabel` in
 * CardGrid unter der Karte zeigt), bestimmt weiterhin die aufrufende Seite
 * über `options`.
 */
export function CardSortBar<K extends string>({
  options,
  sortField,
  onSortFieldChange,
  sortDir,
  onSortDirChange,
  resultLabel,
  extra,
}: {
  options: { value: K; label: string }[];
  sortField: K;
  onSortFieldChange: (value: K) => void;
  sortDir: SortDir;
  onSortDirChange: () => void;
  /** z.B. "35 Karten" — weglassen, wenn (noch) keine Zahl gezeigt werden soll */
  resultLabel?: string;
  /** zusätzlicher Inhalt rechts, vor der Ergebniszahl (z.B. Evo-Linie-Toggle) */
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <div className="relative flex items-center">
          <select
            value={sortField}
            onChange={e => onSortFieldChange(e.target.value as K)}
            className="h-11 pl-2 pr-6 rounded-lg glass-inner text-glass text-xs appearance-none cursor-pointer"
          >
            {options.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown size={11} className="absolute right-1.5 pointer-events-none text-glass-muted" />
        </div>
        <button
          onClick={onSortDirChange}
          className="h-11 w-11 flex items-center justify-center rounded-lg glass-inner transition-colors shrink-0"
          title={sortDir === 'asc' ? 'Aufsteigend' : 'Absteigend'}
        >
          {sortDir === 'asc'
            ? <ArrowUp size={12} />
            : <ArrowDown size={12} style={{ color: 'var(--pokedex-red)' }} />}
        </button>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        {extra}
        {resultLabel && (
          <span className="text-xs text-glass-muted tabular-nums shrink-0">{resultLabel}</span>
        )}
      </div>
    </div>
  );
}
