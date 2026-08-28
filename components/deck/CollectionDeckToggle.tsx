'use client';

import { useRouter, usePathname } from 'next/navigation';
import { ButtonGroup } from '@/components/ui/button-group';

/** Segmented-Control im Header: wechselt zwischen Sammlungen (/binders) und
 *  Decks (/decks). Auf beiden Seiten eingehängt. */
export function CollectionDeckToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const value = pathname.startsWith('/decks') ? 'decks' : 'binders';
  return (
    <ButtonGroup
      value={value}
      onChange={(v) => router.push(v === 'decks' ? '/decks' : '/binders')}
      accentColor="#3182ce"
      options={[
        { value: 'binders', label: 'Sammlungen' },
        { value: 'decks',   label: 'Decks' },
      ]}
    />
  );
}
