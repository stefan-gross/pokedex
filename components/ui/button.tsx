'use client';

import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { tintedGlassStyle } from '@/lib/ui/tinted-glass';

const DEFAULT_ACCENT = '#e53e3e';   // var(--pokedex-red) als Hex — tintedGlassStyle braucht echte RGB-Werte, kein CSS-Var-Referenz
const DEFAULT_DESTRUCTIVE = '#c53030'; // var(--action-delete)

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 font-semibold whitespace-nowrap transition-transform outline-none select-none active:scale-[.97] disabled:pointer-events-none disabled:opacity-40 rounded-xl',
  {
    variants: {
      variant: {
        primary: 'text-white border-none',
        secondary: 'glass-inner text-foreground border-none',
        ghost: 'bg-transparent border-none',
        destructive: 'text-white border-none',
        icon: 'glass-inner rounded-full border-none p-0',
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

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Akzentfarbe (Hex) für primary/destructive (getönte Glas-Füllung) bzw.
   *  ghost (Textfarbe) — z.B. `binder.color`. Default: App-Rot bzw. Löschen-Rot. */
  accentColor?: string;
}

/**
 * Zentrale Button-Komponente — 5 Varianten (primary/secondary/ghost/
 * destructive/icon), 3 Größen (sm/md/lg), feste Radien/Höhen statt der
 * bisher ~6 Ad-hoc-Stilfamilien app-weit. `primary`/`destructive` nutzen
 * denselben getönten Glas-Look wie der Scan-FAB (`lib/ui/tinted-glass.ts`).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', accentColor, style, ...props },
  ref,
) {
  const isTinted = variant === 'primary' || variant === 'destructive';
  const color = accentColor ?? (variant === 'destructive' ? DEFAULT_DESTRUCTIVE : DEFAULT_ACCENT);

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
    />
  );
});
