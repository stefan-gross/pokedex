import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getCard } from '@/lib/firestore/cards';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { CardPriceDetail } from '@/components/card/CardPriceDetail';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CardDetailPage({ params }: Props) {
  const { id } = await params;
  const card = await getCard(id);
  if (!card) notFound();

  return (
    <div className="min-h-screen">
      <div className="sticky top-safe z-10 bg-background border-b border-border px-4 pt-4 pb-3 flex items-center gap-3">
        <Link href="/collection" className="text-muted-foreground">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="font-semibold text-base truncate">{card.name}</h1>
      </div>

      <div className="px-4 pt-5 pb-8 space-y-5">
        {/* Card image */}
        <div className="flex justify-center">
          <div className="w-48 rounded-2xl overflow-hidden border border-border shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.tcgImageUrl ?? `https://images.pokemontcg.io/${card.setId}/${card.number.split('/')[0]}_hires.png`}
              alt={card.name}
              className="w-full"
            />
          </div>
        </div>

        {/* Meta */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <Row label="Set" value={card.setName} />
          <Row label="Nummer" value={card.number} />
          <Row label="Seltenheit" value={card.rarity ?? '–'} />
          <Row label="Variante" value={card.variant} />
          <Row label="Zustand" value={card.condition} />
          <Row label="Sprache" value={card.language.toUpperCase()} />
          <Row label="Anzahl" value={String(card.quantity)} />
        </div>

        {card.tcgId && (
          <div className="bg-card border border-border rounded-xl p-4">
            <CardPriceDetail tcgId={card.tcgId} />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium capitalize">{value}</span>
    </div>
  );
}
