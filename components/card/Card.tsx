'use client';

import { useId } from 'react';
import { ExclamationMark } from '@/lib/binder-icons';
import { LanguageFlag } from '@/components/card/LanguageFlag';
import type { CardInfo } from '@/lib/card-info';
import type { CardDoc } from '@/types';
import { inherentFoilVariant, holoShimmerClass } from '@/lib/card-constants';
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
  sm: { badgeSize: 25, badgeIconSize: 14, sublabelClassName: 'text-[11px]', imageSizes: '(max-width: 400px) 30vw, 120px' },
  md: { badgeSize: 34, badgeIconSize: 20, sublabelClassName: 'text-sm', imageSizes: '200px' },
  lg: { badgeSize: 67, badgeIconSize: 39, sublabelClassName: 'text-base', imageSizes: '320px' },
};

interface Props {
  card: CardInfo;
  ownedCards?: CardDoc[];
  onCardClick?: () => void;
  /** Karte liegt auf mind. einer MANUELLEN Wunschliste (→ rotes Herz). */
  onManualWishlist?: boolean;
  /** Karte liegt auf mind. einer AUTOMATISCHEN (Vorlagen-)Wunschliste, d.h.
   *  von irgendeiner Auto-Sammlung benötigt (→ weißes Herz). Beides → geteilt. */
  onAutoWishlist?: boolean;
  /** Tap aufs Herz — öffnet i.d.R. den Wunschlisten-Auswahl-Drawer. Ohne
   *  Handler ist das Herz nur ein (nicht klickbares) Statuskennzeichen. */
  onHeartClick?: () => void;
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
  /** „Nacktes" Kachelbild ohne Badges (Prüfen/Anzahl/Preis/Wunschliste-Herz),
   *  Schatten und Sublabel — nur Bild + Besitz-/Fehlt-Look (+ Holo). Für dichte
   *  Kontexte wie Binder-Slots, wo die fehlenden Karten wie in der Suche
   *  aussehen sollen, aber ohne Deko pro Slot. */
  bare?: boolean;
  /** Überschreibt den "fehlt"-Look bzw. die Badge-Positionen/den Ecken-
   *  Radius — z.B. für den Live-Entwurf auf `/design-system-preview`. Echte
   *  Aufrufer lassen alle drei weg und bekommen das aktuell GESPEICHERTE
   *  Theme (`getCardVisualTheme()`) für die jeweilige `size`. */
  missingStyle?: MissingCardStyle;
  badgeLayout?: CardTileBadgeLayout;
  cornerRadius?: number;
  /** Auswahl-Modus (z.B. Bearbeiten einer automatischen Sammlung): ein Tipp
   *  wählt aus statt das Detail zu öffnen. Nur `selectable` Karten reagieren. */
  selectMode?: boolean;
  /** In diesem Kontext auswählbar (z.B. Exemplar liegt in dieser Sammlung). */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

const BORDER_COLORS: Record<'green' | 'yellow' | 'red', string> = {
  green: '#35d15a',
  yellow: 'var(--pokedex-yellow)',
  red: '#ef4444',
};

/** Wunschlisten-Herz mit 4 Zuständen: leer (Outline) / rot (manuell) /
 *  theme-adaptiv (automatisch benötigt — schwarz im Hellen, weiß im Dunklen via
 *  `var(--foreground)`) / geteilt (links rot, rechts theme-adaptiv = beides).
 *  Der geteilte Zustand nutzt einen Hart-Stopp-Verlauf bei 50 %. Exportiert,
 *  damit der Wunschlisten-Button im Kartendetail dasselbe Icon nutzt. */
export function WishlistHeart({ manual, auto, width, height, gradId }: {
  manual: boolean; auto: boolean; width: number; height: number; gradId: string;
}) {
  const both = manual && auto;
  const AUTO = 'var(--foreground)';
  const fill = both ? `url(#${gradId})` : manual ? '#ef4444' : auto ? AUTO : 'none';
  const stroke = manual && !auto ? '#ef4444' : AUTO;
  return (
    <svg
      width={width} height={height} viewBox="0 0 24 22"
      fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,.45))' }}
    >
      {both && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="50%" stopColor="#ef4444" />
            <stop offset="50%" style={{ stopColor: AUTO }} />
          </linearGradient>
        </defs>
      )}
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export function Card({
  card, ownedCards = [], onCardClick, onManualWishlist = false, onAutoWishlist = false, onHeartClick, sublabel, sublabelColor, sublabelLoading,
  numberPrefixCode, numberPrefixSymbolUrl, setCode, price, border, size = 'sm', bare = false,
  missingStyle = getCardVisualTheme().missingStyle,
  cornerRadius = getCardVisualTheme().cornerRadius[size],
  badgeLayout = getCardVisualTheme().badgeLayout[size],
  selectMode = false, selectable = false, selected = false, onToggleSelect,
}: Props) {
  // Abonniert das geteilte Karten-Theme nur, damit diese Komponente neu
  // rendert (und die obigen Default-Parameter frische Werte lesen), wenn die
  // Testseite (`/design-system-preview`) "Speichern" drückt oder das Theme
  // beim App-Start hydriert wird — der Rückgabewert selbst wird hier nicht
  // gebraucht (analog zu `useGlassTheme()` in `components/ui/button.tsx`).
  useCardVisualTheme();
  const heartGradId = useId();
  const preset = CARD_SIZE_PRESETS[size];
  const radius = cornerRadius;
  // Rundung der abgerundeten Badge-Diagonal-Ecken = Karten-Radius: das Badge
  // sitzt bündig in der Kartenecke (Offset 0), seine Außen-Ecke muss also exakt
  // so stark gerundet sein wie die Kartenecke, damit beide Kurven konzentrisch
  // ineinander liegen (vorher 1,5× → Badge runder als die Karte → Versatz).
  const badgeCornerRadius = radius;
  const layout = badgeLayout;
  const totalOwned    = ownedCards.reduce((s, c) => s + c.quantity, 0);
  const isOwned       = totalOwned > 0;
  const needsReview   = ownedCards.some(c => c.needsReview);
  // Holo-Glanz (nur bei Besitz — der „fehlt"-Look hat einen eigenen Hologramm-
  // Effekt): Holo glänzt auf dem Artwork, Reverse Holo auf dem Rahmen (Pokémon-
  // Bild bleibt frei). Beides kann gleichzeitig gelten (Karte in beiden
  // Varianten besessen) → beide Ebenen ergeben zusammen „ganze Karte glänzt".
  // Eindeutig Foil, wenn (a) ein besessenes Exemplar holo/reverse ist ODER
  // (b) die Karte im Katalog NUR als Holo/Reverse existiert (kein `standard`) —
  // dann glänzt sie überall, auch unbesessen (siehe inherentFoilVariant).
  const inherentFoil    = inherentFoilVariant(card.variants);
  const showHolo        = ownedCards.some(c => c.variant === 'holo')    || inherentFoil === 'holo';
  const showReverse     = ownedCards.some(c => c.variant === 'reverse') || inherentFoil === 'reverse';
  // Sprach-Marker: der Nutzer sammelt auf Deutsch. Besitzt er eine Karte NUR in
  // anderen Sprachen (kein einziges deutsches Exemplar), wird sie mit einem
  // amber Sprach-Badge markiert = „noch auf Deutsch zu ersetzen". Deutsche
  // Karten (oder gemischter Besitz mit mind. einem DE-Exemplar) bleiben
  // unmarkiert. `de` als Sprache fehlend behandeln wir wie Nicht-Deutsch.
  const ownedLanguages   = Array.from(new Set(ownedCards.map(c => c.language)));
  const ownedForeignOnly = isOwned && !ownedLanguages.includes('de');
  const foreignLangCode  = ownedForeignOnly ? (ownedLanguages[0] ?? '').toUpperCase() : '';

  return (
    <div className="relative flex flex-col">
      {/* Card image — tap → Detail (öffnet dort auch den "Prüfen"-Button je Exemplar).
          Kein `overflow-hidden` auf diesem äußeren Wrapper — Badges sind
          Geschwister des gerundeten Bild-Wrappers darunter, dürfen also über
          den Kartenrand hinausragen. `shadow-card` folgt trotzdem der
          Rundung, da `box-shadow` sich am eigenen `border-radius` orientiert
          und dafür kein Clipping braucht. */}
      <div
        className={`relative ${selectMode && !selectable ? '' : 'cursor-pointer'} ${bare ? '' : 'shadow-card'}`}
        style={{
          borderRadius: radius,
          opacity: selectMode && selectable && !selected ? 0.6 : undefined,
          boxShadow: selectMode && selected ? '0 0 0 3px var(--pokedex-blue)' : undefined,
          transition: 'opacity 150ms ease-out, box-shadow 150ms ease-out',
        }}
        onClick={selectMode ? (selectable ? onToggleSelect : undefined) : onCardClick}
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
            placeholderInfo={{
              name: card.name,
              hp: card.hp,
              number: card.number,
              total: card.printedTotal ?? card.total,
              dexNumber: card.nationalDexNumber,
              setCode: card.setCode,
              types: card.types,
              pending: card.pendingCatalog,
            }}
          />
          {/* Hologramm-Schimmer — nur bei diesem einen Effekt, animiertes
              Regenbogen-Band per `mix-blend-mode`, reine Deko-Ebene über dem
              (bereits gefilterten) Bild. Reagiert auf reduzierte Bewegung
              über `.missing-card-hologram` (globals.css). */}
          {!isOwned && missingStyle.effect === 'hologram' && (
            <div className="absolute inset-0 missing-card-hologram" aria-hidden="true" />
          )}
          {/* Holo-Glanz (siehe `.card-holo-shimmer` in globals.css):
              Holo → Artwork-Fenster, Reverse Holo → Rahmen (Bild bleibt frei). */}
          {showHolo && (
            <div className={`absolute inset-0 ${holoShimmerClass('holo', card.rarity, card.subtypes)}`} aria-hidden="true" />
          )}
          {showReverse && (
            <div className={`absolute inset-0 ${holoShimmerClass('reverse', card.rarity, card.subtypes)}`} aria-hidden="true" />
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

        {/* Prüfen-Badge — gelb, oben links, nur bei ungeprüften eigenen
            Exemplaren. Vorläufige (nicht im Katalog gefundene) Karten bekommen
            KEIN Badge hier: ihr Platzhalter (CardPlaceholder) zeichnet bereits
            ein eigenes rotes „?"-Eck-Badge (gleiche Form wie dieses „!"). */}
        {!bare && !card.pendingCatalog && needsReview && (
          <CardBadge
            size={preset.badgeSize} color="var(--pokedex-yellow)" corner="tl" cornerRadius={badgeCornerRadius}
            style={{ top: layout.reviewBadge.top, left: layout.reviewBadge.left }}
            ariaLabel="Ungeprüft" title="Ungeprüft"
          >
            <ExclamationMark size={preset.badgeIconSize} strokeWidth={3} className="text-white" />
          </CardBadge>
        )}

        {/* Sprach-Badge — Länderflagge, oben links (gleiche Ecke wie „Prüfen",
            per !needsReview kollisionsfrei). Nur wenn die Karte ausschließlich in
            einer anderen Sprache als Deutsch besessen wird → Signal „noch auf
            Deutsch besorgen/ersetzen". `elevated` = weißer Ring + Schatten für
            Ablesbarkeit über dem Artwork. */}
        {!bare && ownedForeignOnly && !needsReview && (
          <span
            className="absolute"
            style={{ top: layout.reviewBadge.top, left: layout.reviewBadge.left }}
            aria-label={`Nur in ${foreignLangCode} vorhanden — noch nicht auf Deutsch`}
            title="Nicht auf Deutsch"
          >
            <LanguageFlag lang={ownedLanguages[0]} size={preset.badgeSize} elevated />
          </span>
        )}

        {/* Anzahl-Badge — grün, oben rechts. Nur ab 2 Exemplaren; bei genau
            einer Karte reicht die Voll-Farbe (fehlende sind ausgegraut) als
            Besitz-Anzeige, ein „×1" wäre redundant. */}
        {!bare && totalOwned > 1 && (
          <CardBadge size={preset.badgeSize} color="rgba(53,209,90,.9)" corner="tr" cornerRadius={badgeCornerRadius} style={{ top: layout.ownedBadge.top, right: layout.ownedBadge.right }}>
            ×{totalOwned}
          </CardBadge>
        )}

        {/* Preis — unten links, Pillenform statt Kreis (siehe CardBadge shape="pill"). */}
        {!bare && price && (
          <CardBadge
            size={preset.badgeSize} shape="pill" color="rgba(0,0,0,.72)" corner="bl" cornerRadius={badgeCornerRadius}
            style={{ bottom: layout.priceBadge.bottom, left: layout.priceBadge.left }}
            ariaLabel="Preis"
          >
            {price}
          </CardBadge>
        )}

        {/* Wunschlisten-Herz — nur Herzform, kein Button-Hintergrund. IMMER
            sichtbar (4 Zustände): leer = auf keiner Liste, rot = manuell,
            weiß = automatisch (von irgendeiner Auto-Sammlung benötigt),
            geteilt (links rot/rechts weiß) = beides. Tap öffnet i.d.R. den
            Auswahl-Drawer (`onHeartClick`). */}
        {!bare && (
          <CardBadge
            size={preset.badgeSize} background={false}
            style={{ bottom: layout.wishlistBadge.bottom, right: layout.wishlistBadge.right }}
            onClick={onHeartClick ? (e => { e.stopPropagation(); onHeartClick(); }) : undefined} // stoppt Click-Bubbling zum Detail
            ariaLabel="Wunschliste"
          >
            <WishlistHeart
              manual={onManualWishlist}
              auto={onAutoWishlist}
              width={preset.badgeIconSize * 1.3}
              height={preset.badgeIconSize * 1.2}
              gradId={`${heartGradId}-heart`}
            />
          </CardBadge>
        )}

        {/* Auswahl-Häkchen (Auswahl-Modus, nur auswählbare/besessene Karten) */}
        {selectMode && selectable && (
          <div
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center pointer-events-none"
            style={selected
              ? { background: 'var(--pokedex-blue)', color: '#fff' }
              : { background: 'rgba(0,0,0,.45)', border: '1.5px solid rgba(255,255,255,.85)' }}
            aria-hidden
          >
            {selected && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </div>
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
