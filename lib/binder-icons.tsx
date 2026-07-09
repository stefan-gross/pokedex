'use client';

import {
  Folder, Package, Zap, Flame, Droplets, Leaf, Flower2, Moon,
  Star, Layers, Trophy, Gem, Sparkles, Archive, type LucideIcon,
} from 'lucide-react';
import { EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';
import { useSetMeta } from '@/lib/hooks/use-set-meta';

export const BINDER_ICON_MAP: Record<string, LucideIcon> = {
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
};

export const BINDER_ICON_KEYS = Object.keys(BINDER_ICON_MAP);

export function BinderIcon({ name, size = 20, className, style }: { name?: string; size?: number; className?: string; style?: React.CSSProperties }) {
  // Hook muss unabhängig vom `name`-Zweig immer aufgerufen werden (Rules of
  // Hooks) — löst nur einen Fetch aus, wenn setId gesetzt ist.
  const setId = name?.startsWith('set:') ? name.slice(4) : undefined;
  const setMeta = useSetMeta(setId, undefined, undefined);

  if (name?.startsWith('type:')) {
    return <EnergyIcon type={name.slice(5) as EnergyType} size={size} className={className} />;
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
  const Icon = (name && BINDER_ICON_MAP[name]) ? BINDER_ICON_MAP[name] : Folder;
  return <Icon size={size} className={className} style={style} />;
}
