/**
 * Preis-Provider auf TCGdex-Basis (ersetzt pokemontcg.ts). Preise stehen im
 * `pricing`-Feld jeder Karte (REST `/v2/en/cards/{id}`):
 *  - Cardmarket (EUR): ein Block mit `avg/low/trend` (Standard) + `*-holo`-Suffix.
 *    Der `-holo`-Suffix ist bei Cardmarket der **Reverse-Holo**-Preis (Foil-
 *    Parallele der Karte) — es gibt KEINEN `-reverse`-Suffix.
 *  - TCGplayer (USD): Untertypen `normal`/`holofoil`/`reverseHolofoil`/… mit
 *    `lowPrice/midPrice/highPrice/marketPrice`.
 * Cardmarket wird bevorzugt (EUR), sonst TCGplayer.
 */

import type { IPriceProvider, PriceResult, PriceVariant } from './types';
import { TransientPriceError } from './types';

const CARDS = 'https://api.tcgdex.net/v2/en/cards';
const SETS = 'https://api.tcgdex.net/v2/en/sets';

interface CmBlock { updated?: string; [k: string]: unknown }
interface TpVariant { lowPrice?: number; midPrice?: number; highPrice?: number; marketPrice?: number }
interface TcgdexPricing {
  cardmarket?: CmBlock;
  tcgplayer?: { unit?: string; updated?: string; [variant: string]: unknown };
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined);

/** Cardmarket-Variante für einen Suffix ('' = Normal | '-holo' | '-reverse').
 *  TCGdex nutzt in den `-holo`/`-reverse`-Feldern `null`/`0` als "keine Daten" →
 *  eine Variante zählt nur, wenn avg/low vorhanden sind ODER trend > 0. */
function cmVariant(cm: CmBlock, label: string, suffix: string): PriceVariant | null {
  const trend = num(cm[`trend${suffix}`]);
  const avg = num(cm[`avg${suffix}`]);
  const low = num(cm[`low${suffix}`]);
  if (avg == null && low == null && !(trend != null && trend > 0)) return null;
  return { label, low, market: avg, trend: trend && trend > 0 ? trend : undefined };
}

const TP_LABELS: Record<string, string> = {
  normal: 'Normal',
  holofoil: 'Holo',
  reverseHolofoil: 'Reverse Holo',
  '1stEditionHolofoil': '1st Edition Holo',
  '1stEditionNormal': '1st Edition',
};

export function resolveTcgdexPrice(pricing: TcgdexPricing | undefined | null): PriceResult | null {
  if (!pricing) return null;

  // 1) Cardmarket bevorzugt (EUR)
  const cm = pricing.cardmarket;
  if (cm) {
    const variants: PriceVariant[] = [];
    for (const [label, suffix] of [['Normal', ''], ['Reverse Holo', '-holo']] as const) {
      const v = cmVariant(cm, label, suffix);
      if (v) variants.push(v);
    }
    if (variants.length > 0) {
      return { provider: 'cardmarket', currency: 'EUR', updatedAt: typeof cm.updated === 'string' ? cm.updated : undefined, variants };
    }
  }

  // 2) sonst TCGplayer (USD)
  const tp = pricing.tcgplayer;
  if (tp) {
    const order = ['normal', 'holofoil', 'reverseHolofoil', '1stEditionHolofoil', '1stEditionNormal'];
    const keys = Object.keys(tp).filter(k => k !== 'unit' && k !== 'updated' && typeof tp[k] === 'object' && tp[k] !== null);
    keys.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)); // bekannte zuerst, Normal ganz vorn
    const variants: PriceVariant[] = [];
    for (const k of keys) {
      const v = tp[k] as TpVariant;
      const low = num(v.lowPrice), mid = num(v.midPrice), high = num(v.highPrice), market = num(v.marketPrice);
      if (low == null && mid == null && high == null && market == null) continue;
      variants.push({ label: TP_LABELS[k] ?? k, low, mid, high, market });
    }
    if (variants.length > 0) {
      return { provider: 'tcgplayer', currency: 'USD', updatedAt: typeof tp.updated === 'string' ? tp.updated : undefined, variants };
    }
  }

  return null;
}

async function fetchCardPricing(tcgId: string): Promise<PriceResult | null> {
  let res: Response;
  try {
    res = await fetch(`${CARDS}/${encodeURIComponent(tcgId)}`);
  } catch (e) {
    throw new TransientPriceError(e instanceof Error ? e.message : 'network');
  }
  if (res.status === 404) return null; // TCGdex kennt die Karte nicht → sicher als "kein Preis" cachebar
  if (!res.ok) throw new TransientPriceError(`HTTP ${res.status}`);
  const json = await res.json() as { pricing?: TcgdexPricing };
  return resolveTcgdexPrice(json.pricing);
}

export const tcgdexProvider: IPriceProvider = {
  name: 'tcgdex',
  fetchPrices: fetchCardPricing,
};

/** Preise für ein ganzes Set — TCGdex hat keinen Bulk-Preis-Endpunkt, daher
 *  per-Card (gechunkte Parallelität). Karten-IDs aus dem Set-Objekt. */
export async function fetchPricesForSet(setId: string): Promise<Map<string, PriceResult | null>> {
  const out = new Map<string, PriceResult | null>();
  let ids: string[];
  try {
    const res = await fetch(`${SETS}/${encodeURIComponent(setId)}`);
    if (!res.ok) throw new TransientPriceError(`HTTP ${res.status}`);
    const set = await res.json() as { cards?: { id: string }[] };
    ids = (set.cards ?? []).map(c => c.id);
  } catch (e) {
    throw e instanceof TransientPriceError ? e : new TransientPriceError(e instanceof Error ? e.message : 'network');
  }
  const CHUNK = 12;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = await Promise.all(ids.slice(i, i + CHUNK).map(async id => {
      try { return [id, await fetchCardPricing(id)] as const; }
      catch { return [id, null] as const; } // transienter Fehler je Karte → null, nächster Lauf holt nach
    }));
    for (const [id, r] of part) out.set(id, r);
  }
  return out;
}
