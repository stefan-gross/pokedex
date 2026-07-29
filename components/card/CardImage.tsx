'use client';

import { useState } from 'react';
import Image from 'next/image';
import { CardPlaceholder, type CardPlaceholderInfo } from '@/components/card/CardPlaceholder';

interface CardImageProps {
  /** Bevorzugtes DE-Bild (TCGdex). Fehlt es, wird `src` direkt gezeigt. */
  srcDe?: string;
  /** EN-Bild als sicherer Fallback (pokemontcg.io). */
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  style?: React.CSSProperties;
  sizes?: string;
  loading?: 'lazy' | 'eager';
  priority?: boolean;
  onClick?: () => void;
  /** Karteninfos für den „Bild fehlt"-Platzhalter (Name/KP/Nummer/Dex).
   *  Fehlt es, wird nur eine schlichte neutrale Fläche gezeigt. */
  placeholderInfo?: CardPlaceholderInfo;
}

/**
 * Karten-Bild mit DE-first Logik:
 * 1. Zeigt `srcDe` wenn vorhanden
 * 2. Bei Ladefehler automatischer Fallback auf `src` (EN)
 *
 * Einheitlich für Grid (CardTile) und Detailansicht (CardDetailSheet).
 */
export function CardImage({
  srcDe,
  src,
  alt,
  width,
  height,
  className,
  style,
  sizes,
  loading = 'lazy',
  priority,
  onClick,
  placeholderInfo,
}: CardImageProps) {
  const [failed, setFailed] = useState(false);

  // || statt ?? — fängt auch leere Strings aus Firestore ab
  const activeSrc = (!failed && srcDe) ? srcDe : (src || undefined);

  // Kein Bild (weder TCGdex noch Backfill) → Platzhalter statt Leerraum.
  // Mit Karteninfos: nachempfundene Karte mit Name/KP/Nummer/Dex + „Bild fehlt".
  // Ohne Infos (z.B. Evolutions-Thumbnail): schlichte neutrale Fläche.
  // Sobald ein späterer TCGdex-Sync ein (deutsches) Bild liefert, wird das Feld
  // gefüllt und hier automatisch das echte Bild gezeigt.
  if (!activeSrc) {
    if (placeholderInfo) {
      return <CardPlaceholder info={placeholderInfo} className={className} style={style} onClick={onClick} />;
    }
    return (
      <div className={className} style={style} onClick={onClick} aria-label={alt} role="img">
        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 rounded-[7%] bg-[rgba(30,40,80,0.06)] dark:bg-white/10 text-glass-muted">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-1/4 h-1/4 opacity-60" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="12" cy="12" r="3.2" />
            <path d="M3 12h5.8M15.2 12H21" />
          </svg>
          <span className="text-[10px] leading-none opacity-60">kein Bild</span>
        </div>
      </div>
    );
  }

  return (
    <Image
      src={activeSrc}
      alt={alt}
      width={width}
      height={height}
      className={className}
      style={style}
      sizes={sizes}
      loading={loading}
      priority={priority}
      onClick={onClick}
      onError={() => setFailed(true)}
      unoptimized={!failed && !!srcDe}
    />
  );
}
