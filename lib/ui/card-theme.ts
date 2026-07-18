'use client';

import { useSyncExternalStore } from 'react';

/**
 * Analog zu `lib/ui/glass-theme.ts`, aber für `Card`/`CardTile`
 * (`components/card/Card.tsx`): "fehlt"-Look (Transparenz/Blur/Sättigung/
 * Effekt) + pro Größe (`sm`/`md`/`lg`) Ecken-Radius und Badge-Layout. Gleiches
 * Prinzip — die Design-System-Testseite hält einen lokalen ENTWURF
 * (`useState`, initial aus `getCardVisualTheme()`), Regler ändern nur den
 * Entwurf; erst ein Klick auf "Speichern" schreibt ihn per
 * `setCardVisualTheme()` in diesen Store (→ localStorage + sofort sichtbar
 * für jede echte `Card`-Instanz app-weit). "Zurücksetzen" verwirft den
 * Entwurf wieder auf den zuletzt gespeicherten Stand (`getCardVisualTheme()`),
 * NICHT auf die Werkseinstellungen — siehe `DEFAULT_CARD_VISUAL_THEME` dafür.
 */
export type CardSize = 'sm' | 'md' | 'lg';

export type MissingCardEffect = 'flat' | 'invert' | 'sepia' | 'xray' | 'hologram' | 'outline';

export const MISSING_CARD_EFFECTS: { value: MissingCardEffect; label: string }[] = [
  { value: 'flat', label: 'Standard' },
  { value: 'invert', label: 'Invertiert' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'xray', label: 'Röntgen' },
  { value: 'hologram', label: 'Hologramm' },
  { value: 'outline', label: 'Silhouette' },
];

export interface MissingCardStyle { opacity: number; blur: number; saturate: number; effect: MissingCardEffect }

export interface CardTileBadgeLayout {
  setBadge: { top: number; left: number };
  ownedBadge: { top: number; right: number };
  reviewBadge: { bottom: number; right: number };
  wishlistBadge: { bottom: number; right: number };
}

export interface CardVisualTheme {
  missingStyle: MissingCardStyle;
  cornerRadius: Record<CardSize, number>;
  badgeLayout: Record<CardSize, CardTileBadgeLayout>;
}

function badgeLayoutForOffset(o: number): CardTileBadgeLayout {
  return {
    setBadge: { top: o, left: o }, ownedBadge: { top: o, right: o },
    reviewBadge: { bottom: o, right: o }, wishlistBadge: { bottom: o, right: o },
  };
}

export const DEFAULT_MISSING_CARD_STYLE: MissingCardStyle = { opacity: 0.62, blur: 0, saturate: 0.3, effect: 'flat' };

// Entspricht den bisherigen Fixwerten aus `components/card/Card.tsx`
// (`CARD_SIZE_PRESETS`) — diese Konstante ist jetzt die kanonische Quelle.
export const DEFAULT_CARD_VISUAL_THEME: CardVisualTheme = {
  missingStyle: DEFAULT_MISSING_CARD_STYLE,
  cornerRadius: { sm: 8, md: 10, lg: 14 },
  badgeLayout: {
    sm: badgeLayoutForOffset(-6),
    md: badgeLayoutForOffset(-8),
    lg: badgeLayoutForOffset(-10),
  },
};

/** Werkseitiger Badge-Layout-Default für eine Größe — von der Testseite für
 *  den Doppelklick-Reset einzelner Badge-Slider genutzt. */
export function defaultBadgeLayoutFor(size: CardSize): CardTileBadgeLayout {
  return DEFAULT_CARD_VISUAL_THEME.badgeLayout[size];
}

/** Rückwärtskompatibler Export — bisherige `sm`-Defaults, von `CardTile.tsx`
 *  weitergereicht. */
export const DEFAULT_CARD_TILE_BADGE_LAYOUT: CardTileBadgeLayout = DEFAULT_CARD_VISUAL_THEME.badgeLayout.sm;

const STORAGE_KEY = 'pokedex-card-theme-override';

let state: CardVisualTheme = DEFAULT_CARD_VISUAL_THEME;
const listeners = new Set<() => void>();

function persist(next: CardVisualTheme) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* z.B. privater Modus — gilt dann nur für die Session */ }
}

/** Einmal beim App-Start aufgerufen (siehe `GlassThemeHydrator` im Root-
 *  Layout) — liest einen evtl. gespeicherten Override aus diesem Browser. */
export function hydrateCardVisualTheme() {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch { /* kaputtes/altes Format ignorieren, bei Default bleiben */ }
  listeners.forEach(l => l());
}

export function getCardVisualTheme(): CardVisualTheme {
  return state;
}

export function setCardVisualTheme(updater: CardVisualTheme | ((prev: CardVisualTheme) => CardVisualTheme)) {
  state = typeof updater === 'function' ? (updater as (p: CardVisualTheme) => CardVisualTheme)(state) : updater;
  persist(state);
  listeners.forEach(l => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reaktiver Hook — `Card` abonniert hierüber, damit sie nach einem
 *  "Speichern" auf der Testseite (oder nach dem Hydrieren beim App-Start)
 *  neu rendert und die frischen Werte zeigt. */
export function useCardVisualTheme(): [CardVisualTheme, typeof setCardVisualTheme] {
  const theme = useSyncExternalStore(subscribe, getCardVisualTheme, () => DEFAULT_CARD_VISUAL_THEME);
  return [theme, setCardVisualTheme];
}
