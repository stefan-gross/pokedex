import type { ReactNode } from 'react';

/**
 * Kleine SVG-Flagge einer Karten-Sprache (kein Emoji — SVG-Only-Regel).
 * `elevated` = weißer Ring + Schatten, damit die Flagge als Badge auch über
 * Karten-Artwork sauber ablesbar ist (sonst dezenter Innen-Rand wie im
 * Kartendetail). Unbekannte Sprache → Kürzel als Text.
 */
export function LanguageFlag({ lang, size = 14, elevated = false }: { lang: string; size?: number; elevated?: boolean }) {
  const w = Math.round(size * 1.4);
  const h = size;
  const wrap = (children: ReactNode) => (
    <span
      style={{
        display: 'inline-block', width: w, height: h, borderRadius: 2,
        overflow: 'hidden', flexShrink: 0, lineHeight: 0,
        boxShadow: elevated
          ? '0 0 0 1.5px rgba(255,255,255,0.92), 0 1px 2px rgba(0,0,0,0.45)'
          : 'inset 0 0 0 0.5px rgba(0,0,0,0.2)',
      }}
    >
      <svg viewBox="0 0 30 18" width={w} height={h}>{children}</svg>
    </span>
  );
  switch (lang) {
    case 'de': return wrap(<>
      <rect width="30" height="6" fill="#000" />
      <rect y="6" width="30" height="6" fill="#DD0000" />
      <rect y="12" width="30" height="6" fill="#FFCE00" />
    </>);
    case 'en': return wrap(<>
      <rect width="30" height="18" fill="#012169" />
      <path d="M0 0 L30 18 M30 0 L0 18" stroke="#fff" strokeWidth="2.5" />
      <path d="M0 0 L30 18 M30 0 L0 18" stroke="#C8102E" strokeWidth="1" />
      <rect x="13" width="4" height="18" fill="#fff" />
      <rect y="7" width="30" height="4" fill="#fff" />
      <rect x="14" width="2" height="18" fill="#C8102E" />
      <rect y="8" width="30" height="2" fill="#C8102E" />
    </>);
    case 'fr': return wrap(<>
      <rect width="10" height="18" fill="#002654" />
      <rect x="10" width="10" height="18" fill="#fff" />
      <rect x="20" width="10" height="18" fill="#ED2939" />
    </>);
    case 'es': return wrap(<>
      <rect width="30" height="18" fill="#AA151B" />
      <rect y="4.5" width="30" height="9" fill="#F1BF00" />
    </>);
    case 'jp': return wrap(<>
      <rect width="30" height="18" fill="#fff" />
      <circle cx="15" cy="9" r="4.5" fill="#BC002D" />
    </>);
    default: return (
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{lang}</span>
    );
  }
}
