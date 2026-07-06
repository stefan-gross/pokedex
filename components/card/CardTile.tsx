'use client';

import { Lock } from 'lucide-react';
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
}

export function CardTile({ card, ownedCards = [], onCardClick, onWishlist, isWishlisted, sublabel }: Props) {
  const totalOwned = ownedCards.reduce((s, c) => s + c.quantity, 0);
  const isOwned    = totalOwned > 0;

  return (
    <div className="relative flex flex-col">
      {/* Card image — tap → Detail */}
      <div
        className="relative rounded-[8px] overflow-hidden shadow-card cursor-pointer"
        onClick={onCardClick}
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

        {/* Unowned overlay + Lock */}
        {!isOwned && (
          <>
            <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.50)' }} />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Lock size={20} className="text-white/50" />
            </div>
          </>
        )}

        {/* Owned badge — grün, analog zum Scan-Erkennungs-Rahmen */}
        {isOwned && (
          <div
            className="absolute top-1.5 right-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md"
            style={{ background: 'rgba(53,209,90,.9)', color: '#fff' }}
          >
            ×{totalOwned}
          </div>
        )}

        {/* Bottom overlay: Wishlist */}
        <div
          className="absolute bottom-0 left-0 right-0 flex justify-end items-center px-1.5 pb-1.5 pt-4"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,.7) 0%, transparent 100%)' }}
          onClick={e => e.stopPropagation()} // Button stoppt Click-Bubbling zum Detail
        >
          {/* Wishlist button */}
          <button
            onClick={onWishlist}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: isWishlisted ? 'rgba(236,72,153,.85)' : 'rgba(0,0,0,.5)' }}
            aria-label="Zur Wunschliste"
          >
            <svg width="14" height="13" viewBox="0 0 24 22" fill={isWishlisted ? '#fff' : 'none'} stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Sortierungsrelevantes Label */}
      {sublabel && (
        <div className="text-[11px] text-muted-foreground text-center mt-1.5 truncate px-0.5 leading-tight">
          {sublabel}
        </div>
      )}
    </div>
  );
}
