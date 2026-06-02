export interface TcgApiCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  supertype?: string;
  subtypes?: string[];
  types?: string[];
  set: { id: string; name: string; series: string; total: number; printedTotal: number };
  images: { small: string; large: string };
}

export async function searchCards(query: string, page = 1, pageSize = 20): Promise<{ data: TcgApiCard[]; totalCount: number }> {
  const params = new URLSearchParams({ q: query, page: String(page), pageSize: String(pageSize) });
  const res = await fetch(`/api/tcg?${params}`);
  if (!res.ok) throw new Error('TCG search failed');
  return res.json();
}

export async function getCardById(id: string): Promise<TcgApiCard> {
  const res = await fetch(`/api/tcg?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('Card not found');
  const json = await res.json();
  return json.data;
}

export function cardImageUrl(setId: string, number: string, hires = true): string {
  const n = number.split('/')[0];
  return `https://images.pokemontcg.io/${setId}/${n}${hires ? '_hires' : ''}.png`;
}

export function detectVariants(card: TcgApiCard): string[] {
  const variants = ['standard'];
  if (card.rarity?.toLowerCase().includes('holo')) variants.push('holo');
  if (card.rarity?.toLowerCase().includes('reverse')) variants.push('reverse');
  if (card.rarity?.toLowerCase().includes('illustration rare') ||
      card.rarity?.toLowerCase().includes('special illustration')) variants.push('alt-art');
  return variants;
}
