import {
  Folder, Package, Zap, Flame, Droplets, Leaf, Flower2, Moon,
  Star, Layers, Trophy, Gem, Sparkles, Archive, type LucideIcon,
} from 'lucide-react';
import { EnergyIcon, type EnergyType } from '@/components/ui/EnergyIcon';

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
  if (name?.startsWith('type:')) {
    return <EnergyIcon type={name.slice(5) as EnergyType} size={size} className={className} />;
  }
  if (name?.startsWith('set:')) {
    const setId = name.slice(4);
    return (
      <img
        src={`https://images.pokemontcg.io/${setId}/logo.png`}
        style={{ height: size, width: 'auto', maxWidth: size * 3, objectFit: 'contain', ...style }}
        className={className}
        alt={setId}
      />
    );
  }
  const Icon = (name && BINDER_ICON_MAP[name]) ? BINDER_ICON_MAP[name] : Folder;
  return <Icon size={size} className={className} style={style} />;
}
