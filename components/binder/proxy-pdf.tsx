'use client';

import { Document, Page, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';

/** Eingabe pro fehlender Karte für den Proxy-Druck. */
export interface ProxyCardInput {
  /** Bild-URL (Katalog, DE bevorzugt). Fehlt → generierter Platzhalter. */
  imgUrl?: string;
  name: string;
  number: string;
  setCode?: string;
}

// Kartengröße in pt (1mm ≈ 2.8346pt): 63,5 × 88,9 mm = Standard-TCG-Format.
const CARD_W = 180;
const CARD_H = 252;

const styles = StyleSheet.create({
  page: { padding: 18, backgroundColor: '#ffffff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  card: { width: CARD_W, height: CARD_H, objectFit: 'cover', borderWidth: 0.5, borderColor: '#999', borderRadius: 8 },
});

function ProxyPdfDocument({ title, images }: { title: string; images: string[] }) {
  // 9 Karten (3×3) pro A4-Seite.
  const perPage = 9;
  const pages: string[][] = [];
  for (let i = 0; i < images.length; i += perPage) pages.push(images.slice(i, i + perPage));
  return (
    <Document title={title}>
      {pages.map((pageImgs, pi) => (
        <Page key={pi} size="A4" style={styles.page}>
          <View style={styles.grid}>
            {pageImgs.map((src, i) => (
              <Image key={i} src={src} style={styles.card} />
            ))}
          </View>
        </Page>
      ))}
    </Document>
  );
}

/** Lädt ein Bild same-origin über den Next-Image-Proxy, zeichnet es auf ein
 *  Canvas, konvertiert zu Graustufen und gibt eine data:-URL zurück. `null` bei
 *  Ladefehler/Canvas-Taint → Aufrufer nutzt dann den Platzhalter. */
function grayscaleDataUrl(rawUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proxied = `/_next/image?url=${encodeURIComponent(rawUrl)}&w=640&q=75`;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
          px[i] = px[i + 1] = px[i + 2] = g;
        }
        ctx.putImageData(d, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        resolve(null); // getImageData/toDataURL wirft bei getaintetem Canvas
      }
    };
    img.onerror = () => resolve(null);
    img.src = proxied;
  });
}

/** Generierter Platzhalter (Karten-Umriss + Name/Nummer/Set) als data:-URL —
 *  für fehlende Karten ohne verfügbares Bild. */
function placeholderDataUrl(card: ProxyCardInput): string {
  const W = 360, H = 504;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#bbb'; ctx.lineWidth = 4; ctx.strokeRect(8, 8, W - 16, H - 16);
  ctx.fillStyle = '#333'; ctx.textAlign = 'center';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText(card.name.slice(0, 22), W / 2, H / 2 - 10);
  ctx.fillStyle = '#777'; ctx.font = '22px sans-serif';
  const meta = [card.setCode, card.number].filter(Boolean).join(' · ');
  if (meta) ctx.fillText(meta, W / 2, H / 2 + 26);
  ctx.font = '18px sans-serif';
  ctx.fillText('Proxy', W / 2, H - 34);
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** Bereitet die Bilder aller Karten auf (Graustufe oder Platzhalter). Wird vom
 *  Aufrufer VOR dem PDF-Bau aufgerufen (Browser-Canvas). `onProgress` meldet
 *  den Fortschritt für einen Ladezustand. */
export async function prepareProxyImages(
  cards: ProxyCardInput[],
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const gray = c.imgUrl ? await grayscaleDataUrl(c.imgUrl) : null;
    out.push(gray ?? placeholderDataUrl(c));
    onProgress?.(i + 1, cards.length);
  }
  return out;
}

/** Baut das Proxy-PDF aus vorbereiteten data:-URL-Bildern + Download. */
export async function downloadProxyPdf(title: string, images: string[]): Promise<void> {
  const blob = await pdf(<ProxyPdfDocument title={title} images={images} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^\w\s.-]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
