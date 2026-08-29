'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ButtonGroup } from '@/components/ui/button-group';
import { getBinders } from '@/lib/firestore/binders';
import { getDecks } from '@/lib/firestore/decks';

/** Segmented-Control im Header: wechselt zwischen Sammlungen (/binders) und
 *  Decks (/decks). Zeigt die Anzahl je Bereich in Klammern. Die aktuelle Seite
 *  reicht ihre Zahl via Prop durch (immer live); die jeweils andere wird per
 *  Cache-Read (getBinders/getDecks) nachgeladen. */
export function CollectionDeckToggle({ binderCount, deckCount }: { binderCount?: number; deckCount?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const value = pathname.startsWith('/decks') ? 'decks' : 'binders';

  const [fetched, setFetched] = useState<{ binders?: number; decks?: number }>({});
  useEffect(() => {
    if (binderCount == null) getBinders().then(b => setFetched(f => ({ ...f, binders: b.length }))).catch(() => {});
    if (deckCount == null) getDecks().then(d => setFetched(f => ({ ...f, decks: d.length }))).catch(() => {});
  }, [binderCount, deckCount]);

  const bCount = binderCount ?? fetched.binders;
  const dCount = deckCount ?? fetched.decks;
  const label = (base: string, n?: number) => (n != null ? `${base} (${n})` : base);

  return (
    <ButtonGroup
      value={value}
      onChange={(v) => router.push(v === 'decks' ? '/decks' : '/binders')}
      accentColor="#3182ce"
      options={[
        { value: 'binders', label: label('Sammlungen', bCount) },
        { value: 'decks',   label: label('Decks', dCount) },
      ]}
    />
  );
}
