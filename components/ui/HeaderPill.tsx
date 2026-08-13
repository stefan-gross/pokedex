import type { ReactNode } from 'react';

/**
 * Kleine Pill für den Karten-Header (Setkürzel, Rarity, Reguliermarke …).
 * Einheitliche Form (rund, Glas-Sekundär-Hintergrund); über Props steuerbar:
 *  - `color`: Akzentfarbe für Text + Rahmen (ohne → neutral Vordergrund/Border),
 *  - `icon`: optionales Symbol links (darf eigene Farbe tragen, z.B. Rarity),
 *  - `mono`: Monospace (z.B. Setkürzel),
 *  - `title`: Tooltip.
 */
export function HeaderPill({ children, icon, color, mono = false, title, className = '' }: {
  children: ReactNode;
  icon?: ReactNode;
  color?: string;
  mono?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`glass inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-bold leading-none shrink-0 ${mono ? 'font-mono ' : ''}${className}`}
      style={{
        color: color ?? 'var(--foreground)',
        // Akzentfarbe → Rahmen einfärben (z.B. Reguliermarke/Legalität); sonst
        // dezenter neutraler Rand auf dem durchscheinenden Glas-Hintergrund.
        borderColor: color ?? 'var(--border)',
      }}
    >
      {icon}
      {children}
    </span>
  );
}
