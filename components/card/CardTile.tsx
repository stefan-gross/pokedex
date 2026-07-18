'use client';

import { Card } from '@/components/card/Card';
import type { CardInfo } from '@/lib/card-info';
import type { CardDoc } from '@/types';

export {
  DEFAULT_MISSING_CARD_STYLE, DEFAULT_CARD_TILE_BADGE_LAYOUT, CARD_SIZE_PRESETS,
  type MissingCardStyle, type CardTileBadgeLayout, type CardSize,
} from '@/components/card/Card';

interface Props {
  card: CardInfo;
  ownedCards?: CardDoc[];
  onCardClick?: () => void;
  onWishlist?: () => void;
  isWishlisted?: boolean;
  sublabel?: string;
  sublabelColor?: string;
  sublabelLoading?: boolean;
  setSymbolUrl?: string;
  setCode?: string;
  numberPrefixCode?: string;
  numberPrefixSymbolUrl?: string;
  missingStyle?: import('@/components/card/Card').MissingCardStyle;
  badgeLayout?: import('@/components/card/Card').CardTileBadgeLayout;
}

/**
 * `CardTile` = `Card` in der `sm`-Größe (Suche/Listenübersicht) — 1:1 das
 * bisherige Verhalten, jetzt als schmaler Wrapper um die generalisierte
 * `Card`-Komponente (drei Größen, siehe `components/card/Card.tsx`). Bleibt
 * als eigener Export erhalten, damit bestehende Aufrufer (`CardGrid.tsx`)
 * unverändert weiterlaufen.
 */
export function CardTile(props: Props) {
  return <Card size="sm" {...props} />;
}
