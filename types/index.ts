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

export interface BinderDoc {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  /** 'binder' = Ordner mit fester Seitengröße, 'box' = offene Box ohne Größenlimit */
  collectionType?: 'binder' | 'box';
  size?: 9 | 12 | 16 | 18;   // nur bei collectionType === 'binder'
  isDefault?: boolean;
  /** „Neue Karten"-Inbox: Auffang für ungespeicherte Scans beim Verlassen des Scanners. Wird ausgeblendet wenn leer. */
  isInbox?: boolean;
  sortOrder: number;
  cardIds: string[];
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
