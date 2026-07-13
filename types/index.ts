import { Timestamp } from 'firebase/firestore';

export type CardCondition = 'NM' | 'LP' | 'MP' | 'HP' | 'Poor';
export type CardLanguage = 'de' | 'en' | 'jp' | 'fr';
export type CardVariant = 'standard' | 'holo' | 'reverse' | 'alt-art' | '1st-ed' | 'promo';

export interface CardDoc {
  id: string;
  tcgId?: string;
  name: string;
  setId: string;
  setName: string;
  series?: string;
  number: string;
  rarity?: string;
  pokemonType?: string;
  supertype?: string;
  variant: CardVariant;
  condition: CardCondition;
  language: CardLanguage;
  isFoil: boolean;
  isFirstEd: boolean;
  quantity: number;
  tcgImageUrl?: string;
  notes?: string;
  needsReview?: boolean;   // true = per Scanner hinzugefügt, noch nicht manuell geprüft
  addedAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BinderPage {
  /** Länge = binder.size. Eintrag ist eine CardDoc-ID oder null für leeren Slot. */
  slots: (string | null)[];
}

/** Vorlagen-Binder: Regel statt manueller Kartenliste. Karten werden von
 *  `syncTemplateBinders()` (lib/template-binders/sync.ts) automatisch
 *  ein-/aussortiert — Nutzer können den Binder nicht manuell bearbeiten.
 *  `familyDexNumbers` wird bei Erstellung einmalig per PokéAPI aufgelöst
 *  und gecacht (kein wiederholter PokéAPI-Call bei jedem Sync). */
export type BinderTemplate =
  | { type: 'artist'; artist: string }
  | { type: 'pokedex' }
  /** Ein oder mehrere Pokédex-Nummern (mehrere = inkl. Entwicklungslinie) —
   *  EIN Slot pro existierendem Druck (keine Gruppierung/Slot-Gewinner-
   *  Auswahl wie bei "pokedex", jede Variante/Promo/VMAX/... bekommt ihre
   *  eigene Kachel). */
  | { type: 'pokemon'; dexNumbers: number[] }
  | { type: 'masterSet'; setId: string };

export interface BinderDoc {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  /** 'binder' = Ordner mit fester Seitengröße, 'box' = offene Box ohne Größenlimit */
  collectionType?: 'binder' | 'box';
  size?: 4 | 9 | 12 | 16 | 18;   // Seitenlayout, nur bei collectionType === 'binder'
  /** Optionale Gesamt-Kartenanzahl, die in den Binder passt (z.B. 400). Unabhängig vom Seitenlayout.
   *  `null` = wurde explizit gelöscht (für Update-Schreibungen); `undefined`/Feld fehlt = nie gesetzt. */
  capacity?: number | null;
  /** Positionales Seiten-Layout. Wenn undefined: Legacy-Binder, Slots werden aus cardIds[]
   *  in Reihenfolge generiert. Jede Seite hat exakt `size` Slots, leere Slots sind null. */
  pages?: BinderPage[];
  /** Hintergrund der Binder-Seiten: 'black' (default, dunkler Binder), 'white' (weißer Binder),
   *  'transparent' (App-Hintergrund scheint durch). */
  pageBackground?: 'black' | 'white' | 'transparent';
  isDefault?: boolean;
  /** „Eingang"-Inbox: Auffang für ungespeicherte Scans beim Verlassen des Scanners. Wird ausgeblendet wenn leer. */
  isInbox?: boolean;
  /** Vorhanden = Vorlagen-Binder (automatisch befüllt, gesperrt für manuelle
   *  Bearbeitung). Fehlt = normaler manueller Binder (Standardfall). */
  template?: BinderTemplate;
  sortOrder: number;
  cardIds: string[];
  /** @deprecated Totes Feld — wird geschrieben (addWishlistCardToBinder), aber
   *  nirgends außer für einen Zähler-Badge gelesen. Nicht für neue Features
   *  verwenden (siehe lib/firestore/wishlists.ts + WishlistDoc.templateBinderId
   *  für die echte Wunschlisten-Anbindung). */
  wishlistCardIds: string[];
  createdAt: Timestamp;
}

export interface WishlistItem {
  id: string;
  tcgId?: string;
  name: string;
  setName?: string;
  setId?: string;
  number?: string;
  tcgImageUrl?: string;
  maxPrice?: number;
  priority: 1 | 2 | 3;
  notes?: string;
  acquired: boolean;
}

export interface WishlistDoc {
  id: string;
  name: string;
  description?: string;
  /** Vorhanden = automatisch generierte Wunschliste eines Vorlagen-Binders
   *  (Zurückverweis auf BinderDoc.id) — Items werden von
   *  `syncTemplateBinders()` verwaltet, nicht manuell entfernbar. Fehlt =
   *  normale/freie Wunschliste (heutiges Standardverhalten). */
  templateBinderId?: string;
  createdAt: Timestamp;
  items: WishlistItem[];
}

export interface PriceHistoryDoc {
  id: string;
  price: number;
  currency: 'EUR';
  source: 'cardmarket';
  trend: 'trendPrice' | 'lowPrice' | 'avgSellPrice';
  condition?: string;
  recordedAt: Timestamp;
}

export interface TcgCard {
  id: string;
  name: string;
  number: string;
  set: { id: string; name: string; series: string; total: number };
  rarity?: string;
  types?: string[];
  supertype?: string;
  images: { small: string; large: string };
  variants?: CardVariant[];
}

export interface PokemonSummary {
  id: number;
  name: string;
  sprite: string;
  types: string[];
}
