'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, RefreshCw, Trash2, ScanLine } from 'lucide-react';
import { ButtonGroup } from '@/components/ui/button-group';
import { listScans, clearScans, type ScanHistoryEntry } from '@/lib/scanner/scan-history';
import { detectCardInFrame, loadCardDetectorSession, type CardBox } from '@/lib/scanner/card-detector-onnx';
import { computePixelMetrics, computeCriticalGlare, assessQuality } from '@/lib/scanner/frame-quality';
import { deskewCornersToImageData, SAMPLE_W, SAMPLE_H, type CaptureMeta } from '@/components/scanner/CameraCapture';

/**
 * Testmodus-Panel (Debug-Schalter „Testmodus"). Zeigt die zuletzt gescannten
 * Bilder und spielt sie erneut durch dieselbe Ampel-Bewertung (Reflexion/
 * Schärfe/Kanten) wie der echte Scanner — komplett OHNE Kamera, also auch im
 * Browser/am iPhone testbar. Zwei Modi:
 *   - „Nur Ampel": bewertet das Bild, zeigt Rahmen + Grund + Metriken, KEIN Gemini.
 *   - „Voll":      schickt EXAKT das gespeicherte Bild an Gemini (onRecognize) →
 *                  die normale erkannte-Karte-Anzeige der Seite übernimmt.
 */

interface Props {
  onClose: () => void;
  onRecognize: (imageBase64: string, mimeType: string, meta: CaptureMeta) => void;
}

const AMPEL_COLOR: Record<string, string> = { green: '#48bb78', yellow: '#facc15', red: '#ef4444', neutral: '#94a3b8' };

interface AssessResult { box: CardBox | null; meta: CaptureMeta; }

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Bewertet ein Bild GENAU wie doManualCapture (natives 190×266-Fenster für pm,
 *  entzerrte Karte für Zonen-Reflexion, fill=1, Lage-Gates als erfüllt). */
async function assessImage(img: HTMLImageElement): Promise<AssessResult> {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')!.drawImage(img, 0, 0);

  await loadCardDetectorSession();
  let box: CardBox | null = null;
  try { box = await detectCardInFrame(canvas, true); } catch { box = null; }

  // pm auf nativem, auf die Box zentriertem Fenster (gleiche Skala wie der Scanner).
  const sample = document.createElement('canvas');
  sample.width = SAMPLE_W; sample.height = SAMPLE_H;
  const sctx = sample.getContext('2d')!;
  const sw = Math.min(SAMPLE_W, canvas.width);
  const sh = Math.min(SAMPLE_H, canvas.height);
  let rx = Math.max(0, Math.round((canvas.width - sw) / 2));
  let ry = Math.max(0, Math.round((canvas.height - sh) / 2));
  if (box && box.w > 0 && box.h > 0) {
    rx = Math.max(0, Math.min(canvas.width - sw, Math.round(box.x + box.w / 2 - sw / 2)));
    ry = Math.max(0, Math.min(canvas.height - sh, Math.round(box.y + box.h / 2 - sh / 2)));
  }
  sctx.drawImage(canvas, rx, ry, sw, sh, 0, 0, sw, sh);
  const id = sctx.getImageData(0, 0, sw, sh);
  const pm = computePixelMetrics(id.data, sw, sh);

  let cg = { nameGlare: 0, codeGlare: 0 };
  if (box?.corners?.length === 4) {
    const out = document.createElement('canvas');
    const cd = deskewCornersToImageData(canvas, box.corners, out);
    cg = cd ? computeCriticalGlare(cd.data, cd.width, cd.height) : cg;
  } else {
    cg = computeCriticalGlare(id.data, sw, sh);
  }

  const cn = box?.corners?.length ?? 0;
  const qr = assessQuality(
    { ...pm, fill: 1, nameGlare: cg.nameGlare, codeGlare: cg.codeGlare },
    { boxSettled: true, boxFullyInside: true },
  );
  const meta: CaptureMeta = {
    trigger: 'test', level: qr.level, reason: qr.reason ?? undefined, boxDelta: 0,
    sharpness: pm.sharpness, contrast: pm.contrast, glare: pm.glare, softGlare: pm.softGlare,
    nameGlare: cg.nameGlare, codeGlare: cg.codeGlare, meanLum: pm.meanLum,
    fill: box ? (box.w * box.h) / (canvas.width * canvas.height) : 0,
    cornersN: cn,
    angleDeg: (cn === 4 && box?.corners)
      ? Math.round(Math.atan2(box.corners[1][1] - box.corners[0][1], box.corners[1][0] - box.corners[0][0]) * 180 / Math.PI)
      : 0,
  };
  return { box, meta };
}

/** Bild + Ampel-Kontur in ein Canvas (native Auflösung) zeichnen — CSS skaliert
 *  es später deckungsgleich herunter. */
function drawPreview(cv: HTMLCanvasElement, img: HTMLImageElement, box: CardBox | null, level: string) {
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const color = AMPEL_COLOR[level] ?? AMPEL_COLOR.neutral;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, Math.round(cv.width * 0.009));
  ctx.shadowColor = color;
  ctx.shadowBlur = ctx.lineWidth * 2;
  if (box?.corners?.length === 4) {
    const c = box.corners;
    ctx.beginPath();
    ctx.moveTo(c[0][0], c[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(c[i][0], c[i][1]);
    ctx.closePath();
    ctx.stroke();
  } else if (box) {
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  } else {
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, cv.width - ctx.lineWidth * 2, cv.height - ctx.lineWidth * 2);
  }
}

export function ScanTestPanel({ onClose, onRecognize }: Props) {
  const [entries, setEntries] = useState<ScanHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'ampel' | 'full'>('ampel');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ entry: ScanHistoryEntry; meta: CaptureMeta } | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setEntries(await listScans());
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const runEntry = useCallback(async (entry: ScanHistoryEntry) => {
    if (mode === 'full') {
      // Exakt dasselbe Bild an Gemini — reproduziert den echten Erkennungslauf.
      onRecognize(entry.imageBase64, entry.mimeType, { trigger: 'test', level: 'green' } as CaptureMeta);
      onClose();
      return;
    }
    setBusy(true);
    try {
      const img = await loadImage(`data:${entry.mimeType};base64,${entry.imageBase64}`);
      const { box, meta } = await assessImage(img);
      setPreview({ entry, meta });
      // nach dem Render zeichnen (Canvas ist dann gemountet)
      requestAnimationFrame(() => {
        if (previewCanvasRef.current) drawPreview(previewCanvasRef.current, img, box, meta.level);
      });
    } finally {
      setBusy(false);
    }
  }, [mode, onRecognize, onClose]);

  return (
    <div className="absolute inset-0 z-[60] flex flex-col" style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(6px)' }}>
      {/* Kopfzeile */}
      <div
        className="flex items-center justify-between px-4 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        <div className="flex items-center gap-2 text-white">
          <ScanLine size={18} />
          <span className="text-sm font-semibold">Testmodus</span>
        </div>
        <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center glass-overlay" aria-label="Schließen">
          <X size={18} color="#fff" />
        </button>
      </div>

      {preview ? (
        // ── Ampel-Vorschau eines Bildes ─────────────────────────────────────
        <div className="flex-1 min-h-0 flex flex-col items-center gap-3 px-4 overflow-y-auto pb-6">
          <div className="w-full flex items-center justify-center" style={{ maxHeight: '55vh' }}>
            <canvas ref={previewCanvasRef} className="rounded-xl" style={{ maxWidth: '100%', maxHeight: '55vh', height: 'auto', objectFit: 'contain' }} />
          </div>
          <div
            className="px-3 py-1.5 rounded-full text-sm font-bold"
            style={{ background: `${AMPEL_COLOR[preview.meta.level] ?? AMPEL_COLOR.neutral}22`, color: AMPEL_COLOR[preview.meta.level] ?? AMPEL_COLOR.neutral }}
          >
            {preview.meta.level.toUpperCase()}{preview.meta.reason ? ` · ${preview.meta.reason}` : ''}
          </div>
          <div className="w-full max-w-sm rounded-xl p-3 font-mono text-[11px] leading-relaxed text-white/85" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div>Schärfe {Math.round(preview.meta.sharpness)} · Kontrast {Math.round(preview.meta.contrast)} · Licht {Math.round(preview.meta.meanLum)}</div>
            <div>Glare {(preview.meta.glare * 100).toFixed(1)}% · Soft {(preview.meta.softGlare * 100).toFixed(1)}%</div>
            <div>Name {Math.round(preview.meta.nameGlare * 100)}% · Code {Math.round(preview.meta.codeGlare * 100)}%</div>
            <div>Ecken {preview.meta.cornersN} · Winkel {preview.meta.angleDeg}° · Füllung {Math.round(preview.meta.fill * 100)}%</div>
          </div>
          <div className="flex gap-2 w-full max-w-sm">
            <button
              onClick={() => { const e = preview.entry; setPreview(null); onRecognize(e.imageBase64, e.mimeType, preview.meta); onClose(); }}
              className="flex-1 h-11 rounded-full text-sm font-semibold text-white flex items-center justify-center gap-2"
              style={{ background: '#3182ce' }}
            >
              <ScanLine size={16} /> An Gemini senden
            </button>
            <button
              onClick={() => setPreview(null)}
              className="h-11 px-4 rounded-full text-sm font-semibold text-white/85 flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.12)' }}
            >
              Zurück
            </button>
          </div>
        </div>
      ) : (
        // ── Liste der gespeicherten Scans ───────────────────────────────────
        <div className="flex-1 min-h-0 flex flex-col px-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <ButtonGroup
              value={mode}
              onChange={setMode}
              options={[
                { value: 'ampel', label: 'Nur Ampel' },
                { value: 'full',  label: 'Voll (Gemini)' },
              ]}
              className="flex-1 max-w-[240px]"
            />
            {entries.length > 0 && (
              <button
                onClick={async () => { await clearScans(); void refresh(); }}
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.1)' }}
                aria-label="Historie leeren"
              >
                <Trash2 size={16} color="#ff8a8a" />
              </button>
            )}
          </div>

          {busy && (
            <div className="flex items-center gap-2 text-white/80 text-sm mb-3">
              <RefreshCw size={15} className="animate-spin" /> Bild wird bewertet …
            </div>
          )}

          {loading ? (
            <p className="text-white/60 text-sm">Lade Historie …</p>
          ) : entries.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 px-6">
              <ScanLine size={32} color="rgba(255,255,255,0.35)" />
              <p className="text-white/70 text-sm">Noch keine Scans gespeichert.</p>
              <p className="text-white/45 text-xs">Scanne ein paar Karten (Auto oder Manuell) — die letzten 20 gesendeten Bilder landen hier zum Nachstellen.</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-3 gap-2 pb-6">
              {entries.map(e => (
                <button
                  key={e.id}
                  onClick={() => runEntry(e)}
                  className="relative rounded-xl overflow-hidden text-left"
                  style={{ background: 'rgba(255,255,255,0.06)', aspectRatio: '3 / 4' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:${e.mimeType};base64,${e.imageBase64}`} alt={e.label} className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 px-1.5 py-1" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.85))' }}>
                    <p className="text-white text-[10px] font-medium leading-tight truncate">{e.label}</p>
                    <p className="text-[9px]" style={{ color: e.ok ? '#8ff0b0' : '#ff8a8a' }}>{e.ok ? '✓ erkannt' : '✕'}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
