/**
 * CardInfo — gemeinsamer normalisierter Kartentyp.
 * Wird aus CatalogCard (Firestore) oder TcgApiCard (pokemontcg.io API) erzeugt.
 * Alle Komponenten (CardTile, CardGrid, CardDetailSheet) arbeiten mit diesem Typ.
 */

import type { TcgApiCard } from '@/lib/pokemon-tcg';
import type { CatalogCard } from '@/lib/firestore/catalog';
import type { CardVariant } from '@/types';

export interface CardInfo {
  id: string;
  name: string;
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
}

export function catalogCardToInfo(c: CatalogCard): CardInfo {
  return {
    id: c.id,
    name: c.nameDe ?? c.name,
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
  };
}

export function tcgApiCardToInfo(c: TcgApiCard): CardInfo {
  return {
    id: c.id,
    name: c.name,
    number: c.number,
    rarity: c.rarity,
    supertype: c.supertype,
    subtypes: c.subtypes,
    types: c.types,
    setId: c.set.id,
    setName: c.set.name,
    series: c.set.series,
    total: c.set.total,
    printedTotal: c.set.printedTotal,
    imgSmall: c.images.small,
    imgLarge: c.images.large,
    setCode: c.set.ptcgoCode,
  };
}

/** Rückkonvertierung für AddToCollectionModal (akzeptiert noch TcgApiCard) */
export function cardInfoToTcgApi(c: CardInfo): TcgApiCard {
  return {
    id: c.id,
    name: c.name,
    number: c.number,
    rarity: c.rarity,
    supertype: c.supertype,
    types: c.types,
    set: {
      id: c.setId,
      name: c.setName,
      series: c.series ?? '',
      total: c.total ?? 0,
      printedTotal: c.printedTotal ?? c.total ?? 0,
    },
    images: { small: c.imgSmall, large: c.imgLarge },
  };
}
