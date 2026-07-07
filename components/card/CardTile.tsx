'use client';

import type { CardInfo } from '@/lib/card-info';
import type { CardDoc } from '@/types';
import { CardImage } from '@/components/card/CardImage';

interface Props {
  card: CardInfo;
  ownedCards?: CardDoc[];
  onCardClick?: () => void;
  onWishlist?: () => void;
  isWishlisted?: boolean;
  sublabel?: string;
  /** Überschreibt die Sublabel-Textfarbe — z.B. Preis-Blau bei Preis-Sortierung. */
  sublabelColor?: string;
}

export function CardTile({ card, ownedCards = [], onCardClick, onWishlist, isWishlisted, sublabel, sublabelColor }: Props) {
  const totalOwned = ownedCards.reduce((s, c) => s + c.quantity, 0);
  const isOwned    = totalOwned > 0;

  return (
    <div className="relative flex flex-col">
      {/* Card image — tap → Detail */}
      <div
        className="relative rounded-[8px] overflow-hidden shadow-card cursor-pointer"
        onClick={onCardClick}
      >
        {!isOwned && (
          // Feste neutrale Rückwand hinter dem transparent gemachten Bild — die
          // echte opacity() darunter blendet dagegen statt gegen den (in Dark Mode
          // sehr dunklen) Seitenhintergrund, der die Karte sonst abdunkeln würde.
          <div className="absolute inset-0 bg-[#c9c9c9] dark:bg-[#5b5d63]" />
        )}
        <div
          className="relative"
          style={!isOwned ? { filter: 'grayscale(0.35) contrast(0.7)', opacity: 0.62 } : undefined}
        >
          <CardImage
            srcDe={card.imgSmallDe}
            src={card.imgSmall}
            alt={card.name}
            width={245}
            height={342}
            className="w-full aspect-[2.5/3.5] object-cover"
            sizes="(max-width: 400px) 30vw, 120px"
          />
        </div>

        {/* Owned badge — grün, analog zum Scan-Erkennungs-Rahmen */}
        {isOwned && (
          <div
            className="absolute top-1.5 right-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md"
            style={{ background: 'rgba(53,209,90,.9)', color: '#fff' }}
          >
            ×{totalOwned}
          </div>
        )}

        {/* Wishlist — nur Herzform, kein Button-Hintergrund; nur bei nicht
            vorhandenen Karten (bei vorhandenen ist die Wunschliste irrelevant) */}
        {!isOwned && (
          <button
            onClick={e => { e.stopPropagation(); onWishlist?.(); }} // stoppt Click-Bubbling zum Detail
            className="absolute bottom-1.5 right-1.5 flex items-center justify-center"
            style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.6))' }}
            aria-label="Zur Wunschliste"
          >
            <svg width="20" height="18" viewBox="0 0 24 22" fill={isWishlisted ? '#ef4444' : 'none'} stroke={isWishlisted ? '#ef4444' : '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        )}
      </div>

      {/* Sortierungsrelevantes Label */}
      {sublabel && (
        <div
          className={`text-[11px] text-center mt-1.5 truncate px-0.5 leading-tight ${sublabelColor ? 'font-semibold' : 'text-glass'}`}
          style={sublabelColor ? { color: sublabelColor } : undefined}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}
