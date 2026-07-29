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
    imgSmallDe: c.imgSmallDe,
    imgLargeDe: c.imgLargeDe,
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
