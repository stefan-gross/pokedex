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

  // Kein Bild (weder TCGdex noch Backfill):
  // - Vorläufige (nicht katalogisierte) Karte → eigenes Template mit den
  //   erkannten Werten (Name/KP/Set/Nr.) via CardPlaceholder.
  // - Alle anderen Karten ohne Bild → statische „Kein Bild"-Platzhalterkarte
  //   (`/no-card-image.png`, gleiche Kartenproportion).
  // Sobald ein späterer TCGdex-Sync ein (deutsches) Bild liefert, wird das Feld
  // gefüllt und hier automatisch das echte Bild gezeigt.
  if (!activeSrc) {
    // Mit Karteninfos: Platzhalterkarte mit Daten-Overlay (CardPlaceholder wählt
    // je nach `pending` das Template + „?"-Badge). Ohne Infos (z.B. Evolutions-
    // Thumbnail): nur die statische „Kein Bild"-Karte.
    if (placeholderInfo) {
      return <CardPlaceholder info={placeholderInfo} className={className} style={style} onClick={onClick} />;
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/no-card-image.png" alt={alt} className={className} style={style} onClick={onClick} role="img" />
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
