'use client';

import { Star, Gem } from 'lucide-react';
import { usePrice } from '@/lib/hooks/use-price';
import { pickTrendPrice, classifyValue } from '@/lib/prices/value-tier';

interface Props {
  tcgId: string | undefined;
  /** Optionales CSS-Sizing (z.B. für kleine Tiles im Slider). */
  className?: string;
  /** Wenn true, zeigt die Pille NUR das Icon ohne Label-Text — kompakt für kleine Karten. */
  iconOnly?: boolean;
}

/** Wert-Tier-Badge — zeigt nur bei Karten ab Wert-Tier 'wertvoll' (≥ ~20 €) an.
 *  Damit die Kinder auf einen Blick sehen, welche Karten besonders sind. */
export function ValueBadge({ tcgId, className, iconOnly = false }: Props) {
  const { data } = usePrice(tcgId);
  const price = pickTrendPrice(data);
  const tier = classifyValue(price);
  if (!tier.showBadge) return null;

  const Icon = tier.icon === 'gem' ? Gem : Star;
  return (
    <span
      className={
        (className ?? '') +
        ' inline-flex items-center gap-1 rounded-full font-extrabold shadow-md'
      }
      style={{
        background: tier.badgeColor,
        color: tier.textColor,
        boxShadow: tier.glow,
        padding: iconOnly ? '4px' : '2px 8px',
        fontSize: 11,
        lineHeight: 1,
      }}
    >
      <Icon size={iconOnly ? 12 : 11} strokeWidth={2.5} fill={tier.tier === 'schatz' ? tier.textColor : 'none'} />
      {!iconOnly && <span>{tier.label}</span>}
    </span>
  );
}
