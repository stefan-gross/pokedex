import { Timestamp } from 'firebase/firestore';

export type CardCondition = 'NM' | 'LP' | 'MP' | 'HP' | 'Poor';
export type CardLanguage = 'de' | 'en' | 'jp' | 'fr' | 'es';
export type CardVariant = 'standard' | 'holo' | 'reverse' | 'alt-art' | '1st-ed' | 'promo';

// ── TCG-Karten-Mechanik (von TCGdex, nur wenn vorhanden) ────────────────────
/** Attacke einer Pokémon-Karte. `cost` = Energiesymbole (EN-Namen, z.B. "Fire"). */
export interface CardAttack { name: string; effect?: string; damage?: string; cost?: string[]; }
/** Fähigkeit/Pokémon-Power einer Karte. `type` z.B. "Ability" | "Pokemon Power". */
export interface CardAbility { name: string; effect?: string; type?: string; }
/** Schwäche/Resistenz: `type` = Energietyp (EN-Name), `value` z.B. "×2" | "-30". */
export interface CardWeakRes { type: string; value: string; }

export interface CardDoc {
  id: string;
  /** Firebase-uid des Besitzers (IDOR-Härtung). Optional, bis der Bestand
   *  gebackfillt ist; danach auf allen Docs gesetzt. */
  ownerUid?: string;
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
  quantity: number;
  notes?: string;
  needsReview?: boolean;   // true = per Scanner hinzugefügt, noch nicht manuell geprüft
  /** true = gescannt, aber (noch) nicht im TCGdex-Katalog gefunden. Die Karte
   *  existiert ohne `tcgId`/Katalogbild; angezeigt wird ein generierter
   *  Platzhalter aus `manualData`. Ein späterer Katalog-Sync verknüpft sie
   *  automatisch (siehe lib/scan/reconcile-pending.ts), dann fällt das Flag
   *  weg und echtes Bild/Preis erscheinen. */
  pendingCatalog?: boolean;
  /** Von Gemini gelesene Rohwerte einer vorläufigen Karte — Quelle für die
   *  Platzhalter-Anzeige UND die spätere Katalog-Verknüpfung. */
  manualData?: {
    name: string;
    hp?: number;
    setCode?: string;
    number?: string;
    printedTotal?: number;
    dexNumber?: number;
    language?: CardLanguage;
  };
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
  /** Firebase-uid des Besitzers (IDOR-Härtung, siehe CardDoc.ownerUid). */
  ownerUid?: string;
  /** Vorlagen-Sammlungen: persistierte Gesamt-Slotzahl (beim Sync geschrieben),
   *  damit die Übersichts-Kachel „x / N" ohne eigenen Katalog-Scan zeigt (A1). */
  slotTotal?: number;
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
  /** Firebase-uid des Besitzers (IDOR-Härtung, siehe CardDoc.ownerUid). */
  ownerUid?: string;
  name: string;
  description?: string;
  /** Vorhanden = automatisch generierte Wunschliste eines Vorlagen-Binders
   *  (Zurückverweis auf BinderDoc.id) — Items werden von
   *  `syncTemplateBinders()` verwaltet, nicht manuell entfernbar. Fehlt =
   *  normale/freie Wunschliste (heutiges Standardverhalten). */
  templateBinderId?: string;
  /** Vorhanden = automatisch generierte Wunschliste eines Decks (fehlende
   *  Deck-Karten, verwaltet von der Deck-Sync-Logik, nicht manuell entfernbar) —
   *  Zwilling zu `templateBinderId`. Fehlt = normale/freie Wunschliste. */
  deckId?: string;
  /** Nutzer-Reihenfolge der manuellen Listen (DnD in der Übersicht). Fehlt bei
   *  Altbestand/automatischen Listen → sortieren ans Ende. */
  sortOrder?: number;
  /** Icon-String wie bei BinderDoc.icon (folder/box/`type:`/`set:`/`pokemon:`/
   *  Lucide-Key) — wird über `BinderIcon` gerendert. Fehlt → Herz-Fallback. */
  icon?: string;
  /** Akzentfarbe (Hex) wie bei BinderDoc.color. Fehlt → gedämpftes Glas. */
  color?: string;
  createdAt: Timestamp;
  items: WishlistItem[];
}

// ── Decks (Deckverwaltung) ────────────────────────────────────────────────
// Spielbare 60-Karten-TCG-Decks. Eigene Collection `decks` (NICHT binders —
// Binder referenzieren physische cards-Docs mit Exklusivität; Decks referenzieren
// Katalog-IDs rein referenziell, Mehrfachnutzung erlaubt). Siehe Feature-Plan
// in .claude/plans/plan.md.

export type DeckFormat = 'standard' | 'expanded' | 'unlimited';

/** Ein Rezept-Eintrag: Referenz auf einen KONKRETEN Katalog-Druck + Anzahl.
 *  Rein referenziell — keine Bindung an ein physisches Sammlungs-Exemplar,
 *  dieselbe Karte darf in mehreren Decks stehen. */
export interface DeckCardRef {
  /** tcg_catalog Doc-ID, z.B. "sv04-125". */
  catalogId: string;
  /** Anzahl im Deck. Die Regel-Engine erzwingt die Obergrenzen (max. 4 gleiche
   *  Karte per Name; Basis-Energie unbegrenzt) — das Schema selbst begrenzt nicht. */
  count: number;
  // Denormalisierte ANZEIGE-Felder (wie WishlistItem) — für Kategorien/Übersicht/
  // PTCGL-Export und robust, falls ein Katalog-Doc verschwindet. Preis/Legalität
  // werden bewusst NICHT eingefroren (Detail/Stats laden den Katalog frisch).
  /** nameDe ?? name zum Zeitpunkt des Hinzufügens. */
  name: string;
  /** Set-ID (→ ptcgoCode via tcg_sets für PTCGL-Export) + Anzeige. */
  setId: string;
  number: string;
  /** 'Pokémon' | 'Trainer' | 'Energy' — für Kategorie-Gruppierung + Statistik. */
  supertype: string;
}

export interface DeckDoc {
  id: string;
  /** Firebase-uid des Besitzers (IDOR-Härtung, siehe CardDoc.ownerUid). */
  ownerUid?: string;
  name: string;
  /** Notiz. */
  description?: string;
  /** Akzentfarbe (Hex), wie BinderDoc.color. */
  color?: string;
  /** Icon-String wie BinderDoc.icon (folder/box/`type:`/`set:`/`pokemon:`/Lucide),
   *  gerendert über BinderIcon. */
  icon?: string;
  /** Optional: Katalog-ID einer Deckkarte, deren Artwork als Deck-Cover dient. */
  coverCardId?: string;
  format: DeckFormat;
  /** Das Rezept: konkrete Katalog-Drucke + Anzahl. */
  cards: DeckCardRef[];
  /** Nutzer-Reihenfolge in der Übersicht (DnD), wie binders/wishlists. */
  sortOrder?: number;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
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
