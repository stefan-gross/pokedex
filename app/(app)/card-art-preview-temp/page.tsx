'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// TEMP-Testseite (Preview-First) für die KI-Illustrationserweiterung via Gemini.
// Nicht verlinkt — nur zum Abstimmen der Qualität, bevor etwas in die echte
// Kartenansicht kommt. Danach wieder entfernen.
const PREFILL = 'https://assets.tcgdex.net/de/me/me05/042/high.png';

async function callCardArt(imageUrl: string, mode?: 'card' | 'grid3x3') {
  const res = await fetch('/api/admin/card-art', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl, mode }),
  });
  const data = await res.json();
  if (!res.ok || !data.image) {
    throw new Error(`${data.error ?? res.status}${data.details ? ' — ' + JSON.stringify(data.details) : ''}`);
  }
  return data as { image: string; model: string; latencyMs: number };
}

export default function CardArtPreviewTempPage() {
  const [url, setUrl] = useState(PREFILL);
  const [error, setError] = useState<string | null>(null);

  // Schritt 1: randlose Illustration
  const [loading1, setLoading1] = useState(false);
  const [art, setArt] = useState<string | null>(null);
  const [meta1, setMeta1] = useState<string | null>(null);

  // Schritt 2: 3×3-Gesamtbild
  const [loading2, setLoading2] = useState(false);
  const [grid, setGrid] = useState<string | null>(null);
  const [meta2, setMeta2] = useState<string | null>(null);

  // Creative-Fabrica-Provider — zweistufig, je Schritt eigenes Modell.
  const [cfSize, setCfSize] = useState('1k'); // erst niedrig testen
  const [cfModel1, setCfModel1] = useState('gemini_flash_3_1');
  const [cfModel2, setCfModel2] = useState('gemini_pro_3');
  const [cfLoad1, setCfLoad1] = useState(false);
  const [cfLoad2, setCfLoad2] = useState(false);
  const [cfArt, setCfArt] = useState<string | null>(null);   // CDN-URL Schritt 1
  const [cfGrid, setCfGrid] = useState<string | null>(null); // CDN-URL Schritt 2
  const [cfMeta1, setCfMeta1] = useState<string | null>(null);
  const [cfMeta2, setCfMeta2] = useState<string | null>(null);

  async function cfCall(imageUrl: string, mode: 'card' | 'grid3x3', cfModel: string) {
    const res = await fetch('/api/admin/card-art', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, provider: 'cf', mode, cfModel, imageSize: cfSize }),
    });
    const d = await res.json();
    if (!res.ok || !d.image) throw new Error(`${d.error ?? res.status}`);
    return d as { image: string; model: string; latencyMs: number };
  }

  async function cfStep1() {
    setCfLoad1(true); setError(null); setCfArt(null); setCfMeta1(null); setCfGrid(null); setCfMeta2(null);
    try {
      const d = await cfCall(url, 'card', cfModel1);
      setCfArt(d.image); setCfMeta1(`${d.model} · ${d.latencyMs} ms`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setCfLoad1(false); }
  }

  async function cfStep2() {
    if (!cfArt) return;
    setCfLoad2(true); setError(null); setCfGrid(null); setCfMeta2(null);
    try {
      const d = await cfCall(cfArt, 'grid3x3', cfModel2);
      setCfGrid(d.image); setCfMeta2(`${d.model} · ${d.latencyMs} ms`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setCfLoad2(false); }
  }

  // Replicate FLUX Fill (Outpaint) — nutzt eine Illustration (Gemini/CF Schritt 1) oder die Karten-URL.
  const [repLoad, setRepLoad] = useState(false);
  const [repImg, setRepImg] = useState<string | null>(null);
  const [repMeta, setRepMeta] = useState<string | null>(null);

  async function runReplicate() {
    const input = art ?? cfArt ?? url; // bevorzugt freigestellte Illustration
    setRepLoad(true); setError(null); setRepImg(null); setRepMeta(null);
    try {
      const res = await fetch('/api/admin/card-art', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: input, provider: 'replicate' }),
      });
      const d = await res.json();
      if (!res.ok || !d.image) throw new Error(`${d.error ?? res.status}`);
      setRepImg(d.image); setRepMeta(`${d.model} · ${d.latencyMs} ms`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRepLoad(false); }
  }

  // Nano Banana (Gemini via Replicate) — Ein-Schritt-3×3
  const [nbModel, setNbModel] = useState('google/nano-banana-2');
  const [nbRes, setNbRes] = useState('2K');
  const [nbLoad, setNbLoad] = useState(false);
  const [nbImg, setNbImg] = useState<string | null>(null);
  const [nbMeta, setNbMeta] = useState<string | null>(null);

  async function runNB() {
    const input = art ?? cfArt ?? url; // freigestellte Illustration bevorzugt
    setNbLoad(true); setError(null); setNbImg(null); setNbMeta(null);
    try {
      const res = await fetch('/api/admin/card-art', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: input, provider: 'nb', cfModel: nbModel, imageSize: nbRes }),
      });
      const d = await res.json();
      if (!res.ok || !d.image) throw new Error(`${d.error ?? res.status}`);
      setNbImg(d.image); setNbMeta(`${d.model} · ${d.latencyMs} ms`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setNbLoad(false); }
  }

  const NB_MODELS = [
    ['google/nano-banana-2', 'Nano Banana 2 (3.1)'],
    ['google/nano-banana-pro', 'Nano Banana Pro'],
    ['google/nano-banana-2-lite', 'Nano Banana 2 Lite'],
    ['google/nano-banana', 'Nano Banana (2.5)'],
  ] as const;

  const CF_MODELS = [
    ['gemini_pro_3', 'Nano Banana Pro (3 Pro)'],
    ['gemini_flash_3_1', 'Nano Banana 2 (3.1)'],
    ['seedream_5_pro', 'SeeDream 5.0 Pro'],
    ['chatgpt_image_2', 'GPT Image 2'],
    ['gemini_flash_2_5_image', 'Nano Banana (2.5)'],
    ['gemini_flash_lite_image', 'Nano Banana 2 Lite'],
  ] as const;

  async function step1() {
    setLoading1(true); setError(null); setArt(null); setMeta1(null); setGrid(null); setMeta2(null);
    try {
      const d = await callCardArt(url, 'card');
      setArt(d.image); setMeta1(`${d.model} · ${d.latencyMs} ms`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading1(false); }
  }

  async function step2() {
    if (!art) return;
    setLoading2(true); setError(null); setGrid(null); setMeta2(null);
    try {
      const d = await callCardArt(art, 'grid3x3');
      setGrid(d.image); setMeta2(`${d.model} · ${d.latencyMs} ms`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading2(false); }
  }

  return (
    <div className="min-h-screen px-4 py-6 space-y-4 max-w-4xl mx-auto">
      <h1 className="text-role-h1 text-glass">Illustration → 3×3-Artwork — Test</h1>
      <p className="text-role-body text-glass-muted">
        Gemini (Nano Banana). Schritt 1: Text/Rahmen entfernen. Schritt 2: aufs 3×3-Format erweitern. Temporär.
      </p>

      <div className="flex gap-2">
        <Input value={url} onChange={setUrl} placeholder="Bild-URL" className="flex-1" />
        <Button onClick={step1} disabled={loading1 || !url}>
          {loading1 ? 'Schritt 1…' : 'Schritt 1: Illustration'}
        </Button>
      </div>

      {/* Creative Fabrica — zweistufig, je Schritt eigenes Modell */}
      <div className="glass rounded-[16px] p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-role-label text-glass-muted flex-1">Creative Fabrica (Schritt 1 → Schritt 2, Modelle mischbar)</p>
          <span className="text-role-label text-glass-muted">Auflösung</span>
          <select value={cfSize} onChange={e => setCfSize(e.target.value)}
            className="rounded-lg px-2 py-2 text-sm bg-black/5 dark:bg-white/10 text-glass">
            <option value="1k">1k (Test)</option>
            <option value="2k">2k</option>
            <option value="4k">4k (Druck)</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* CF Schritt 1 */}
          <div className="space-y-2">
            <div className="flex gap-2 items-center flex-wrap">
              <select value={cfModel1} onChange={e => setCfModel1(e.target.value)}
                className="rounded-lg px-2 py-2 text-sm bg-black/5 dark:bg-white/10 text-glass flex-1 min-w-0">
                {CF_MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <Button onClick={cfStep1} disabled={cfLoad1 || !url} variant="secondary" size="sm">
                {cfLoad1 ? 'S1…' : 'CF S1: Illu'}
              </Button>
            </div>
            {cfMeta1 && <p className="text-role-label text-glass-muted">{cfMeta1}</p>}
            {cfArt && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cfArt} alt="CF Illustration" className="w-full rounded-xl" />
                <a href={cfArt} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm" className="w-full">Öffnen</Button></a>
              </>
            )}
          </div>

          {/* CF Schritt 2 */}
          <div className="space-y-2">
            <div className="flex gap-2 items-center flex-wrap">
              <select value={cfModel2} onChange={e => setCfModel2(e.target.value)}
                className="rounded-lg px-2 py-2 text-sm bg-black/5 dark:bg-white/10 text-glass flex-1 min-w-0">
                {CF_MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <Button onClick={cfStep2} disabled={cfLoad2 || !cfArt} variant="secondary" size="sm">
                {cfLoad2 ? 'S2…' : 'CF S2: 3×3'}
              </Button>
            </div>
            {cfMeta2 && <p className="text-role-label text-glass-muted">{cfMeta2}</p>}
            {cfGrid && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cfGrid} alt="CF 3x3" className="w-full rounded-xl" />
                <a href={cfGrid} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm" className="w-full">Öffnen</Button></a>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Nano Banana (Gemini via Replicate) — Ein-Schritt-3×3, kein Rahmen, hochauflösend */}
      <div className="glass rounded-[16px] p-3 space-y-2" style={{ outline: '2px solid rgba(53,209,90,.5)' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-role-label text-glass flex-1">★ Nano Banana (Gemini) — Ein Schritt, kein Rahmen, hochauflösend. Nutzt Illustration aus Schritt 1.</p>
          <select value={nbModel} onChange={e => setNbModel(e.target.value)}
            className="rounded-lg px-2 py-2 text-sm bg-black/5 dark:bg-white/10 text-glass">
            {NB_MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={nbRes} onChange={e => setNbRes(e.target.value)}
            className="rounded-lg px-2 py-2 text-sm bg-black/5 dark:bg-white/10 text-glass">
            <option value="1K">1K</option>
            <option value="2K">2K</option>
            <option value="4K">4K</option>
          </select>
          <Button onClick={runNB} disabled={nbLoad || !url} variant="secondary" size="sm">
            {nbLoad ? 'NB…' : 'NB 3×3'}
          </Button>
          {nbMeta && <span className="text-role-label text-glass-muted">{nbMeta}</span>}
        </div>
        {nbImg && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={nbImg} alt="NB" className="max-w-full rounded-xl" style={{ maxHeight: '80vh' }} />
            <a href={nbImg} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm">Öffnen</Button></a>
          </div>
        )}
      </div>

      {/* Replicate FLUX Fill — dediziertes Outpainting, Mitte bleibt exakt */}
      <div className="glass rounded-[16px] p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-role-label text-glass-muted flex-1">FLUX Fill (Replicate) — Outpaint, Mitte pixelgenau. Nutzt Illustration aus Schritt 1 (Gemini/CF), sonst die Karten-URL.</p>
          <Button onClick={runReplicate} disabled={repLoad || !url} variant="secondary" size="sm">
            {repLoad ? 'FLUX…' : 'FLUX Fill 3×3'}
          </Button>
          {repMeta && <span className="text-role-label text-glass-muted">{repMeta}</span>}
        </div>
        {repImg && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={repImg} alt="FLUX" className="max-w-full rounded-xl" style={{ maxHeight: '80vh' }} />
            <a href={repImg} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm">Öffnen</Button></a>
          </div>
        )}
      </div>

      {error && (
        <div className="text-role-body px-4 py-3 rounded-xl break-words"
          style={{ background: 'rgba(220,38,38,0.14)', border: '1px solid rgba(220,38,38,0.3)' }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 items-start">
        {/* Original */}
        <div className="space-y-2">
          <p className="text-role-label text-glass-muted">Original</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url && <img src={url} alt="Original" className="w-full rounded-xl" />}
        </div>

        {/* Schritt 1 */}
        <div className="space-y-2">
          <p className="text-role-label text-glass-muted">1) Illustration {meta1 ? `(${meta1})` : ''}</p>
          {art ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={art} alt="Illustration" className="w-full rounded-xl" />
              <Button onClick={step2} disabled={loading2} variant="secondary" size="sm" className="w-full">
                {loading2 ? 'Schritt 2…' : 'Schritt 2: 3×3 erweitern'}
              </Button>
              <a href={art} download="illustration.png">
                <Button variant="ghost" size="sm" className="w-full">Herunterladen</Button>
              </a>
            </>
          ) : (
            <div className="w-full aspect-[5/7] rounded-xl bg-black/10 dark:bg-white/10 flex items-center justify-center text-glass-muted text-role-label">
              {loading1 ? '…' : 'Schritt 1 ausführen'}
            </div>
          )}
        </div>

        {/* Schritt 2 */}
        <div className="space-y-2">
          <p className="text-role-label text-glass-muted">2) 3×3-Artwork {meta2 ? `(${meta2})` : ''}</p>
          {grid ? (
            <>
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={grid} alt="3x3" className="w-full rounded-xl" />
                {/* Hilfslinien: zeigen die 3×3-Schnittgrenzen (nur zur Kontrolle) */}
                <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="border border-white/40" />
                  ))}
                </div>
              </div>
              <a href={grid} download="artwork-3x3.png">
                <Button variant="secondary" size="sm" className="w-full">Herunterladen</Button>
              </a>
            </>
          ) : (
            <div className="w-full aspect-[5/7] rounded-xl bg-black/10 dark:bg-white/10 flex items-center justify-center text-glass-muted text-role-label">
              {loading2 ? '…' : 'aus Schritt 1'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
