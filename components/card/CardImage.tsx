'use client';

import { useState } from 'react';
import Image from 'next/image';
import { CardPlaceholder, type CardPlaceholderInfo } from '@/components/card/CardPlaceholder';
import {
  cardImageCandidates, isUnoptimizedImage, type ImageCardLike,
} from '@/lib/card-image';

interface CardImageProps {
  /** Bevorzugt: die Karte selbst — die Kandidatenliste (inkl. Storage-Fallback)
   *  wird zentral über `cardImageCandidates` gebaut. */
  card?: ImageCardLike;
  /** Größe/Sprache für die zentrale Kandidaten-Logik (nur mit `card`). */
  size?: 'small' | 'large';
  language?: string;
  /** Optionale Zusatzquelle, die VOR allen Kandidaten probiert wird (z.B. eine
   *  zur Laufzeit aus Set-Metadaten abgeleitete DE-Bild-URL). */
  leadSrc?: string;
  /** Legacy-API (ohne `card`): bevorzugtes DE-Bild … */
  srcDe?: string;
  /** … und EN-Bild als Fallback. Wird nur genutzt, wenn `card` fehlt. */
  src?: string;
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
 * Karten-Bild mit zentraler Kandidaten-Logik (`lib/card-image.ts`):
 * probiert alle Bildquellen der Reihe nach (DE/EN-Katalog + selbst gehostete
 * Storage-Bilder), springt bei Ladefehler automatisch zum nächsten und zeigt
 * erst am Ende den Platzhalter. Einheitlich für Grid, Detail, Picker & Co.
 */
export function CardImage({
  card,
  size = 'small',
  language,
  leadSrc,
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
  // Kandidaten zentral bauen (mit `card`) oder aus der Legacy-srcDe/src-API.
  const base = card
    ? cardImageCandidates(card, { size, language })
    : [srcDe, src].filter((u): u is string => !!u);
  // Optionale Zusatzquelle voranstellen (dedupliziert).
  const candidates = (leadSrc ? [leadSrc, ...base] : base)
    .filter((u, i, arr): u is string => !!u && arr.indexOf(u) === i);

  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // Bei Kartenwechsel (neue Kandidatenliste) von vorne beginnen — State während
  // des Renderns anpassen (React-empfohlen) statt via Effekt, um Kaskaden-
  // Renders zu vermeiden.
  const key = candidates.join('|');
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) { setPrevKey(key); setIdx(0); setLoaded(false); }

  const activeSrc = candidates[idx];

  // Keine (weitere) Quelle mehr: Platzhalter.
  if (!activeSrc) {
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
      className={`${className ?? ''}${loaded ? '' : ' img-skeleton'}`}
      style={style}
      sizes={sizes}
      loading={loading}
      priority={priority}
      onClick={onClick}
      onLoad={() => setLoaded(true)}
      // Nächsten Kandidaten probieren (Skeleton erneut zeigen).
      onError={() => { setIdx(i => i + 1); setLoaded(false); }}
      unoptimized={isUnoptimizedImage(activeSrc)}
    />
  );
}
