'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ChevronLeft, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardImage } from '@/components/card/CardImage';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { searchCatalogByArtistRest } from '@/lib/firestore/catalog-rest';
import { getCardsRest } from '@/lib/firestore/cards-rest';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import type { CatalogCard } from '@/lib/firestore/catalog';
import { artistSlug } from '@/lib/artists/slug';
import type { ArtistProfile } from '@/lib/firestore/artists';
import type { CardDoc } from '@/types';

/** Illustrator-Detail im selben Layout/Design wie die Pokémon-Detailseite:
 *  ein Glas-Panel mit Kopf, Bio, Foto+Fakten, 3×2-Vorschau der wertvollsten
 *  Karten (Klick → Karten-Detail) und Button in den gefilterten Karten-Tab. */
export default function ArtistProfilePage() {
  const params = useParams<{ slug: string }>();
  // Der URL-Parameter trägt den ENCODIERTEN Klartext-Namen (nicht den Slug) —
  // so funktioniert die Karten-Suche auch für (noch) nicht angereicherte Künstler.
  const name = useMemo(() => {
    try { return decodeURIComponent(params.slug); } catch { return params.slug; }
  }, [params.slug]);

  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [rawCards, setRawCards] = useState<CatalogCard[] | null>(null);
  const [ownedMap, setOwnedMap] = useState<Map<string, CardDoc[]>>(new Map());
  const [selected, setSelected] = useState<CardInfo | null>(null);
  const [photoOk, setPhotoOk] = useState(true);

  useEffect(() => {
    setPhotoOk(true);
    setProfile(null);
    setRawCards(null);
    setSelected(null);
    let alive = true;
    // Profil (gecacht) laden — 404 = noch nicht angereichert, dann nur Karten zeigen.
    fetch(`/api/artists/${encodeURIComponent(artistSlug(name))}`)
      .then(r => r.ok ? r.json() : { profile: null })
      .then(d => { if (alive) setProfile(d.profile ?? null); })
      .catch(() => { if (alive) setProfile(null); });
    // Karten des Illustrators + eigene Sammlung (für Besitz-Badges).
    searchCatalogByArtistRest(name, 400)
      .then(ccs => { if (alive) setRawCards(ccs); })
      .catch(() => { if (alive) setRawCards([]); });
    getCardsRest().then(docs => {
      if (!alive) return;
      const m = new Map<string, CardDoc[]>();
      docs.forEach(c => { if (c.tcgId) (m.get(c.tcgId) ?? m.set(c.tcgId, []).get(c.tcgId)!).push(c); });
      setOwnedMap(m);
    }).catch(() => {});
    return () => { alive = false; };
  }, [name]);

  const cardCount = rawCards?.length ?? 0;
  const setCount = useMemo(() => new Set((rawCards ?? []).map(c => c.setId)).size, [rawCards]);
  const ownedCount = useMemo(() => (rawCards ?? []).filter(c => ownedMap.has(c.id)).length, [rawCards, ownedMap]);
  // Vorschau: die 6 wertvollsten Karten dieses Illustrators (Trendpreis absteigend).
  const topCards = useMemo(
    () => (rawCards ?? []).slice().sort((a, b) => (b.priceEur ?? 0) - (a.priceEur ?? 0)).slice(0, 6).map(catalogCardToInfo),
    [rawCards],
  );
  const fallbackCard = topCards[0];
  const showPhoto = !!profile?.photoUrl && photoOk;

  const facts: [string, string | null][] = [
    ['Karten', cardCount ? String(cardCount) : null],
    ['Sets', setCount ? String(setCount) : null],
    ['In deiner Sammlung', ownedCount > 0 ? String(ownedCount) : null],
    ['Geburtsdatum', profile?.birthDate ?? null],
    ['Nationalität', profile?.nationality ?? null],
    ['Ausbildung', profile?.education ?? null],
    ['Tätigkeit', profile?.occupation ?? null],
    ['Aktive Jahre', profile?.activeYears ?? null],
  ];

  return (
    <div className="min-h-screen px-3 pt-3 pb-4 md:max-w-3xl md:mx-auto">
      <section className="glass rounded-[18px] px-4 pt-2 pb-4 space-y-4">
        <Button variant="ghost" href="/collection" className="px-0 -ml-1" icon={<ChevronLeft size={18} strokeWidth={2} />}>
          Zurück
        </Button>

        {/* Kopf: Name links, „Illustrator" rechtsbündig */}
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)] leading-tight min-w-0 truncate">{name}</h1>
          <span className="text-role-label text-glass-muted shrink-0">Illustrator</span>
        </div>

        {/* Bio (falls angereichert) über die volle Breite */}
        {profile?.summaryDe && (
          <p className="text-role-body text-glass whitespace-pre-line">{profile.summaryDe}</p>
        )}

        {/* Foto links + Fakten rechts */}
        {(showPhoto || fallbackCard || facts.some(([, v]) => !!v)) && (
          <div className="flex gap-4">
            <div className="w-28 shrink-0 rounded-xl overflow-hidden bg-[rgba(120,130,150,0.14)] self-start">
              {showPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile!.photoUrl!} alt={name} className="w-full h-auto object-cover" onError={() => setPhotoOk(false)} />
              ) : fallbackCard ? (
                <CardImage card={fallbackCard} size="small" alt={name} width={112} height={156} className="w-full h-auto" />
              ) : null}
            </div>
            <dl className="flex-1 min-w-0 self-center grid grid-cols-1">
              {facts.filter(([, v]) => !!v).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-role-label py-1 border-b border-[rgba(46,46,50,0.08)] dark:border-white/[.08] last:border-0">
                  <dt className="text-glass-muted shrink-0">{k}</dt>
                  <dd className="text-glass text-right min-w-0">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Besondere Fakten */}
        {!!profile?.notableFacts?.length && (
          <ul className="space-y-1 list-disc pl-4">
            {profile.notableFacts.map((f, i) => (
              <li key={i} className="text-role-label text-glass-muted">{f}</li>
            ))}
          </ul>
        )}

        {/* Karten des Illustrators: 6 wertvollste als Vorschau (3×2) + Link zu allen */}
        {topCards.length > 0 && (
          <div>
            <h2 className="text-role-h2 text-glass mb-2">Karten</h2>
            <div className="grid grid-cols-3 gap-2">
              {topCards.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="block active:scale-[.98] transition-transform"
                  aria-label={`${c.name} – Details`}
                >
                  <CardImage card={c} size="small" alt={c.name} width={140} height={196} className="w-full h-auto rounded-[6px]" />
                </button>
              ))}
            </div>
          </div>
        )}

        {rawCards === null && (
          <p className="text-role-body text-glass-muted">Karten werden geladen …</p>
        )}

        {/* Karten-Detail (Sheet) beim Antippen einer Vorschau-Karte */}
        {selected && (
          <CardDetailSheet
            card={selected}
            ownedCopies={ownedMap.get(selected.id) ?? []}
            onClose={() => setSelected(null)}
          />
        )}

        {cardCount > 0 && (
          <Button
            variant="primary"
            className="w-full"
            href={`/collection?q=${encodeURIComponent(name)}`}
            icon={<LayoutGrid size={18} />}
          >
            {cardCount > 6 ? 'Alle Karten' : 'Karten anzeigen'}
          </Button>
        )}

        {/* Quellen / Lizenz */}
        {profile && (
          <p className="pt-3 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.12] text-[11px] leading-relaxed text-glass-muted">
            {profile.photoSource && <>Foto: {profile.photoSource}. </>}
            Quellen:{' '}
            {profile.sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && ', '}
                {/* eslint-disable-next-line react/jsx-no-target-blank */}
                <a href={s.url} target="_blank" rel="noopener" className="underline">{s.name}</a> ({s.license})
              </span>
            ))}
          </p>
        )}
      </section>
    </div>
  );
}
