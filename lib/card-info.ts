/**
 * CardInfo — gemeinsamer normalisierter Kartentyp.
 * Wird aus CatalogCard (TCGdex-Katalog in Firestore) erzeugt.
 * Alle Komponenten (CardTile, CardGrid, CardDetailSheet) arbeiten mit diesem Typ.
 */

import type { CatalogCard } from '@/lib/firestore/catalog';
import type { CardVariant } from '@/types';

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
  };
}
