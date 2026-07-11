'use client';

import { forwardRef, isValidElement, cloneElement } from 'react';
import { Plus, Minus } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { tintedGlassStyle } from '@/lib/ui/tinted-glass';

// Feste Akzentfarben je Rolle (Hex, nicht CSS-Var — tintedGlassStyle braucht
// echte RGB-Werte). Rot bleibt exklusiv fürs Löschen reserviert, "normale"
// Primary-Aktionen (Speichern/Bestätigen/Weiter) sind jetzt Blau.
const DEFAULT_PRIMARY = '#3182ce';     // var(--pokedex-blue)
const DEFAULT_DESTRUCTIVE = '#c53030'; // var(--action-delete)
const DEFAULT_ADD = '#2f855a';         // var(--action-add)
const DEFAULT_SCAN = '#8b5cf6';        // Scan-FAB-Lila (BottomNav)

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 font-semibold whitespace-nowrap transition-transform outline-none select-none active:scale-[.97] disabled:pointer-events-none disabled:opacity-40 rounded-xl',
  {
    variants: {
      variant: {
        primary: 'text-white border-none',
        secondary: 'glass-inner text-foreground border-none',
        ghost: 'bg-transparent border-none',
        destructive: 'text-white border-none',
        add: 'text-white border-none',
        scan: 'text-white border-none',
        icon: 'glass-inner text-foreground rounded-full border-none p-0',
      },
      size: {
        sm: 'h-9 px-3 text-xs',
        md: 'h-11 px-4 text-sm',
        lg: 'h-12 px-5 text-base',
      },
    },
    compoundVariants: [
      { variant: 'icon', size: 'sm', class: 'w-9' },
      { variant: 'icon', size: 'md', class: 'w-11' },
      { variant: 'icon', size: 'lg', class: 'w-12' },
    ],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

const ICON_SIZE = { sm: 14, md: 16, lg: 18 } as const;
// Runde Icon-only-Buttons (variant="icon") brauchen ein deutlich größeres
// Icon als Inline-Icons vor Text-Labels — sonst wirkt der 44px-Touch-Target
// auf iOS fast leer (HIG-Faustregel: Icon füllt ~45-50% des Kreises).
const ICON_ONLY_SIZE = { sm: 18, md: 20, lg: 24 } as const;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Akzentfarbe (Hex) für primary/destructive/add/scan (getönte Glas-Füllung)
   *  bzw. ghost (Textfarbe) — z.B. `binder.color`. Default je Rolle (siehe oben). */
  accentColor?: string;
  /** Unterdrückt das automatische +/– vor dem Label bei `add`/`destructive`
   *  (z.B. "Abmelden" oder "Sammlung zurücksetzen" sind kein Mengen-Add/-Delete). */
  hideIcon?: boolean;
}

/**
 * Zentrale Button-Komponente — 7 Varianten (primary/secondary/ghost/
 * destructive/add/scan/icon), 3 Größen (sm/md/lg), feste Radien/Höhen statt
 * der bisher ~6 Ad-hoc-Stilfamilien app-weit. `primary`/`destructive`/`add`/
 * `scan` nutzen denselben getönten Glas-Look wie der Scan-FAB
 * (`lib/ui/tinted-glass.ts`). Rollen sind farblich fix: Löschen = Rot,
 * Hinzufügen = Grün (+ Plus-Icon), Scannen = Lila, alles andere Primary = Blau.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', accentColor, hideIcon, style, children, ...props },
  ref,
) {
  const isTinted = variant === 'primary' || variant === 'destructive' || variant === 'add' || variant === 'scan';
  const defaultColor =
    variant === 'destructive' ? DEFAULT_DESTRUCTIVE
    : variant === 'add' ? DEFAULT_ADD
    : variant === 'scan' ? DEFAULT_SCAN
    : DEFAULT_PRIMARY;
  const color = accentColor ?? defaultColor;
  const iconSize = ICON_SIZE[size ?? 'md'];

  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      style={{
        ...(isTinted ? tintedGlassStyle(color) : undefined),
        ...(variant === 'ghost' ? { color } : undefined),
        ...style,
      }}
      {...props}
    >
      {!hideIcon && variant === 'add' && <Plus size={iconSize} strokeWidth={2.5} />}
      {!hideIcon && variant === 'destructive' && <Minus size={iconSize} strokeWidth={2.5} />}
      {variant === 'icon' && isValidElement<{ size?: number }>(children)
        ? cloneElement(children, { size: children.props.size ?? ICON_ONLY_SIZE[size ?? 'md'] })
        : children}
    </button>
  );
});
