'use client';

import { use, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Heart, Minus, Pencil, Download } from 'lucide-react';
import { AutomaticBadge } from '@/components/binder/CollectionTypeBadge';
import { CreateWishlistModal } from '@/components/wishlist/CreateWishlistModal';
import { getWishlist, removeItemFromWishlist } from '@/lib/firestore/wishlists';
import { getCatalogCardsByIds, type CatalogCard } from '@/lib/firestore/catalog';
import { getCardsByTcgId } from '@/lib/firestore/cards';
import { getAllSets } from '@/lib/firestore/sets';
import { getBinder } from '@/lib/firestore/binders';
import { catalogCardToInfo, type CardInfo } from '@/lib/card-info';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { Card } from '@/components/card/Card';
import { Button } from '@/components/ui/button';
import { ScrollToTopButton } from '@/components/ui/ScrollToTopButton';
import { usePricesBatch } from '@/lib/hooks/use-prices-batch';
import { pickTrendPrice } from '@/lib/prices/value-tier';
import type { WishlistDoc, WishlistItem, CardDoc } from '@/types';

const EUR = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

/** Set-Logo als kleine data:-URL laden (für den PDF-Header). Wird per Canvas
 *  auf max. 240px herunterskaliert — das Logo wird im PDF ohnehin nur ~96px
 *  angezeigt, die Originalauflösung würde das PDF unnötig aufblähen (mehrere
 *  MB). Schlägt der Fetch fehl (z.B. CORS/offline), wird `undefined`
 *  zurückgegeben — der Export läuft dann ohne Logo weiter statt zu scheitern. */
async function fetchLogoDataUrl(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = objUrl;
      });
      const MAX = 160;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  } catch { return undefined; }
}

interface Props {
  params: Promise<{ id: string }>;
}

export default function WishlistDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [list, setList] = useState<WishlistDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailCard, setDetailCard] = useState<CardInfo | null>(null);
  const [detailOwned, setDetailOwned] = useState<CardDoc[]>([]);
  const [editOpen, setEditOpen] = useState(false);

  const load = async () => {
    try {
      const wl = await getWishlist(id);
      if (!wl) { router.push('/wishlist'); return; }
      setList(wl);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const isTemplateList = !!list?.templateBinderId;
  const items = list?.items ?? [];
  const withTcgId = items.filter(i => i.tcgId);
  const freeText  = items.filter(i => !i.tcgId);

  // Auf `list` memoisieren (stabil), NICHT auf das bei jedem Render neu
  // erzeugte `withTcgId` — sonst neuer `tcgIds`-Array-Ref pro Render →
  // Katalog-Effekt (setCatById) läuft endlos → „Maximum update depth".
  const tcgIds = useMemo(
    () => (list?.items ?? []).map(i => i.tcgId).filter((x): x is string => !!x),
    [list],
  );
  const { prices } = usePricesBatch(tcgIds);

  // Bilder frisch aus dem Katalog auflösen (DE + EN), damit `CardImage` bei
  // einem 404 der deutschen TCGdex-URL auf das englische Bild zurückfallen kann.
  // Der gespeicherte `item.tcgImageUrl` ist nur EINE (deutsche) URL ohne
  // Fallback — deshalb fehlten Bilder, für die TCGdex kein DE-Bild hat.
  const [catById, setCatById] = useState<Map<string, CatalogCard>>(new Map());
  useEffect(() => {
    if (tcgIds.length === 0) { setCatById(new Map()); return; }
    let cancelled = false;
    getCatalogCardsByIds(tcgIds)
      .then(cards => { if (!cancelled) setCatById(new Map(cards.map(c => [c.id, c]))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tcgIds]);

  async function handleRemove(item: WishlistItem) {
    if (!list || isTemplateList) return;
    await removeItemFromWishlist(list.id, item.id);
    setList(l => l ? { ...l, items: l.items.filter(i => i.id !== item.id) } : l);
  }

  const [exporting, setExporting] = useState(false);
  async function handleExportPdf() {
    if (!list || exporting) return;
    setExporting(true);
    try {
      // Deutsche Namen + deutsche Set-Namen frisch auflösen (die gespeicherten
      // Item-Felder tragen z.T. nur englische Werte; `CatalogCard.setName` ist
      // grundsätzlich englisch → deutscher Set-Name kommt aus `TcgSet.nameDe`).
      const ids = list.items.map(i => i.tcgId).filter((x): x is string => !!x);
      const [catCards, allSets] = await Promise.all([getCatalogCardsByIds(ids), getAllSets()]);
      const catById = new Map(catCards.map(c => [c.id, c]));
      const setById = new Map(allSets.map(s => [s.id, s]));

      const nameOf = (i: WishlistItem) => catById.get(i.tcgId ?? '')?.nameDe ?? i.name;
      const setNameOf = (i: WishlistItem) => {
        const sid = catById.get(i.tcgId ?? '')?.setId ?? i.setId;
        const s = sid ? setById.get(sid) : undefined;
        return s?.nameDe ?? s?.name ?? i.setName ?? '';
      };
      // Nummer wie auf den Karten formatieren: dreistellig + "/PrintedTotal"
      // (z.B. "007/094") — gleiche Logik wie `numFmt` in CardDetailSheet.
      const numberOf = (i: WishlistItem) => {
        const c = catById.get(i.tcgId ?? '');
        const raw = (c?.number ?? i.number ?? '').split('/')[0];
        if (!raw) return '';
        const isPlain = /^\d+$/.test(raw);
        const base = isPlain ? raw.padStart(3, '0') : raw;
        const sid = c?.setId ?? i.setId;
        const total = sid ? setById.get(sid)?.printedTotal : undefined;
        return isPlain && total ? `${base}/${String(total).padStart(3, '0')}` : base;
      };
      const priceOf = (i: WishlistItem) => {
        if (!i.tcgId) return '';
        const p = pickTrendPrice(prices.get(i.tcgId));
        return p != null ? EUR(p) : '';
      };

      // Sortierung je Listentyp:
      // - Vorlagen-Liste: die gespeicherte Reihenfolge IST bereits die
      //   Sammlungs-Reihenfolge (sync schreibt `items` nach Slot-`order`).
      // - Manuelle Liste: nach Set gruppieren, dann nach (deutschem) Namen.
      const ordered = isTemplateList
        ? list.items
        : [...list.items].sort((a, b) => {
            const sa = setNameOf(a), sb = setNameOf(b);
            if (sa !== sb) return sa.localeCompare(sb, 'de');
            return nameOf(a).localeCompare(nameOf(b), 'de');
          });

      const rows = ordered.map(i => ({
        name: nameOf(i),
        number: numberOf(i),
        setName: setNameOf(i),
        price: priceOf(i),
      }));

      // Set-Spalte weglassen, wenn alle Karten aus demselben Set stammen
      // (z.B. Master-Set-Wunschliste) — dann ist die Spalte redundant (Set
      // steht schon im Titel + Logo).
      const distinctSets = new Set(rows.map(r => r.setName).filter(Boolean));
      const showSet = distinctSets.size > 1;

      // Logo/Symbol der zugehörigen Sammlung (nur Vorlagen-Liste mit Set-Icon).
      let logoDataUrl: string | undefined;
      if (list.templateBinderId) {
        const binder = await getBinder(list.templateBinderId);
        const icon = binder?.icon;
        if (icon?.startsWith('set:')) {
          const sid = icon.slice(4);
          const url = setById.get(sid)?.logoUrl ?? "";
          logoDataUrl = await fetchLogoDataUrl(url);
        }
      }

      const dateStr = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });

      // Lazy: zieht @react-pdf/renderer erst beim Klick nach.
      const { downloadWishlistPdf } = await import('@/components/wishlist/wishlist-pdf');
      await downloadWishlistPdf({ title: list.name, dateStr, logoDataUrl, showSet, rows });
    } catch (e) {
      console.error('[wishlist] PDF-Export fehlgeschlagen', e);
    } finally {
      setExporting(false);
    }
  }

  async function openDetail(item: WishlistItem) {
    if (!item.tcgId) return;
    const [cc] = await getCatalogCardsByIds([item.tcgId]);
    if (!cc) return;
    const owned = await getCardsByTcgId(item.tcgId);
    setDetailOwned(owned);
    setDetailCard(catalogCardToInfo(cc));
  }

  if (loading || !list) {
    return (
      <div className="min-h-screen flex justify-center pt-16">
        <div className="w-8 h-8 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-safe z-20 mx-3 mt-2 glass rounded-[20px] px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            icon={<ChevronLeft />}
            onClick={() => router.push('/wishlist')}
            aria-label="Zurück"
            className="shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-role-h2 truncate text-glass flex items-center gap-1.5">
              {list.name}
              {isTemplateList && <AutomaticBadge size="sm" />}
            </h1>
            <p className="text-role-label text-glass-muted">{items.length} {items.length === 1 ? 'Karte' : 'Karten'}</p>
          </div>
          {!isTemplateList && (
            <Button
              variant="secondary"
              icon={<Pencil />}
              onClick={() => setEditOpen(true)}
              aria-label="Wunschliste bearbeiten"
              title="Bearbeiten"
              className="shrink-0"
            />
          )}
          <Button
            variant="secondary"
            icon={<Download />}
            onClick={handleExportPdf}
            disabled={exporting || items.length === 0}
            aria-label="Als PDF exportieren"
            title="Als PDF exportieren"
            className="shrink-0"
          />
        </div>
        {isTemplateList && (
          <p className="text-role-label text-glass-muted mt-2">
            Automatisch verwaltet — fehlende Karten dieser Vorlage
          </p>
        )}
      </div>

      {items.length === 0 && (
        <div className="text-center pt-16 space-y-3 px-4">
          <div className="flex justify-center"><Heart size={48} className="text-glass-muted" /></div>
          <p className="text-role-title text-glass">
            {isTemplateList ? 'Nichts mehr offen — Vorlage vollständig' : 'Noch nichts auf der Wunschliste'}
          </p>
          {!isTemplateList && (
            <p className="text-role-body text-glass-muted">
              Öffne eine Karte im Detail und tippe auf „Auf Wunschliste setzen"
            </p>
          )}
        </div>
      )}

      {withTcgId.length > 0 && (
        <div className="px-3 pt-4 grid grid-cols-2 gap-2">
          {withTcgId.map(item => {
            const price = pickTrendPrice(prices.get(item.tcgId!));
            const cc = catById.get(item.tcgId!);
            return (
              <Card
                key={item.id}
                card={{
                  id: item.tcgId!, name: item.name, number: item.number ?? '',
                  setId: item.setId ?? '', setName: item.setName ?? '',
                  // EN als Basis-Bild (Fallback), DE bevorzugt via CardImage —
                  // fällt bei DE-404 automatisch auf EN zurück.
                  imgSmall: cc?.imgSmall ?? item.tcgImageUrl ?? '',
                  imgLarge: cc?.imgLarge ?? item.tcgImageUrl ?? '',
                  imgSmallDe: cc?.imgSmallDe,
                  imgLargeDe: cc?.imgLargeDe,
                }}
                onCardClick={() => openDetail(item)}
                sublabel={item.setName ? `${item.setName}${item.number ? ` · ${item.number}` : ''}` : item.name}
                price={price != null ? price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : undefined}
                onManualWishlist={!isTemplateList}
                onAutoWishlist={isTemplateList}
                onHeartClick={isTemplateList ? undefined : () => handleRemove(item)}
              />
            );
          })}
        </div>
      )}

      {freeText.length > 0 && (
        <div className="px-3 pt-4 space-y-1.5">
          {freeText.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-2 glass-inner rounded-xl px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-role-body text-glass truncate">{item.name}</p>
                {item.notes && <p className="text-role-label text-glass-muted truncate">{item.notes}</p>}
              </div>
              {!isTemplateList && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Minus strokeWidth={2.5} />}
                  onClick={() => handleRemove(item)}
                  aria-label="Entfernen"
                  className="shrink-0"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {detailCard && (
        <CardDetailSheet
          card={detailCard}
          ownedCopies={detailOwned}
          onClose={() => setDetailCard(null)}
          onSaved={load}
        />
      )}

      {editOpen && !isTemplateList && (
        <CreateWishlistModal
          existing={list}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load(); }}
        />
      )}

      <ScrollToTopButton />
    </div>
  );
}
