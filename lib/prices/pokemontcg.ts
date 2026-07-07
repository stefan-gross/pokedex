import { TransientPriceError, type IPriceProvider, type PriceResult, type PriceVariant } from './types';

const TCG_BASE = 'https://api.pokemontcg.io/v2';

// ── Cardmarket-Schema (über pokemontcg.io) ─────────────────────────────────
interface CardmarketPrices {
  averageSellPrice?: number;
  lowPrice?: number;
  trendPrice?: number;
  avg1?: number;
  avg7?: number;
  avg30?: number;
  reverseHoloSell?: number;
  reverseHoloLow?: number;
  reverseHoloTrend?: number;
  reverseHoloAvg1?: number;
  reverseHoloAvg7?: number;
  reverseHoloAvg30?: number;
}
interface CardmarketData { url?: string; updatedAt?: string; prices?: CardmarketPrices }

// ── TCGplayer-Schema (über pokemontcg.io) ──────────────────────────────────
interface TcgplayerVariantPrices {
  low?:    number;
  mid?:    number;
  high?:   number;
  market?: number;
  directLow?: number;
}
interface TcgplayerPrices {
  normal?:                TcgplayerVariantPrices;
  holofoil?:              TcgplayerVariantPrices;
  reverseHolofoil?:       TcgplayerVariantPrices;
  '1stEditionHolofoil'?:  TcgplayerVariantPrices;
  '1stEditionNormal'?:    TcgplayerVariantPrices;
  unlimitedHolofoil?:     TcgplayerVariantPrices;
  unlimited?:             TcgplayerVariantPrices;
}
interface TcgplayerData { url?: string; updatedAt?: string; prices?: TcgplayerPrices }

// ── Parser: Cardmarket ─────────────────────────────────────────────────────
export function parseCardmarket(p: CardmarketPrices): PriceVariant[] {
  const out: PriceVariant[] = [];
  if (p.averageSellPrice != null || p.lowPrice != null || p.trendPrice != null || p.avg7 != null) {
    out.push({
      label: 'Normal',
      low:    p.lowPrice,
      mid:    p.avg7,
      market: p.averageSellPrice,
      trend:  p.trendPrice,
    });
  }
  if (p.reverseHoloSell != null || p.reverseHoloLow != null || p.reverseHoloTrend != null || p.reverseHoloAvg7 != null) {
    out.push({
      label: 'Reverse Holo',
      low:    p.reverseHoloLow,
      mid:    p.reverseHoloAvg7,
      market: p.reverseHoloSell,
      trend:  p.reverseHoloTrend,
    });
  }
  return out;
}

// ── Parser: TCGplayer ──────────────────────────────────────────────────────
const TCG_LABELS: Record<keyof TcgplayerPrices, string> = {
  normal:                'Normal',
  holofoil:              'Holo',
  reverseHolofoil:       'Reverse Holo',
  '1stEditionHolofoil':  '1st Edition Holo',
  '1stEditionNormal':    '1st Edition',
  unlimitedHolofoil:     'Unlimited Holo',
  unlimited:             'Unlimited',
};

export function parseTcgplayer(p: TcgplayerPrices): PriceVariant[] {
  const out: PriceVariant[] = [];
  for (const key of Object.keys(TCG_LABELS) as (keyof TcgplayerPrices)[]) {
    const v = p[key];
    if (!v) continue;
    if (v.low == null && v.mid == null && v.high == null && v.market == null) continue;
    out.push({
      label: TCG_LABELS[key],
      low:   v.low,
      mid:   v.mid,
      high:  v.high,
      market: v.market,
    });
  }
  return out;
}

function apiHeaders(): Record<string, string> {
  return process.env.POKEMON_TCG_API_KEY ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY } : {};
}

/** Cardmarket bevorzugt, sonst TCGplayer-Fallback (typisch bei brandneuen
 *  Sets, deren Cardmarket-Sync verzögert ist) — gemeinsame Auswertung für
 *  Einzelkarten- UND Set-Bulk-Antworten, damit beide Pfade synchron bleiben. */
function resolveCardPrice(tcgId: string, card: { cardmarket?: CardmarketData; tcgplayer?: TcgplayerData }): PriceResult | null {
  const cm = card.cardmarket;
  if (cm?.prices) {
    const variants = parseCardmarket(cm.prices);
    if (variants.length > 0) {
      return { provider: 'cardmarket', currency: 'EUR', updatedAt: cm.updatedAt, variants };
    }
    console.warn(`[prices] ${tcgId}: cardmarket.prices vorhanden, aber alle Felder leer/null`);
  }

  const tp = card.tcgplayer;
  if (tp?.prices) {
    const variants = parseTcgplayer(tp.prices);
    if (variants.length > 0) {
      return { provider: 'tcgplayer', currency: 'USD', updatedAt: tp.updatedAt, variants };
    }
    console.warn(`[prices] ${tcgId}: tcgplayer.prices vorhanden, aber alle Felder leer/null`);
  }

  console.warn(`[prices] ${tcgId}: weder cardmarket noch tcgplayer liefern Preisdaten (cardmarket=${!!cm}, tcgplayer=${!!tp})`);
  return null;
}

export const pokemontcgProvider: IPriceProvider = {
  name: 'pokemontcg',

  async fetchPrices(tcgId: string): Promise<PriceResult | null> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 8000);

    try {
      const res = await fetch(`${TCG_BASE}/cards/${tcgId}`, {
        headers: apiHeaders(),
        next: { revalidate: 3600 },
        signal: abort.signal,
      });
      if (!res.ok) {
        // 4xx (außer 404) und 5xx sind API-seitige/transiente Probleme (z.B. Rate-Limit) —
        // NICHT als "kein Preis" cachen. 404 bedeutet: pokemontcg.io kennt diese Karte
        // gar nicht — das ist dauerhaft und darf als "empty" gelten.
        if (res.status !== 404) {
          throw new TransientPriceError(`HTTP ${res.status}`);
        }
        console.warn(`[prices] pokemontcg.io 404 für ${tcgId} — gebe null zurück (wird als empty gecacht)`);
        return null;
      }

      const json = await res.json();
      const card = json.data;
      if (!card) {
        throw new TransientPriceError('kein "data"-Feld in der Antwort');
      }

      return resolveCardPrice(tcgId, card);
    } catch (e) {
      if (e instanceof TransientPriceError) throw e;
      // Netzwerkfehler/Timeout/Abort — transient, NICHT als "kein Preis" cachen.
      console.warn(`[prices] Fetch für ${tcgId} fehlgeschlagen (transient):`, e instanceof Error ? e.message : e);
      throw new TransientPriceError(e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timeout);
    }
  },
};

/** Holt Preise für ein GANZES Set in einem (oder bei >250 Karten wenigen)
 *  Bulk-Request(s) statt Karte für Karte — deutlich schneller beim ersten
 *  Preis-Sortieren eines Sets. IDs, die in der Antwort fehlen, werden NICHT
 *  in die Map geschrieben (Abwesenheit ist mehrdeutig, kein bestätigtes
 *  "kein Preis" wie ein echtes 404 im Einzelkarten-Pfad). */
export async function fetchPricesForSet(setId: string): Promise<Map<string, PriceResult | null>> {
  const results = new Map<string, PriceResult | null>();
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 15000);

  try {
    let page = 1;
    for (;;) {
      const res = await fetch(
        `${TCG_BASE}/cards?q=${encodeURIComponent(`set.id:${setId}`)}&page=${page}&pageSize=250&select=id,cardmarket,tcgplayer`,
        { headers: apiHeaders(), signal: abort.signal },
      );
      if (!res.ok) throw new TransientPriceError(`HTTP ${res.status}`);

      const json = await res.json();
      if (!Array.isArray(json.data)) throw new TransientPriceError('kein "data"-Feld in der Antwort');

      for (const card of json.data) {
        results.set(card.id, resolveCardPrice(card.id, card));
      }

      if (page * 250 >= (json.totalCount ?? 0)) break;
      page++;
    }
    return results;
  } catch (e) {
    if (e instanceof TransientPriceError) throw e;
    console.warn(`[prices] Set-Fetch für ${setId} fehlgeschlagen (transient):`, e instanceof Error ? e.message : e);
    throw new TransientPriceError(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timeout);
  }
}
