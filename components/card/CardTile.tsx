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
  /** Zeigt statt des Sublabels einen animierten Platzhalter — z.B. während
   *  der Preis noch per Batch-Route nachgeladen wird. */
  sublabelLoading?: boolean;
  /** Kleines Set-Symbol oben links — zeigt, aus welchem Set die Karte stammt
   *  (z.B. bei einer Namenssuche, die mehrere Sets umfasst). */
  setSymbolUrl?: string;
  /** Tooltip/Alt-Text für das Set-Symbol, z.B. das Set-Kürzel. */
  setCode?: string;
  /** Set-Kürzel als gerahmtes Badge vor der Nummer (nur bei Nummern-Sortierung
   *  sinnvoll) — z.B. "SSP" bei modernen Sets mit aufgedrucktem Kürzel. */
  numberPrefixCode?: string;
  /** Set-Symbol vor der Nummer statt eines Kürzels — bei alten Sets ohne
   *  aufgedrucktes Kürzel (siehe SYMBOL_ONLY_SERIES). Hat Vorrang vor `numberPrefixCode`. */
  numberPrefixSymbolUrl?: string;
}

export function CardTile({ card, ownedCards = [], onCardClick, onWishlist, isWishlisted, sublabel, sublabelColor, sublabelLoading, setSymbolUrl, setCode, numberPrefixCode, numberPrefixSymbolUrl }: Props) {
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

        {/* Set-Badge — oben links, spiegelbildlich zum Owned-Badge oben rechts */}
        {setSymbolUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={setSymbolUrl}
            alt={setCode ?? ''}
            title={setCode}
            className="absolute top-1.5 left-1.5 w-[18px] h-[18px] object-contain rounded-[4px] p-[2px]"
            style={{ background: 'rgba(0,0,0,.55)' }}
          />
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
      {sublabelLoading ? (
        <div className="h-2.5 w-3/5 mx-auto mt-1.5 rounded-full animate-pulse bg-[rgba(30,40,80,0.1)] dark:bg-white/10" />
      ) : sublabel && (
        <div className="flex items-center justify-center gap-1 mt-1.5 px-0.5">
          {numberPrefixSymbolUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={numberPrefixSymbolUrl} alt={setCode ?? ''} className="w-[13px] h-[13px] object-contain shrink-0" />
          ) : numberPrefixCode && (
            <span
              className="text-[9px] font-bold rounded-[5px] shrink-0 leading-none"
              style={{ color: '#9A9DA6', background: '#F2F2F2', padding: '1px 5px', letterSpacing: '.03em' }}
            >
              {numberPrefixCode}
            </span>
          )}
          <div
            className={`text-[11px] text-center truncate leading-tight ${sublabelColor ? 'font-semibold' : 'text-glass'}`}
            style={sublabelColor ? { color: sublabelColor } : undefined}
          >
            {sublabel}
          </div>
        </div>
      )}
    </div>
  );
}
