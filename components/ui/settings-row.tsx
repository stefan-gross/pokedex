'use client';

import { cn } from '@/lib/utils';

/** Farbton der Zeile (Titel + Icon) — je nach Aktion. `default` = neutral,
 *  `warning` = orange (Reset/Rebuild), `info` = blau (Preise), `danger` = rot
 *  (löschen/abmelden). */
type Tone = 'default' | 'warning' | 'info' | 'danger';

const TONE_TEXT: Record<Tone, string> = {
  default: 'text-glass',
  warning: 'text-orange-700 dark:text-orange-200',
  info: 'text-blue-700 dark:text-blue-200',
  danger: 'text-red-600 dark:text-red-300',
};

/**
 * Eine anklickbare Listen-Zeile in einer `.glass`-Karte (Einstellungen u.ä.):
 * Icon + Titel + optionaler Untertitel, links ausgerichtet, volle Breite.
 * Extrahiert aus dem mehrfach kopierten Muster in `settings/page.tsx`
 * (App/Katalog/Gefahren-Zone/Account). Bewusst KEINE `Button`-Komponente —
 * das ist eine vollbreite Listen-Zeile, kein Kapsel-CTA.
 */
export function SettingsRow({
  icon, title, subtitle, extra, tone = 'default',
  onClick, disabled, active, divider, compact,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Zusatz-Inhalt unter dem Untertitel (z.B. Fortschritts-/Ergebnis-Text). */
  extra?: React.ReactNode;
  tone?: Tone;
  onClick?: () => void;
  disabled?: boolean;
  /** Hebt die Zeile hervor (z.B. während ein langer Vorgang läuft). */
  active?: boolean;
  /** Trennlinie oben — für Zeilen ab der zweiten in derselben Karte. */
  divider?: boolean;
  /** Kompakt (kleinerer Text/Abstand, ohne Titel-Rolle) — z.B. „Abbrechen". */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-3 text-left transition-colors disabled:opacity-40',
        compact ? 'px-4 py-3' : 'px-4 py-4',
        divider && 'border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.14]',
        active && 'bg-[rgba(30,40,80,0.06)] dark:bg-white/10',
      )}
    >
      {icon && (
        <span className={cn('shrink-0', tone === 'default' ? 'text-glass-muted' : TONE_TEXT[tone])}>{icon}</span>
      )}
      <div className="flex-1 min-w-0">
        <p className={cn(compact ? 'text-sm text-glass-muted' : cn('text-role-title', TONE_TEXT[tone]))}>{title}</p>
        {subtitle && <p className="text-role-label text-glass-muted">{subtitle}</p>}
        {extra}
      </div>
    </button>
  );
}
