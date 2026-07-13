'use client';

import {
  Folder, Package, Zap, Flame, Droplets, Leaf, Flower2, Moon,
  Star, Layers, Trophy, Gem, Sparkles, Archive, FileStack, type LucideIcon,
} from 'lucide-react';
import { EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';
import { useSetMeta } from '@/lib/hooks/use-set-meta';

type IconComponent = LucideIcon | React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

/** Reines Ausrufezeichen (Strich + Punkt, ohne umgebende Form wie Dreieck/
 *  Kreis) — es gibt kein passendes Lucide-Icon dafür (nur "…-alert"-Varianten
 *  mit Dreieck/Kreis/Achteck als Rahmen). Gleicher Stroke-Stil wie Lucide
 *  (currentColor, round Caps), damit es sich nahtlos einreiht. */
export function ExclamationMark({ size = 24, className, strokeWidth = 2.5 }: { size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="3" x2="12" y2="14" />
      <line x1="12" y1="19" x2="12.01" y2="19" />
    </svg>
  );
}

export const BINDER_ICON_MAP: Record<string, IconComponent> = {
  folder:   Folder,
  box:      Package,
  zap:      Zap,
  flame:    Flame,
  droplets: Droplets,
  leaf:     Leaf,
  flower:   Flower2,
  moon:     Moon,
  star:     Star,
  layers:   Layers,
  trophy:   Trophy,
  gem:      Gem,
  sparkles: Sparkles,
  archive:  Archive,
  alert:    ExclamationMark,
  cards:    FileStack,
};

export const BINDER_ICON_KEYS = Object.keys(BINDER_ICON_MAP);

export function BinderIcon({ name, size = 20, className, style, strokeWidth }: { name?: string; size?: number; className?: string; style?: React.CSSProperties; strokeWidth?: number }) {
  // Hook muss unabhängig vom `name`-Zweig immer aufgerufen werden (Rules of
  // Hooks) — löst nur einen Fetch aus, wenn setId gesetzt ist.
  const setId = name?.startsWith('set:') ? name.slice(4) : undefined;
  const setMeta = useSetMeta(setId, undefined, undefined);

  if (name?.startsWith('type:')) {
    // `style.color` (z.B. Präge-Textfarbe auf BinderCover) wird als
    // EnergyIcon-`color`-Override durchgereicht — Rest von `style` (Filter,
    // Größenbegrenzung) auf einen Wrapper, da EnergyIcon selbst kein
    // generisches `style` annimmt.
    const { color, ...wrapperStyle } = style ?? {};
    return (
      <span style={{ display: 'inline-flex', ...wrapperStyle }}>
        <EnergyIcon type={name.slice(5) as EnergyType} size={size} className={className} color={color as string | undefined} />
      </span>
    );
  }
  if (setId) {
    // Deutsches TCGdex-Logo bevorzugt (setMeta.logoUrl), pokemontcg.io nur
    // als Fallback, solange die Set-Metadaten noch nicht geladen sind.
    const src = setMeta?.logoUrl ?? `https://images.pokemontcg.io/${setId}/logo.png`;
    return (
      <img
        src={src}
        style={{ height: size, width: 'auto', maxWidth: size * 3, objectFit: 'contain', ...style }}
        className={className}
        alt={setId}
      />
    );
  }
  // Gleiche Wrapper-Struktur wie beim Typ-Icon oben: das <svg> selbst bleibt
  // bei einer festen, eindeutigen Pixelgröße (keine CSS-Overrides direkt
  // drauf), die flexible Größenlogik (maxWidth/auto/maxHeight) trägt
  // stattdessen der Wrapper. Vorher lag `width:'auto'`+`maxHeight` direkt
  // auf dem <svg>, was bei echtem Browser-Zoom (anders als bei
  // CSS-`zoom`/`transform:scale` in Tests) nicht zuverlässig neu berechnet
  // wurde — das <svg> "fror" auf einer alten Größe ein, während Text und
  // Typ-Icon (deren <svg> immer eine feste Attribut-Größe hatte) korrekt
  // mitskalierten.
  const Icon = (name && BINDER_ICON_MAP[name]) ? BINDER_ICON_MAP[name] : Folder;
  return (
    <span style={{ display: 'inline-flex', ...style }}>
      <Icon size={size} className={className} strokeWidth={strokeWidth} />
    </span>
  );
}
