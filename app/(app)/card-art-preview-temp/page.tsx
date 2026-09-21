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
