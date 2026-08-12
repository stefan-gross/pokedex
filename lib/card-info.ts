/**
 * CardInfo — gemeinsamer normalisierter Kartentyp.
 * Wird aus CatalogCard (TCGdex-Katalog in Firestore) erzeugt.
 * Alle Komponenten (CardTile, CardGrid, CardDetailSheet) arbeiten mit diesem Typ.
 */

import type { CatalogCard } from '@/lib/firestore/catalog';
import type { CardVariant, CardDoc, CardCondition, CardLanguage, CardAttack, CardAbility, CardWeakRes } from '@/types';

export interface CardInfo {
  id: string;
  name: string;
  /** Roher englischer Name — nur gesetzt, wenn `name` bereits die deutsche
   *  Übersetzung ist (Anzeige app-weit: "Englisch (Deutsch)"). */
  nameEn?: string;
  number: string;
  rarity?: string;
  supertype?: string;
  subtypes?: string[];
  types?: string[];
  setId: string;
  setName: string;
  series?: string;
  setCode?: string;   // ptcgoCode z.B. "PAF"
  total?: number;
  printedTotal?: number;
  imgSmall: string;
  imgLarge: string;
  imgSmallDe?: string;
  imgLargeDe?: string;
  variants?: CardVariant[];
  genusDe?: string;
  flavorTextDe?: string;
  heightDm?: number;
  weightHg?: number;
  region?: string;
  hp?: number;
  nationalDexNumber?: number;
  evolutionFamily?: number[];
  artist?: string;
  // TCG-Kartenmechanik (von TCGdex, nur wenn im Katalog vorhanden)
  effect?: string;
  trainerType?: string;
  attacks?: CardAttack[];
  abilities?: CardAbility[];
  weaknesses?: CardWeakRes[];
  resistances?: CardWeakRes[];
  retreat?: number;
  /** true = vorläufige Karte ohne Katalog-Eintrag (kein Bild). Rendert einen
   *  Platzhalter (CardImage → CardPlaceholder) und ein rotes „?"-Badge. */
  pendingCatalog?: boolean;
}

/** Leitet die deutsche TCGdex-Bild-URL aus der englischen ab (/en/ → /de/).
 *  Nur für TCGdex-CDN-URLs; selbst gehostete/Backfill-URLs bleiben unangetastet.
 *  So wird die DE-URL beim Lesen konstruiert (nicht im Sync gespeichert), damit
 *  ein Re-Sync selbst gehostete deutsche Bilder nie überschreibt. */
function deImageUrl(stored: string | undefined, en: string): string | undefined {
  if (stored) return stored;                        // gespeichert (z.B. Backfill) hat Vorrang
  if (en.includes('assets.tcgdex.net/en/')) return en.replace('/en/', '/de/');
  return undefined;
}

export function catalogCardToInfo(c: CatalogCard): CardInfo {
  return {
    id: c.id,
    name: c.nameDe ?? c.name,
    nameEn: c.nameDe ? c.name : undefined,
    number: c.number,
    rarity: c.rarity,
    supertype: c.supertype,
    subtypes: c.subtypes,
    types: c.types,
    setId: c.setId,
    setName: c.setName,
    series: c.series,
    setCode: c.setCode,
    imgSmall: c.imgSmall,
    imgLarge: c.imgLarge,
    imgSmallDe: deImageUrl(c.imgSmallDe, c.imgSmall),
    imgLargeDe: deImageUrl(c.imgLargeDe, c.imgLarge),
    variants: c.variants,
    genusDe: c.genusDe,
    flavorTextDe: c.flavorTextDe,
    heightDm: c.heightDm,
    weightHg: c.weightHg,
    region: c.region,
    hp: c.hp,
    nationalDexNumber: c.nationalDexNumber,
    evolutionFamily: c.evolutionFamily,
    artist: c.artist,
    effect: c.effect,
    trainerType: c.trainerType,
    attacks: c.attacks,
    abilities: c.abilities,
    weaknesses: c.weaknesses,
    resistances: c.resistances,
    retreat: c.retreat,
  };
}

/** Baut eine `CardInfo` aus einer vorläufigen (nicht katalogisierten) `CardDoc`.
 *  Bild-URLs bleiben leer → `CardImage` fällt auf `CardPlaceholder` zurück, das
 *  aus diesen Feldern (Name/KP/Nummer/Total/Dex/Set-Code) gezeichnet wird.
 *  `pendingCatalog:true` steuert zusätzlich das rote „?"-Badge. */
export function pendingCardInfo(doc: CardDoc): CardInfo {
  const m = doc.manualData;
  return {
    id: doc.id,
    name: m?.name ?? doc.name,
    number: m?.number ?? doc.number,
    setId: doc.setId,
    setName: doc.setName || m?.setCode || '?',
    setCode: m?.setCode,
    printedTotal: m?.printedTotal,
    hp: m?.hp,
    nationalDexNumber: m?.dexNumber,
    imgSmall: '',
    imgLarge: '',
    pendingCatalog: true,
  };
}

/** Löst eine eigene Karte (`CardDoc`) für die Anzeige in eine `CardInfo` auf —
 *  der Katalog ist die Quelle der Wahrheit für Bild + Metadaten:
 *   - Pending (nicht katalogisiert) → `pendingCardInfo` (Platzhalter aus manualData)
 *   - regulär → der LIVE-Katalog-Eintrag (`catalogById`, per `tcgId`) → aktuelles
 *     DE/EN-Bild inkl. selbst gehosteter Storage-Bilder, statt eingefrorener URL
 *   - Ausnahme „kein Katalog-Treffer" (z.B. entferntes Set) → minimale Info aus
 *     dem CardDoc mit leeren Bildern → `CardImage` zeigt den Platzhalter.
 *  `catalogById` baut der Aufrufer einmalig via `getCatalogCardsByIds` +
 *  `catalogCardToInfo` (siehe z.B. Dashboard/Binder-Detail). */
export function ownedCardToInfo(doc: CardDoc, catalogById: Map<string, CardInfo>): CardInfo {
  if (doc.pendingCatalog) return pendingCardInfo(doc);
  const cat = doc.tcgId ? catalogById.get(doc.tcgId) : undefined;
  if (cat) return cat;
  return {
    id: doc.tcgId ?? doc.id,
    name: doc.name,
    number: doc.number,
    rarity: doc.rarity,
    supertype: doc.supertype,
    types: doc.pokemonType ? [doc.pokemonType] : undefined,
    setId: doc.setId,
    setName: doc.setName,
    series: doc.series,
    imgSmall: '',
    imgLarge: '',
  };
}

/** Baut das `addCard`-Eingabeobjekt aus einer `CardInfo` — zentral für alle
 *  Save-Pfade (Scanner-Auto-Save, Add-/Bulk-Modal). Behandelt vorläufige Karten
 *  (`pendingCatalog`): kein `tcgId`/Bild, stattdessen `manualData` (Rohwerte für
 *  Anzeige + spätere Verknüpfung) und das Flag. Reguläre Karten wie bisher mit
 *  `tcgId` + Katalogbild. `ignoreUndefinedProperties` (Firestore-Client) strippt
 *  leere Felder inkl. verschachtelter `manualData`-Werte. */
export function cardInfoToAddInput(
  card: CardInfo,
  opts: { variant: CardVariant; condition: CardCondition; language: CardLanguage; needsReview?: boolean },
): Omit<CardDoc, 'id' | 'addedAt' | 'updatedAt'> {
  const { variant, condition, language, needsReview } = opts;
  const base: Omit<CardDoc, 'id' | 'addedAt' | 'updatedAt'> = {
    name: card.name,
    setId: card.setId,
    setName: card.setName,
    series: card.series,
    number: card.number,
    rarity: card.rarity,
    pokemonType: card.types?.[0],
    supertype: card.supertype,
    variant,
    condition,
    language,
    quantity: 1,
  };
  if (card.pendingCatalog) {
    // Rotes „?"-Badge ersetzt das Review-„!" → kein needsReview für Pending.
    return {
      ...base,
      pendingCatalog: true,
      manualData: {
        name: card.name,
        hp: card.hp,
        setCode: card.setCode,
        number: card.number || undefined,
        printedTotal: card.printedTotal,
        dexNumber: card.nationalDexNumber,
        language,
      },
    };
  }
  return {
    ...base,
    tcgId: card.id,
    // Kein eingefrorenes Bild mehr — die Anzeige joint live über `tcgId` den
    // Katalog (siehe ownedCardToInfo). Katalog = Quelle der Wahrheit.
    ...(needsReview ? { needsReview: true } : {}),
  };
}
