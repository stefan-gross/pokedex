'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardImage } from '@/components/card/CardImage';
import { CardGrid, CardGridSkeleton } from '@/components/card/CardGrid';
import { searchCatalogByArtistRest } from '@/lib/firestore/catalog-rest';
import { getCardsRest } from '@/lib/firestore/cards-rest';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { artistSlug } from '@/lib/artists/slug';
import type { ArtistProfile } from '@/lib/firestore/artists';
import type { CardDoc } from '@/types';

export default function ArtistProfilePage() {
  const params = useParams<{ slug: string }>();
  // Der URL-Parameter trägt den ENCODIERTEN Klartext-Namen (nicht den Slug) —
  // so funktioniert die Karten-Suche auch für (noch) nicht angereicherte Künstler.
  const name = useMemo(() => {
    try { return decodeURIComponent(params.slug); } catch { return params.slug; }
  }, [params.slug]);

  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [cards, setCards] = useState<CardInfo[] | null>(null);
  const [ownedMap, setOwnedMap] = useState<Map<string, CardDoc[]>>(new Map());
  const [photoOk, setPhotoOk] = useState(true);

  useEffect(() => {
    setPhotoOk(true);
    // Profil (gecacht) laden — 404 = noch nicht angereichert, dann nur Karten zeigen.
    fetch(`/api/artists/${encodeURIComponent(artistSlug(name))}`)
      .then(r => r.ok ? r.json() : { profile: null })
      .then(d => setProfile(d.profile ?? null))
      .catch(() => setProfile(null));
    // Karten des Illustrators + eigene Sammlung (für Besitz-Badges).
    searchCatalogByArtistRest(name, 400)
      .then(ccs => setCards(ccs
        .map(catalogCardToInfo)
        .sort((a, b) => (a.setId + a.number).localeCompare(b.setId + b.number, 'de', { numeric: true }))))
      .catch(() => setCards([]));
    getCardsRest().then(docs => {
      const m = new Map<string, CardDoc[]>();
      docs.forEach(c => { if (c.tcgId) (m.get(c.tcgId) ?? m.set(c.tcgId, []).get(c.tcgId)!).push(c); });
      setOwnedMap(m);
    }).catch(() => {});
  }, [name]);

  const setCount = useMemo(() => new Set((cards ?? []).map(c => c.setId)).size, [cards]);
  const ownedCount = useMemo(() => (cards ?? []).filter(c => ownedMap.has(c.id)).length, [cards, ownedMap]);
  // Header-Visual: Foto (falls vorhanden + lädt), sonst ein Karten-Artwork.
  const fallbackCard = cards?.[0];
  const showPhoto = !!profile?.photoUrl && photoOk;

  const meta: [string, string | null | undefined][] = [
    ['Geburtsdatum', profile?.birthDate],
    ['Nationalität', profile?.nationality],
    ['Ausbildung', profile?.education],
    ['Tätigkeit', profile?.occupation],
    ['Aktive Jahre', profile?.activeYears],
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-safe z-10 px-3 pt-3 pb-1">
        <div className="glass rounded-[20px] px-4 pt-2 pb-3">
          <Button variant="ghost" href="/collection" className="px-0 -ml-1" icon={<ChevronLeft size={18} strokeWidth={2} />}>
            Zurück
          </Button>
          <h1 className="text-role-h1 text-glass dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.2)]">{name}</h1>
          <p className="text-role-label text-glass-muted mt-0.5">
            Illustrator{cards ? ` · ${cards.length} Karten · ${setCount} Sets` : ''}{ownedCount > 0 ? ` · ${ownedCount} in deiner Sammlung` : ''}
          </p>
        </div>
      </div>

      <div className="px-4 py-4 space-y-5 md:max-w-3xl md:mx-auto">
        {/* Profil (Foto/Artwork + Bio + Fakten) */}
        {profile && (
          <section className="glass rounded-[20px] p-4">
            <div className="flex gap-4">
              <div className="w-28 shrink-0 rounded-xl overflow-hidden bg-[rgba(120,130,150,0.14)] self-start">
                {showPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.photoUrl!}
                    alt={name}
                    className="w-full h-auto object-cover"
                    onError={() => setPhotoOk(false)}
                  />
                ) : fallbackCard ? (
                  <CardImage card={fallbackCard} size="small" alt={name} width={112} height={156} className="w-full h-auto" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-role-body text-glass whitespace-pre-line">{profile.summaryDe}</p>
              </div>
            </div>

            {/* Strukturierte Fakten */}
            {meta.some(([, v]) => !!v) && (
              <dl className="mt-4 grid grid-cols-1 gap-y-1.5">
                {meta.filter(([, v]) => !!v).map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-role-label">
                    <dt className="text-glass-muted w-28 shrink-0">{k}</dt>
                    <dd className="text-glass min-w-0">{v}</dd>
                  </div>
                ))}
              </dl>
            )}

            {/* Besondere Fakten */}
            {!!profile.notableFacts?.length && (
              <ul className="mt-3 space-y-1 list-disc pl-4">
                {profile.notableFacts.map((f, i) => (
                  <li key={i} className="text-role-label text-glass-muted">{f}</li>
                ))}
              </ul>
            )}

            {/* Quellen / Lizenz */}
            <p className="mt-4 pt-3 border-t border-[rgba(46,46,50,0.1)] dark:border-white/[.12] text-[11px] leading-relaxed text-glass-muted">
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
          </section>
        )}

        {/* Karten des Illustrators */}
        <section>
          <h2 className="text-role-h2 text-glass mb-3">Karten von {name}</h2>
          {cards === null ? (
            <CardGridSkeleton count={8} />
          ) : cards.length === 0 ? (
            <p className="text-role-body text-glass-muted">Keine Karten im Katalog gefunden.</p>
          ) : (
            <CardGrid cards={cards} ownedMap={ownedMap} />
          )}
        </section>
      </div>
    </div>
  );
}
