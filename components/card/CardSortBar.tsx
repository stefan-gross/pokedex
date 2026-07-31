'use client';

import { ArrowUp, ArrowDown } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

export type SortDir = 'asc' | 'desc';

/**
 * Sortierfeld-Select + Richtungs-Pfeil + optionaler Zusatzinhalt/Ergebniszahl —
 * geteilt zwischen Suche (Browse- und Suchmodus) und Set-Detailseite, damit die
 * Kartenlisten-Steuerung nicht dreifach separat gepflegt werden muss. Welche
 * Sortierfelder gültig sind (und damit welches Sublabel `getSublabel` in
 * CardGrid unter der Karte zeigt), bestimmt weiterhin die aufrufende Seite
 * über `options`.
 *
 * Sortierfeld nutzt die zentrale `Select`-Komponente (Variante `secondary`),
 * der Richtungs-Umschalter den `Button` (`secondary`, icon-only) — statt
 * bisher rohem `<select>`/`<button>` mit `.glass-inner`.
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
        <Select
          value={sortField}
          onChange={onSortFieldChange}
          options={options}
          aria-label="Sortierfeld"
        />
        <Button
          variant="secondary"
          size="lg"
          onClick={onSortDirChange}
          aria-label={sortDir === 'asc' ? 'Aufsteigend' : 'Absteigend'}
          icon={sortDir === 'asc'
            ? <ArrowUp size={16} />
            : <ArrowDown size={16} style={{ color: 'var(--pokedex-red)' }} />}
        />
      </div>
      <div className="flex items-center gap-2 ml-auto">
        {extra}
        {resultLabel && (
          <span className="text-sm font-semibold text-glass tabular-nums shrink-0">{resultLabel}</span>
        )}
      </div>
    </div>
  );
}
