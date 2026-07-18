'use client';

import { forwardRef, isValidElement, cloneElement } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { primaryGlassStyle, scanFabStyle, secondaryGlassStyle } from '@/lib/ui/tinted-glass';
import { readableTextColor } from '@/lib/color-utils';
import { useGlassTheme } from '@/lib/ui/glass-theme';

// Default-Akzentfarben je Variante (Hex, nicht CSS-Var — die Glas-Rezepte
// brauchen echte RGB-Werte) — jederzeit per `accentColor`-Prop überschreibbar,
// z.B. `accentColor="var(--action-delete)"` für einen roten Lösch-Button auf
// Basis von `variant="primary"` (keine eigene `destructive`-Variante mehr).
const DEFAULT_PRIMARY = '#3182ce'; // var(--pokedex-blue)
const DEFAULT_SCAN = '#8b5cf6';    // Scan-FAB-Lila (BottomNav)

const buttonVariants = cva(
  // Press-Squish (active:scale) gilt für alle Varianten. `rounded-full`
  // (Kapsel) statt vormals `rounded-xl` — Apples eigene Design-Philosophie:
  // "Elements you tap directly (buttons, toggles, chips) should be rounder
  // than elements you view from a distance (headers, page containers)".
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-transform duration-150 outline-none select-none active:scale-[.97] disabled:pointer-events-none disabled:opacity-40 disabled:hover:translate-y-0 rounded-full',
  {
    variants: {
      variant: {
        // Eigenes Hover/Press-Verhalten via `.btn-glass-interactive`
        // (globals.css) — Press-Verdunkelung des Schattens statt ihn nur zu
        // verkleinern, plus Verlauf-Hintergrund (`btn-primary-glass`) und
        // schmaleren/kräftigeren Schatten (`btn-primary-shadow`).
        primary: 'text-white border-none btn-glass-interactive btn-primary-shadow font-semibold',
        // Zurückhaltender als primary/scan (kein CTA) — `font-medium` statt
        // `font-semibold`, dazu gedämpfte Textfarbe (`secondary.textOpacity`
        // in `secondaryGlassStyle()`, tinted-glass.ts) statt vollem Schwarz/
        // Weiß-Kontrast.
        secondary: 'text-foreground border-none font-medium',
        scan: 'text-white border-none hover:-translate-y-px font-semibold',
      },
      // Apple HIG: Mindest-Trefferfläche 44×44pt. `md`/`lg` erfüllen das
      // (44px/48px). `sm` (36px) unterschreitet es bewusst — nur für dichte/
      // dekorative Kontexte gedacht, nicht für primäre Tap-Ziele.
      size: {
        sm: 'h-9 px-3 text-xs',
        md: 'h-11 px-4 text-sm',
        lg: 'h-12 px-5 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

const ICON_SIZE = { sm: 14, md: 16, lg: 18 } as const;
// Runde Icon-only-Buttons (kein `children`-Text, nur `icon`) brauchen ein
// deutlich größeres Icon als Inline-Icons vor Text-Labels — sonst wirkt der
// 44px-Touch-Target auf iOS fast leer (HIG-Faustregel: Icon füllt ~45-50%
// des Kreises).
const ICON_ONLY_SIZE = { sm: 18, md: 20, lg: 24 } as const;
const ICON_ONLY_WIDTH = { sm: 'w-9', md: 'w-11', lg: 'w-12' } as const;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Akzentfarbe (Hex/CSS-Var) — wirkt nur bei `primary`/`scan` (`secondary`
   *  bleibt immer neutral). Default je Variante, siehe `DEFAULT_*` oben. */
  accentColor?: string;
  /** Icon vor dem Text. Ohne `children` (kein Text) wird der Button
   *  automatisch rund + textlos (Icon-only) statt einer eigenen Prop/Variante
   *  dafür. */
  icon?: React.ReactNode;
}

/**
 * Zentrale Button-Komponente — 3 Varianten (primary/secondary/scan), 3
 * Größen (sm/md/lg). Farbe, Icon und Text-Label sind orthogonale Props mit
 * Fallbacks (Farbe je Variante, kein Icon, kein Text) statt eigener
 * Varianten dafür: "Löschen" ist z.B. `variant="primary" accentColor=
 * "var(--action-delete)" icon={<Trash2/>}`, kein eigenes `destructive`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', accentColor, icon, style, children, ...props },
  ref,
) {
  // Abonniert den geteilten Glas-Theme-Store nur, damit dieser Button neu
  // rendert (und `primaryGlassStyle`/`scanFabStyle` frische Werte lesen),
  // wenn die Testseite (`/design-system-preview`) das Theme live verstellt —
  // der Rückgabewert selbst wird hier nicht gebraucht.
  useGlassTheme();
  const isPrimary = variant === 'primary';
  const isScan = variant === 'scan';
  const isSecondary = variant === 'secondary';
  const defaultColor = isScan ? DEFAULT_SCAN : DEFAULT_PRIMARY;
  const color = accentColor ?? defaultColor;
  // Kein Text-Label → rund + textlos statt eines gepolsterten Pills; das
  // Icon übernimmt dann die volle, größere Icon-only-Größe.
  const iconOnly = !!icon && !children;
  const resolvedSize = size ?? 'md';
  const iconSize = iconOnly ? ICON_ONLY_SIZE[resolvedSize] : ICON_SIZE[resolvedSize];
  const resolvedIcon = isValidElement<{ size?: number }>(icon)
    ? cloneElement(icon, { size: icon.props.size ?? iconSize })
    : icon;

  return (
    <button
      ref={ref}
      className={cn(
        buttonVariants({ variant, size, className }),
        iconOnly && `p-0 ${ICON_ONLY_WIDTH[resolvedSize]}`,
      )}
      style={{
        // Kein Rahmen (Session-Vorgabe: alle Elemente außer Panels/Dialoge/
        // Sheets sind randlos) — als Inline-Style gesetzt (Default, wird
        // von secondaryGlassStyle()/primaryGlassStyle() ggf. überschrieben,
        // falls dort ein Rahmen konfiguriert ist).
        border: 'none',
        // Textfarbe je nach Helligkeit der Akzentfarbe statt hart codiertem
        // Weiß — wichtig, da `accentColor` frei überschreibbar ist.
        ...((isPrimary || isScan) ? { color: readableTextColor(color) } : undefined),
        ...(isPrimary ? primaryGlassStyle(color) : undefined),
        // `secondary` hat keine Akzentfarbe — Hintergrund/Rahmen/Schatten/
        // Textfarbe kommen komplett aus dem Theme (Keine/Weiß/Grau-Wahl).
        ...(isSecondary ? secondaryGlassStyle() : undefined),
        // `scan` bekommt 1:1 das Original-Rezept des Footer-FABs
        // (`components/BottomNav.tsx`) — inkl. Rahmen (bewusste Ausnahme von
        // der "randlos"-Regel, da hier ein bestehender Look nachgebildet wird).
        ...(isScan ? scanFabStyle(color) : undefined),
        ...style,
      }}
      {...props}
    >
      {resolvedIcon}
      {children}
    </button>
  );
});
