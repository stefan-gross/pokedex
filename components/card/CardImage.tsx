'use client';

import { useState } from 'react';
import Image from 'next/image';

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
}: CardImageProps) {
  const [failed, setFailed] = useState(false);

  // || statt ?? — fängt auch leere Strings aus Firestore ab
  const activeSrc = (!failed && srcDe) ? srcDe : (src || undefined);
  if (!activeSrc) return null;

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
