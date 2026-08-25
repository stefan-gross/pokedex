/**
 * DIE zentrale Bildquellen-Logik für Karten — überall genutzt (Grid, Detail,
 * Scanner, Picker, Binder …), damit jede Ansicht dieselben Kandidaten in
 * derselben Reihenfolge probiert.
 *
 * Reihenfolge:
 *   1. Katalog-Bilder, nach Sprache (DE-first; bei englischer Karte EN-first)
 *      und Größe (angefragte Größe zuerst, andere als Fallback).
 *   2. Selbst gehostete Storage-Bilder (`catalog-images/{id}[_de].png|.jpg`) —
 *      Ersatz für Karten, die im Katalog KEIN Bild haben (z.B. McDonald's-/
 *      Promo-Sets, die TCGdex nie liefert). Diese fehlen in den Katalog-Feldern
 *      und tauchen NUR hier auf → deshalb müssen ALLE Ansichten diese Liste
 *      nutzen, nicht bloß der Scanner.
 *
 * Der Renderer (`CardImage`) probiert die Liste der Reihe nach: lädt ein
 * Kandidat nicht (404/403), springt `onError` zum nächsten, erst am Ende der
 * Platzhalter.
 */

const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

/** Minimale Bild-relevante Felder — CatalogCard und CardInfo erfüllen das. */
export interface ImageCardLike {
  id?: string;
  imgSmall?: string;
  imgLarge?: string;
  imgSmallDe?: string;
  imgLargeDe?: string;
}

export interface CardImageOpts {
  /** Bevorzugte Größe (nur Priorität, nie ausschließend). Default 'large'. */
  size?: 'small' | 'large';
  /** Sprache der anzuzeigenden Karte — 'en' kehrt DE-first auf EN-first um. */
  language?: string;
}

/** Nur die KATALOG-Bild-URLs (ohne Storage-Fallback), sprach- und größengeordnet.
 *  Basis für Einzel-`src`-Kontexte, die keine Fehler-Kette haben. */
function catalogCandidates(card: ImageCardLike, opts: CardImageOpts): string[] {
  const size = opts.size ?? 'large';
  const en = opts.language === 'en';
  const large = en ? [card.imgLarge, card.imgLargeDe] : [card.imgLargeDe, card.imgLarge];
  const small = en ? [card.imgSmall, card.imgSmallDe] : [card.imgSmallDe, card.imgSmall];
  const ordered = size === 'large' ? [...large, ...small] : [...small, ...large];
  return ordered.filter((u): u is string => !!u);
}

/** Geordnete Liste ALLER Bild-URL-Kandidaten inkl. Storage-Fallback (siehe
 *  Datei-Doc). Für die Fehler-Kette in `CardImage`. */
export function cardImageCandidates(card: ImageCardLike, opts: CardImageOpts = {}): string[] {
  const out = catalogCandidates(card, opts);

  // Selbst gehostete Storage-Bilder als Fallback anhängen (nicht für vorläufige
  // Karten — die haben keine echte Katalog-ID). Bei englischer Karte das
  // Basis-`.png` (EN) zuerst, sonst das `_de`-Bild.
  if (BUCKET && card.id && !card.id.startsWith('pending-')) {
    const base = `https://storage.googleapis.com/${BUCKET}/catalog-images/${card.id}`;
    const en = opts.language === 'en';
    const storage = en
      ? [`${base}.png`, `${base}_de.png`, `${base}_de.jpg`]
      : [`${base}_de.png`, `${base}_de.jpg`, `${base}.png`];
    out.push(...storage);
  }

  return out;
}

/** Erste (beste) KATALOG-URL — für Kontexte, die nur EIN `src` brauchen (Hero,
 *  Cover, PDF). Bewusst OHNE Storage-Fallback: ohne Fehler-Kette würde eine nicht
 *  existierende Storage-URL (403) ein kaputtes Bild zeigen. Für robuste Anzeige
 *  inkl. Storage `CardImage` nutzen. */
export function resolveCardImage(
  card: ImageCardLike,
  size: 'small' | 'large' = 'large',
  language?: string,
): string | undefined {
  return catalogCandidates(card, { size, language })[0];
}

/** Soll diese URL von der next/image-Optimierung ausgenommen werden? Abgeleitete
 *  TCGdex-DE-URLs (/de/) und Storage-Bilder fehlen oft (404/403) — der Optimizer
 *  cachet Fehlschläge unnötig; direktes Laden lässt `onError` sauber weiterspringen. */
export function isUnoptimizedImage(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes('storage.googleapis.com') || url.includes('/de/');
}
