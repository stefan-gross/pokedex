'use client';

import { ExclamationMark } from '@/lib/binder-icons';
import type { CardInfo } from '@/lib/card-info';
import type { CardDoc } from '@/types';
import { CardImage } from '@/components/card/CardImage';
import { CardBadge } from '@/components/card/CardBadge';
import {
  useCardVisualTheme, getCardVisualTheme,
  type CardSize, type MissingCardStyle, type CardTileBadgeLayout,
} from '@/lib/ui/card-theme';

// `MissingCardStyle`/`CardTileBadgeLayout`/`CardSize`/Defaults/Effekt-Liste
// leben jetzt in `lib/ui/card-theme.ts` (analog zu `lib/ui/glass-theme.ts`)
// — hier re-exportiert, damit bestehender Code (`CardTile.tsx`, die
// Design-System-Testseite), der sie aus `Card.tsx` importiert, unverändert
// weiterläuft.
export {
  DEFAULT_MISSING_CARD_STYLE, DEFAULT_CARD_TILE_BADGE_LAYOUT, MISSING_CARD_EFFECTS, defaultBadgeLayoutFor,
  type MissingCardEffect, type CardSize, type MissingCardStyle, type CardTileBadgeLayout,
} from '@/lib/ui/card-theme';

/** Baut den `filter`-CSS-String für den gewählten Effekt (siehe
 *  `MissingCardEffect` in `lib/ui/card-theme.ts` für die Beschreibung jedes
 *  Looks) — Blur ist bei jedem Effekt dabei (gemeinsamer Regler), Sättigung/
 *  Kontrast nur dort, wo sie zum jeweiligen Look beitragen. */
function missingCardFilter(m: MissingCardStyle): string {
  const blur = `blur(${m.blur}px)`;
  switch (m.effect) {
    case 'invert':
      return `saturate(${m.saturate}) contrast(0.7) invert(1) ${blur}`;
    case 'sepia':
      return `sepia(0.85) saturate(${m.saturate}) contrast(0.85) ${blur}`;
    case 'xray':
      return `grayscale(1) invert(1) contrast(1.3) ${blur}`;
    case 'outline':
      return `grayscale(1) ${blur}`;
    case 'hologram':
    case 'flat':
    default:
      return `saturate(${m.saturate}) contrast(0.7) ${blur}`;
  }
}

/**
 * Drei Größenstufen für `Card` (siehe Nutzerwunsch: "Kartenkomponente in 3
 * Größen"): `sm` = Suche/Listenübersicht (bisheriges `CardTile`, unverändert
 * ausgerollt), `lg` = Kartendetail (großes Vorschaubild), `md` = allgemeine
 * Zwischengröße für spätere Einsätze (z.B. Scanmode/`ScannedCardTile`) — noch
 * an keiner echten Stelle verdrahtet, nur hier vorbereitet + auf der
 * Testseite vorgeführt. Ecken-Radius und Badge-Layout kommen NICHT mehr aus
 * diesem Preset, sondern aus dem geteilten, speicherbaren Theme
 * (`getCardVisualTheme()`, `lib/ui/card-theme.ts`) — hier bleiben nur die
 * Eigenschaften, die (noch) nicht Teil des Speicher-Mechanismus sind.
 */
interface CardSizePreset {
  /** Durchmesser der runden Badges in px. */
  badgeSize: number;
  /** Icon-Größe innerhalb von Prüfen-Badge/Wunschlisten-Herz in px. */
  badgeIconSize: number;
  /** Tailwind-Klasse für die Sublabel-Zeile (Kartennummer/Preis). */
  sublabelClassName: string;
  /** `sizes`-Attribut fürs responsive Bild-Laden (next/image). */
  imageSizes: string;
}

// `badgeSize`/`badgeIconSize` skalieren proportional zur `imageSizes`-
// Referenzbreite jeder Stufe (120/200/320px ≈ 1 : 1.667 : 2.667). `sm` bleibt
// die kompakte Variante (z.B. Dashboard-Kacheln, 3-spaltig), Kontexte mit
// größeren 2-spaltigen Kacheln (z.B. Suche) nutzen stattdessen `size="md"`.
export const CARD_SIZE_PRESETS: Record<CardSize, CardSizePreset> = {
  sm: { badgeSize: 28, badgeIconSize: 16, sublabelClassName: 'text-[11px]', imageSizes: '(max-width: 400px) 30vw, 120px' },
  md: { badgeSize: 47, badgeIconSize: 27, sublabelClassName: 'text-sm', imageSizes: '200px' },
  lg: { badgeSize: 75, badgeIconSize: 43, sublabelClassName: 'text-base', imageSizes: '320px' },
};

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
  /** Set-Kürzel als gerahmtes Badge vor der Nummer (nur bei Nummern-Sortierung
   *  sinnvoll) — z.B. "SSP" bei modernen Sets mit aufgedrucktem Kürzel. */
  numberPrefixCode?: string;
  /** Set-Symbol vor der Nummer statt eines Kürzels — bei alten Sets ohne
   *  aufgedrucktes Kürzel (siehe SYMBOL_ONLY_SERIES). Hat Vorrang vor `numberPrefixCode`. */
  numberPrefixSymbolUrl?: string;
  /** Alt-Text fürs Set-Symbol (Kürzel), falls `numberPrefixSymbolUrl` gesetzt ist. */
  setCode?: string;
  /** Vorformatierter Preis (z.B. "4,59 €") — Badge unten links, Pillenform
   *  statt Kreis (siehe `CardBadge`'s `shape="pill"`). */
  price?: string;
  /** Farbiger Statusrahmen ums Kartenbild — z.B. beim Scan: grün = erkannt/
   *  hinzugefügt, gelb = unsicher/Prüfung nötig, rot = Fälschungsverdacht.
   *  Generische Prop — welche Farbe wann zutrifft, entscheidet der Aufrufer. */
  border?: 'green' | 'yellow' | 'red';
  /** Größenstufe — steuert Ecken-Radius/Badge-Größe/Bild-`sizes`. Default
   *  `'sm'` = bisheriges `CardTile`-Verhalten. */
  size?: CardSize;
  /** Überschreibt den "fehlt"-Look bzw. die Badge-Positionen/den Ecken-
   *  Radius — z.B. für den Live-Entwurf auf `/design-system-preview`. Echte
   *  Aufrufer lassen alle drei weg und bekommen das aktuell GESPEICHERTE
   *  Theme (`getCardVisualTheme()`) für die jeweilige `size`. */
  missingStyle?: MissingCardStyle;
  badgeLayout?: CardTileBadgeLayout;
  cornerRadius?: number;
}

const BORDER_COLORS: Record<'green' | 'yellow' | 'red', string> = {
  green: '#35d15a',
  yellow: 'var(--pokedex-yellow)',
  red: '#ef4444',
};

export function Card({
  card, ownedCards = [], onCardClick, onWishlist, isWishlisted, sublabel, sublabelColor, sublabelLoading,
  numberPrefixCode, numberPrefixSymbolUrl, setCode, price, border, size = 'sm',
  missingStyle = getCardVisualTheme().missingStyle,
  cornerRadius = getCardVisualTheme().cornerRadius[size],
  badgeLayout = getCardVisualTheme().badgeLayout[size],
}: Props) {
  // Abonniert das geteilte Karten-Theme nur, damit diese Komponente neu
  // rendert (und die obigen Default-Parameter frische Werte lesen), wenn die
  // Testseite (`/design-system-preview`) "Speichern" drückt oder das Theme
  // beim App-Start hydriert wird — der Rückgabewert selbst wird hier nicht
  // gebraucht (analog zu `useGlassTheme()` in `components/ui/button.tsx`).
  useCardVisualTheme();
  const preset = CARD_SIZE_PRESETS[size];
  const radius = cornerRadius;
  const layout = badgeLayout;
  const totalOwned    = ownedCards.reduce((s, c) => s + c.quantity, 0);
  const isOwned       = totalOwned > 0;
  const needsReview   = ownedCards.some(c => c.needsReview);

  return (
    <div className="relative flex flex-col">
      {/* Card image — tap → Detail (öffnet dort auch den "Prüfen"-Button je Exemplar).
          Kein `overflow-hidden` auf diesem äußeren Wrapper — Badges sind
          Geschwister des gerundeten Bild-Wrappers darunter, dürfen also über
          den Kartenrand hinausragen. `shadow-card` folgt trotzdem der
          Rundung, da `box-shadow` sich am eigenen `border-radius` orientiert
          und dafür kein Clipping braucht. */}
      <div
        className="relative shadow-card cursor-pointer"
        style={{ borderRadius: radius }}
        onClick={onCardClick}
      >
        <div
          className="relative overflow-hidden"
          style={{
            borderRadius: radius,
            ...(!isOwned ? {
              filter: missingCardFilter(missingStyle),
              opacity: missingStyle.opacity,
            } : undefined),
          }}
        >
          <CardImage
            srcDe={card.imgSmallDe}
            src={card.imgSmall}
            alt={card.name}
            width={245}
            height={342}
            className="w-full aspect-[2.5/3.5] object-cover"
            sizes={preset.imageSizes}
          />
          {/* Hologramm-Schimmer — nur bei diesem einen Effekt, animiertes
              Regenbogen-Band per `mix-blend-mode`, reine Deko-Ebene über dem
              (bereits gefilterten) Bild. Reagiert auf reduzierte Bewegung
              über `.missing-card-hologram` (globals.css). */}
          {!isOwned && missingStyle.effect === 'hologram' && (
            <div className="absolute inset-0 missing-card-hologram" aria-hidden="true" />
          )}
        </div>
        {/* Silhouette — zusätzlicher gestrichelter Rahmen um das (per
            `grayscale`+niedriger Opacity bereits sehr schwache) Bild, spiegelt
            die gestrichelten Platzhalter-Slots, die es an anderen Stellen der
            App schon gibt (z.B. leere Vorlagen-Binder-Seiten). */}
        {!isOwned && missingStyle.effect === 'outline' && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ borderRadius: radius, border: '1.5px dashed rgba(255,255,255,0.5)' }}
            aria-hidden="true"
          />
        )}

        {/* Statusrahmen — z.B. Scan-Erkennung (grün/gelb/rot), generisch je
            nach Aufrufer-Kontext. Eigene Overlay-Ebene analog zum Silhouette-
            Rahmen oben, damit `border-box`-Sizing des Bildes unangetastet bleibt. */}
        {border && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ borderRadius: radius, border: `2.5px solid ${BORDER_COLORS[border]}` }}
            aria-hidden="true"
          />
        )}

        {/* Prüfen-Badge — gelb, oben links, nur bei ungeprüften eigenen Exemplaren. */}
        {needsReview && (
          <CardBadge
            size={preset.badgeSize} color="var(--pokedex-yellow)"
            style={{ top: layout.reviewBadge.top, left: layout.reviewBadge.left }}
            ariaLabel="Ungeprüft" title="Ungeprüft"
          >
            <ExclamationMark size={preset.badgeIconSize} strokeWidth={3} className="text-white" />
          </CardBadge>
        )}

        {/* Owned badge — grün, oben rechts */}
        {isOwned && (
          <CardBadge size={preset.badgeSize} color="rgba(53,209,90,.9)" style={{ top: layout.ownedBadge.top, right: layout.ownedBadge.right }}>
            ×{totalOwned}
          </CardBadge>
        )}

        {/* Preis — unten links, Pillenform statt Kreis (siehe CardBadge shape="pill"). */}
        {price && (
          <CardBadge
            size={preset.badgeSize} shape="pill" color="rgba(0,0,0,.72)"
            style={{ bottom: layout.priceBadge.bottom, left: layout.priceBadge.left }}
            ariaLabel="Preis"
          >
            {price}
          </CardBadge>
        )}

        {/* Wishlist — nur Herzform, kein Button-Hintergrund; nur bei nicht
            vorhandenen Karten (bei vorhandenen ist die Wunschliste irrelevant) */}
        {!isOwned && (
          <CardBadge
            size={preset.badgeSize} background={false}
            style={{ bottom: layout.wishlistBadge.bottom, right: layout.wishlistBadge.right }}
            onClick={e => { e.stopPropagation(); onWishlist?.(); }} // stoppt Click-Bubbling zum Detail
            ariaLabel="Zur Wunschliste"
          >
            <svg width={preset.badgeIconSize * 1.3} height={preset.badgeIconSize * 1.2} viewBox="0 0 24 22" fill={isWishlisted ? '#ef4444' : 'none'} stroke={isWishlisted ? '#ef4444' : '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </CardBadge>
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
            className={`${preset.sublabelClassName} text-center truncate leading-tight ${sublabelColor ? 'font-semibold' : 'text-glass'}`}
            style={sublabelColor ? { color: sublabelColor } : undefined}
          >
            {sublabel}
          </div>
        </div>
      )}
    </div>
  );
}
