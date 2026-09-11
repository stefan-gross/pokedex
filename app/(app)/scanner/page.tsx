'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Loader2, AlertCircle, Check, Plus, ChevronLeft, AlertTriangle, EyeOff, SearchX, Flag, Trash2, Pencil, LayoutGrid, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Dialog } from '@/components/ui/modal';
import { CameraCapture } from '@/components/scanner/CameraCapture';
import { CardDetailSheet } from '@/components/card/CardDetailSheet';
import { AddToCollectionModal } from '@/components/scanner/AddToCollectionModal';
import { DeleteFromCollectionModal } from '@/components/scanner/DeleteFromCollectionModal';
import { RecognizedAddBar } from '@/components/scanner/RecognizedAddBar';
import { Grabber } from '@/components/ui/Grabber';
import { useGrabberCollapse } from '@/lib/hooks/use-grabber-collapse';
import { getCardBySetCodeAndNumberRest as getCardBySetCodeAndNumber,
         getCardBySetAndNumberRest    as getCardBySetAndNumber,
         getCardsByDexNumberRest      as getCardsByDexNumber,
         getCardsByNameAndNumberRest  as getCardsByNameAndNumber,
         getCardsByNamePrefixRest     as getCardsByNamePrefix,
         getDexForNameRest            as getDexForName } from '@/lib/firestore/catalog-rest';
import { resolveScannedCard } from '@/lib/scan/resolve-card';
import { ScanTestPanel } from '@/components/scanner/ScanTestPanel';
import { getCatalogCardsByIds, type CatalogCard } from '@/lib/firestore/catalog';
import { addCard, getCardsByTcgId, updateCard } from '@/lib/firestore/cards';
import { addCardToBinder, ensureDefaultBinder, getBinders } from '@/lib/firestore/binders';
import { matchTemplateBinders } from '@/lib/template-binders/match-hint';
import { syncTemplateBinders } from '@/lib/template-binders/sync';
import { BulkAddToCollectionModal } from '@/components/scanner/BulkAddToCollectionModal';
import { ValueBadge } from '@/components/card/ValueBadge';
import { CardPrice } from '@/components/card/CardPrice';
import { CardBadge } from '@/components/card/CardBadge';
import { ExclamationMark } from '@/lib/binder-icons';
import { CardPlaceholder } from '@/components/card/CardPlaceholder';
import { CardImage } from '@/components/card/CardImage';
import { Card } from '@/components/card/Card';
import { playScanSound, playScanCaptureSound, unlockScanSound } from '@/lib/scanner/scan-sound';
import { isTestModeEnabled } from '@/lib/scanner/test-mode';
import { CardTileButton } from '@/components/card/CardTileButton';
import { catalogCardToInfo, cardInfoToAddInput, resolveCardImage } from '@/lib/card-info';
import { cardImageCandidates } from '@/lib/card-image';
import type { CardInfo } from '@/lib/card-info';
import type { CardCondition as PersistedCondition, CardDoc, CardLanguage, CardVariant } from '@/types';
import { CONDITIONS, VARIANT_LABELS, SERIES_NAMES_DE, SYMBOL_ONLY_SERIES, inherentFoilVariant, holoShimmerClass } from '@/lib/card-constants';
import { useSetMeta } from '@/lib/hooks/use-set-meta';
import { CardNameLabel } from '@/components/card/CardNameLabel';
import { getSetById, getSetIdsByPrintedTotal } from '@/lib/firestore/sets';
import { recordScanEvent, recordScanCase, bumpScanStats, markEventReported, updateScanEventPHash, type ScanOutcome, type ScanQuality } from '@/lib/scanner/scan-telemetry';
import { ScanReportSheet, type ScanReportResult } from '@/components/scanner/ScanReportSheet';
import { ScanCorrectionPanel } from '@/components/scanner/ScanCorrectionPanel';
import type { CaptureMeta } from '@/components/scanner/CameraCapture';

// Gemini liefert Condition in Kurzform (lowercase). Für Persistence wird in
// die offizielle CardCondition (uppercase) gemappt.
export type CardCondition = 'nm' | 'lp' | 'mp' | 'hp' | 'd';

const GEMINI_TO_PERSISTED: Record<CardCondition, PersistedCondition> = {
  nm: 'NM', lp: 'LP', mp: 'MP', hp: 'HP', d: 'Poor',
};

// Fake-Risk → Border-Color der Tile
const FAKE_RISK_BORDER: Record<'low' | 'medium' | 'high', string> = {
  low:    'rgba(72,187,120,.70)',
  medium: 'rgba(234,179,8,.70)',
  high:   'rgba(239,68,68,.80)',
};

const PERSISTED_CONDITION_COLOR: Record<PersistedCondition, { bg: string; text: string }> = {
  NM:   { bg: 'rgba(34,197,94,.85)',  text: '#fff' },
  LP:   { bg: 'rgba(132,204,22,.85)', text: '#fff' },
  MP:   { bg: 'rgba(234,179,8,.85)',  text: '#000' },
  HP:   { bg: 'rgba(249,115,22,.85)', text: '#fff' },
  Poor: { bg: 'rgba(239,68,68,.85)',  text: '#fff' },
};

interface GeminiResponse {
  setCode?: string;                      // gedrucktes Set-Kürzel (z.B. "ASC", "SSP")
  number?: string;
  printedTotal?: number | null;          // Gesamtzahl aus derselben "NNN/TTT"-Prägung, unabhängig von number gelesen
  name?: string;                         // gedruckter Karten-Name (Pokémon/Trainer/Energy)
  language?: string;
  confidence?: string;
  nationalDexNumber?: number | null;
  hp?: number | null;                    // KP/HP neben dem Kartennamen (für Platzhalter)
  energyType?: string | null;            // NUR Basis-Energie: Typ aus dem Zentralsymbol
  condition?: CardCondition;
  fakeRisk?: 'low' | 'medium' | 'high';
  fakeReasons?: string[];
  error?: string;
  // Direkter Server-seitiger Katalog-Lookup (number+dex, vor Schritt 2) — siehe
  // tryDirectCatalogLookup in app/api/scan/route.ts.
  _preLookup?: {
    attempted: boolean;
    matched: boolean;
    via?: string;
    cardId?: string;
    candidateCount?: number;
    /** Fertig aufgelöstes Katalog-Dokument — wenn vorhanden, überspringt der
     *  Client seine eigene (zweite) Firestore-Katalogsuche komplett. */
    card?: CatalogCard;
  };
  // Kandidaten aus dem Symbolabgleich (Schritt 2), ORDER nach Wahrscheinlichkeit —
  // der Client probiert sie der Reihe nach durch und verifiziert per Dex-Nr./
  // Gesamtzahl-Gegenprobe, statt Gemini's Top-1-Rang blind zu vertrauen.
  candidateSetCodes?: string[];
  // Debug-Info zum Schritt-2-Symbolabgleich — IMMER gesetzt (auch wenn nicht ausgelöst),
  // damit im Debug-Modal sichtbar ist, warum ein Match ggf. nicht versucht wurde.
  _symbolMatch?: {
    triggered: boolean;
    reason?: string;                       // gesetzt wenn triggered=false
    error?: string;                        // gesetzt wenn Schritt 2 fehlgeschlagen ist
    candidateSetCodes?: string[];
    rejectedMatches?: string[];            // Codes, die Gemini lieferte, die aber auf keinem Blatt existieren
    matchConfidence?: string | null;
    matchAmbiguous?: boolean;
    sheetsUsed?: string[];
    sheetBuildMs?: number;                 // Kaltstart-Kosten (Icon-Fetch + Sharp-Komposition)
    model?: string;
    ms?: number;                           // reine Gemini-Zeit für Schritt 2
    attempts?: FallbackAttempt[];          // alle Versuche inkl. fehlgeschlagener 503-Retries
    rawText?: string;
  };
}

interface FallbackAttempt {
  model: string;
  ms: number;
  ok: boolean;
  error?: string;
}

interface ScanState {
  card: CardInfo | null;
  language: CardLanguage;
  variant?: CardVariant;
  ownedCount?: number;
  /** Mind. ein besessenes Exemplar ist noch ungeprüft (needsReview) → gelbes
   *  „!"-Badge auf der Kachel, solange nicht alle Exemplare geprüft sind. */
  ownedNeedsReview?: boolean;
  /** Die besessenen Exemplare — an die Card-Komponente durchgereicht, damit sie
   *  die Standard-Badges (Anzahl/„ungeprüft") app-einheitlich rendert. */
  ownedCards?: CardDoc[];
  condition?: CardCondition;
  fakeRisk?: 'low' | 'medium' | 'high';
  fakeReasons?: string[];
  /** Bei mehrdeutiger Erkennung (mehrere Karten passen gleich gut): die
   *  Kandidaten zur Auswahl. `card` zeigt vorläufig den ersten. */
  candidates?: CardInfo[];
}

interface ScanDebug {
  imageBase64?: string;          // Bild das an Gemini geschickt wurde
  mimeType?: string;
  imageSizeKb?: number;
  geminiModel?: string;          // Welches Gemini-Modell hat geantwortet
  geminiMs?: number;             // Reines Gemini-Modell (server-gemessen)
  geminiAttempts?: FallbackAttempt[]; // alle Versuche Schritt 1 inkl. fehlgeschlagener 503-Retries
  uploadMs?: number;             // echte Netzwerk-/Server-Zeit: fetch-Roundtrip minus ALLER
                                  // Gemini-Versuche (Schritt 1 + 2, auch fehlgeschlagene) + Sheets
  lookupMs?: number;             // Catalog-Lookups (setCode/number + dexNr-Fallback)
  ownedMs?: number;              // getCardsByTcgId Owned-Count (asynchron)
  totalMs?: number;              // Gesamtdauer Scan→Render (ohne ownedMs)
  geminiRaw?: string;            // Rohantwort von Gemini (vor JSON-Parse)
  geminiParsed?: unknown;        // Geparste Gemini-Antwort
  lookupSteps?: string[];        // Welche DB-Lookups wurden probiert
  catalogMatch?: { id: string; name: string; setId: string; number: string } | null;
  error?: string;
}

interface ScanJob {
  id: string;
  origin: 'add' | 'recognize';   // aus welchem Modus stammt der Snap — steuert Slider/Review-Sichtbarkeit
  status: 'processing' | 'done' | 'error';
  result: ScanState | null;
  added?: boolean;
  debugInfo?: string;           // Kurz-Status (z.B. unten am Thumbnail)
  debug?: ScanDebug;            // Detail-Debug für Modal (enthält imageBase64 als einzige Quelle)
  // User-bearbeitbare Felder (initialisiert aus Gemini-Result, danach Pill-Editierbar)
  editedVariant?:   CardVariant;
  editedCondition?: PersistedCondition;
  editedLanguage?:  CardLanguage;
  // Slider-Markierung (User-Tap im Stapel-Scan = "bitte später nochmal prüfen")
  flaggedManual?: boolean;
  // Bild-Verifikation per pHash (kommt mit Phase 5) — niedrig=match, hoch=mismatch
  pHashDistance?: number;
  // Ampel-Bewertung des aufgenommenen Fotos (aus CaptureMeta) — färbt während der
  // Verarbeitung den Rahmen (grün/gelb/rot) + Hinweis, v.a. im manuellen Modus.
  captureLevel?: string;
  captureReason?: string;
  // Telemetrie: Original-Meta (Qualität + Vollbild) + verknüpftes scan_events-Doc
  // (für den „Melden"-Flow, der die Grundwahrheit nachträgt).
  captureMeta?: CaptureMeta;
  eventId?: string;
  outcome?: ScanOutcome;
}

/** CaptureMeta → kompakte Qualitätswerte für die Telemetrie (ohne Bild). */
function metaToQuality(meta?: CaptureMeta): ScanQuality | undefined {
  if (!meta) return undefined;
  return {
    trigger: meta.trigger, captureMode: meta.trigger === 'manual' ? 'manual' : 'auto',
    level: meta.level, sharpness: meta.sharpness, contrast: meta.contrast,
    glare: meta.glare, softGlare: meta.softGlare, nameGlare: meta.nameGlare, codeGlare: meta.codeGlare,
    meanLum: meta.meanLum, fill: meta.fill, cornersN: meta.cornersN, angleDeg: meta.angleDeg,
  };
}

/** Nicht-Standard-Werte einer erkannten Scan-Karte (Variante ≠ standard, Zustand
 *  ≠ NM, Sprache ≠ de) als kurze Labels — für die Anzeige unter der Kachel. */
function nonDefaultScanMeta(job: ScanJob): string[] {
  const out: string[] = [];
  const variant = job.editedVariant ?? job.result?.variant ?? job.result?.card?.variants?.[0];
  const cond = job.editedCondition ?? (job.result?.condition ? GEMINI_TO_PERSISTED[job.result.condition] : undefined);
  const lang = job.editedLanguage ?? job.result?.language;
  if (variant && variant !== 'standard') out.push(VARIANT_LABELS[variant] ?? variant);
  if (cond && cond !== 'NM') out.push(cond);
  if (lang && lang !== 'de') out.push(String(lang).toUpperCase());
  return out;
}

/** Positions-Marker für den Einzelkarten-Swipe — im Stil einer Apple
 *  „Liquid Glass"-Page-Control: eine getönte Glas-Kapsel mit Punkten, der
 *  aktive hell/größer, die übrigen gedimmt. Bei vielen Karten zeigt ein
 *  gleitendes Fenster von max. 7 Punkten die Position; liegen außerhalb noch
 *  Karten, schrumpft der jeweils äußerste Punkt (iOS-Konvention „es geht weiter").
 *  So sieht man auf einen Blick Anfang / Mitte / Ende des Stapels. */
function SliderPageDots({ total, index }: { total: number; index: number }) {
  const MAX = 7;
  const count = Math.min(total, MAX);
  // Fenster so verschieben, dass der aktive Punkt möglichst mittig sitzt.
  const start = total > MAX
    ? Math.min(Math.max(index - Math.floor(MAX / 2), 0), total - MAX)
    : 0;
  const moreBefore = start > 0;
  const moreAfter  = start + count < total;
  return (
    <div
      className="inline-flex items-center gap-[6px] rounded-full px-2.5 py-1.5"
      style={{
        background: 'rgba(255,255,255,0.14)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.18)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
      }}
      aria-label={`Karte ${index + 1} von ${total}`}
    >
      {Array.from({ length: count }, (_, i) => {
        const d = start + i;
        const active = d === index;
        // Äußersten Punkt schrumpfen, wenn dort noch weitere Karten liegen.
        const edgeShrink = (moreBefore && i === 0) || (moreAfter && i === count - 1);
        const size = active ? 8 : edgeShrink ? 4 : 6;
        return (
          <span
            key={d}
            style={{
              width: size, height: size, borderRadius: '50%',
              background: active ? '#fff' : 'rgba(255,255,255,0.42)',
              transition: 'width 160ms ease, height 160ms ease, background 160ms ease',
            }}
          />
        );
      })}
    </div>
  );
}

type BorderStatus = 'none' | 'manual-yellow' | 'auto-yellow' | 'auto-red' | 'error';

/** Berechnet den visuellen Status (Rahmenfarbe) eines Jobs.
 *  Reihenfolge der Priorität: error > pHash-mismatch > pHash-unsure > manual-flag > none. */
function computeBorderStatus(job: ScanJob): BorderStatus {
  if (job.status === 'error') return 'error';
  const dist = job.pHashDistance;
  // pHash-Mismatch-Warnung (gelb/rot) NUR bei MEHRDEUTIGER Erkennung — dort diente
  // der pHash zur Auswahl des besten Kandidaten, eine hohe Distanz heißt „auch der
  // beste passt schlecht" (echter Prüf-Hinweis). Bei einem EINDEUTIGEN, starken
  // Treffer (setCode+Nummer etc.) ist eine hohe Distanz dagegen meist ein Foto-
  // Artefakt (Glanz/Winkel/abweichendes Katalogbild) — dann KEINE Warnung, sonst
  // werden korrekt erkannte Karten fälschlich rot umrahmt.
  const ambiguous = (job.result?.candidates?.length ?? 0) > 1;
  if (typeof dist === 'number' && ambiguous) {
    // Schwellwerte synchron mit classifyPHashDistance() in lib/scan/image-hash.ts
    if (dist >= 32) return 'auto-red';
    if (dist >= 21) return 'auto-yellow';
  }
  if (job.flaggedManual) return 'manual-yellow';
  return 'none';
}

/** Rahmen-Farbe und -Breite für ein Tile abhängig vom BorderStatus. */
function borderStyleFor(status: BorderStatus, fakeRisk?: string): { border: string } {
  if (status === 'auto-red')                     return { border: '2.5px solid #ef4444' };
  if (status === 'auto-yellow' || status === 'manual-yellow') return { border: '2.5px solid #facc15' };
  if (fakeRisk) {
    const c = (fakeRisk in FAKE_RISK_BORDER) ? FAKE_RISK_BORDER[fakeRisk as keyof typeof FAKE_RISK_BORDER] : 'rgba(255,255,255,0.15)';
    return { border: `2.5px solid ${c}` };
  }
  return { border: '2.5px solid rgba(255,255,255,0.15)' };
}

/** Karten-Name normalisieren für Gegenproben (klein, nur Buchstaben/Ziffern). */
function normalizeCardName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9äöü]/g, '');
}

/** Levenshtein-Distanz (für OCR-tolerante Namens-Gegenprobe). */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Vorschaubild während der Verarbeitung: das aufgenommene Foto (base64 ist die
 *  einzige Quelle — kein Duplikat im State). Sonst null. */
function processingPhoto(job: ScanJob): string | null {
  return (job.status === 'processing' && job.debug?.imageBase64)
    ? `data:${job.debug.mimeType ?? 'image/jpeg'};base64,${job.debug.imageBase64}`
    : null;
}

// Alle Scanner-Bildquellen laufen über die ZENTRALE Kandidaten-Logik
// (`cardImageCandidates`, inkl. Storage-Fallback + Sprachreihenfolge) — dieselbe,
// die Grid/Detail/Picker nutzen. Hier nur die Scan-Job-Hülle (Foto während der
// Verarbeitung + Sprache aus dem Ergebnis).
function cardImgUrl(job: ScanJob): string | null {
  const photo = processingPhoto(job);
  if (photo) return photo;
  const card = job.result?.card;
  if (!card) return null;
  return cardImageCandidates(card, { size: 'small', language: job.result?.language })[0] ?? null;
}

/** ALLE Bild-Kandidaten in Prioritätsreihenfolge — RecognizedCardLarge probiert
 *  bei 404/Ladefehler automatisch den nächsten, bevor sie aufgibt. */
function cardImgUrlsLarge(job: ScanJob): string[] {
  const card = job.result?.card;
  if (!card) return [];
  return cardImageCandidates(card, { size: 'large', language: job.result?.language });
}

/** Klassifiziert einen Error-Job und gibt thematische Karten-Daten zurück.
 *  Wird sowohl vom großen Error-Sheet (Einzelmodus) als auch von der
 *  Mini-Error-Karte im Review-Grid genutzt. */
type ErrorKind = 'gemini-blind' | 'gemini-thin' | 'catalog-miss' | 'non-western';
interface ErrorClass {
  kind: ErrorKind;
  Icon: typeof EyeOff;
  iconColor: string;
  cardName: string;
  attackTitle: string;
  attackText: string;
}
function classifyJobError(job: ScanJob): ErrorClass {
  const gp = job.debug?.geminiParsed as
    | { error?: string; setCode?: string | null; number?: string | null;
        language?: string; nationalDexNumber?: number | null; printedTotal?: number | null }
    | undefined;
  const lang = gp?.language;
  const isNonWestern = lang && !['de', 'en', 'fr', 'es', 'it', 'pt'].includes(lang);

  if (gp?.error || job.debug?.error === 'No card detected') {
    return {
      kind: 'gemini-blind',
      Icon: EyeOff,
      iconColor: '#facc15',
      cardName: 'Enigmon',
      attackTitle: 'Keine Karte im Bild',
      attackText: 'Halte die Karte deutlicher in den Rahmen.',
    };
  }
  // „Nicht vollständig erkannt" gilt in ZWEI Fällen:
  //  a) keine Sammelnummer (Mindestanforderung jedes Lookups), ODER
  //  b) Sammelnummer da, aber KEIN set-unterscheidendes Signal (Set-Kürzel,
  //     Gesamtzahl „/TTT" oder Pokédex-Nr.). Die Nummer allein („081") wiederholt
  //     sich in fast jedem Set → daraus lässt sich weder ein Treffer erzwingen
  //     noch ein „nicht im Katalog" ehrlich behaupten. Beides ist ein zu dünner
  //     Scan → näher/ohne Reflexion neu scannen, nicht „nicht im Katalog".
  const hasStrongId = !!(gp?.setCode || gp?.printedTotal != null || gp?.nationalDexNumber != null);
  if (!gp?.number || !hasStrongId) {
    return {
      kind: 'gemini-thin',
      Icon: AlertTriangle,
      iconColor: '#fb923c',
      cardName: 'Enigmon',
      attackTitle: 'Karte nicht vollständig erkannt',
      attackText: 'Set-Kürzel und Gesamtzahl (die „…/…"-Zahl) unten an der Karte wurden nicht gelesen — dann ist keine sichere Zuordnung möglich. Rücke näher heran und entferne Hülle/Reflexion, damit die untere Karten-Ecke scharf ist.',
    };
  }
  if (isNonWestern) {
    return {
      kind: 'non-western',
      Icon: AlertTriangle,
      iconColor: '#fb923c',
      cardName: 'Enigmon',
      attackTitle: `Nicht-Western-Karte (${lang?.toUpperCase()})`,
      attackText: lang === 'ja'
        ? 'Japanische Karten nutzen ein eigenes Code-System und sind im Katalog nicht enthalten.'
        : 'Der Katalog enthält aktuell nur Western-Sets (DE/EN/FR/ES/IT/PT).',
    };
  }
  return {
    kind: 'catalog-miss',
    Icon: SearchX,
    iconColor: '#f87171',
    cardName: 'Enigmon',
    attackTitle: 'Im Katalog nicht gefunden',
    attackText: 'Möglicherweise ein Set, das noch nicht synchronisiert wurde. Versuche es nochmal oder synchronisiere die Daten.',
  };
}

/** Inline-SVG-Artwork der Error-Karte — gezeichnete Landschaft (Busch + Teich
 *  im Vordergrund, Vulkan im Hintergrund, großes Fragezeichen im Vordergrund),
 *  im Stil eines echten Pokémon-Karten-Artworks statt der früheren Glitch-Optik. */
function ErrorLandscapeArtwork({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 140" className={className} preserveAspectRatio="xMidYMid slice" aria-hidden>
      {/* Himmel */}
      <rect x="0" y="0" width="200" height="140" fill="#bcd9e8" />
      {/* Vulkan im Hintergrund */}
      <path d="M 70 90 L 108 24 L 118 24 L 150 90 Z" fill="#8a7a68" stroke="#3a332c" strokeWidth="2" strokeLinejoin="round" />
      <path d="M 96 44 L 113 24 L 118 24 L 130 44 Z" fill="#5c4d40" stroke="#3a332c" strokeWidth="2" strokeLinejoin="round" />
      <path d="M 108 24 Q 112 15 108 8" fill="none" stroke="#9a9a9a" strokeWidth="4" strokeLinecap="round" opacity="0.65" />
      <path d="M 116 24 Q 122 13 117 4" fill="none" stroke="#9a9a9a" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
      {/* Ferner Hügelzug */}
      <path d="M 0 96 Q 30 82 60 94 T 200 90 L 200 140 L 0 140 Z" fill="#a9c98f" opacity="0.8" />
      {/* Wiese im Vordergrund */}
      <path d="M 0 108 Q 50 96 100 108 T 200 106 L 200 140 L 0 140 Z" fill="#8fb86c" />
      {/* Teich */}
      <ellipse cx="48" cy="120" rx="34" ry="12" fill="#6fb7d6" stroke="#3a332c" strokeWidth="2" />
      <path d="M 24 120 Q 48 126 72 120" fill="none" stroke="#e8f4fa" strokeWidth="1.5" opacity="0.7" />
      {/* Busch */}
      <g stroke="#3a332c" strokeWidth="2" strokeLinejoin="round">
        <circle cx="158" cy="112" r="16" fill="#5a9950" />
        <circle cx="174" cy="116" r="12" fill="#5a9950" />
        <circle cx="146" cy="118" r="11" fill="#4d8a44" />
      </g>
      {/* Großes Fragezeichen im Vordergrund */}
      <text
        x="100"
        y="112"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="92"
        fontWeight="700"
        fill="#2b2b2b"
        stroke="#f5f0da"
        strokeWidth="3"
        paintOrder="stroke"
      >
        ?
      </text>
    </svg>
  );
}

export default function ScannerPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  // Symbol-Icons für Set-Badges im Slider/Review-Grid — kein Hook-in-Loop möglich
  // (Tiles werden inline in .map() gerendert, nicht als eigene Komponente), daher
  // ein simpler setId→symbolUrl-Cache statt useSetMeta() pro Tile.
  const [setSymbolMap, setSetSymbolMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const missingSetIds = new Set<string>();
    jobs.forEach(j => {
      const c = j.result?.card;
      if (c?.setId && c.series && SYMBOL_ONLY_SERIES.includes(c.series) && !setSymbolMap.has(c.setId)) {
        missingSetIds.add(c.setId);
      }
    });
    if (missingSetIds.size === 0) return;
    let cancelled = false;
    Promise.all([...missingSetIds].map(async setId => {
      const doc = await getSetById(setId).catch(() => null);
      return [setId, doc?.symbolUrl] as const;
    })).then(results => {
      if (cancelled) return;
      setSetSymbolMap(prev => {
        const next = new Map(prev);
        results.forEach(([setId, symbolUrl]) => { if (symbolUrl) next.set(setId, symbolUrl); });
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [jobs, setSymbolMap]);

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeOwnedCopies, setActiveOwnedCopies] = useState<CardDoc[]>([]);
  // „Melden"-Flow: Job, dessen Erkennung gemeldet wird (Grundwahrheit erfassen).
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [reportToast, setReportToast] = useState(false);
  const [mode, setMode] = useState<'scanning' | 'review'>('scanning');
  // Review-Modus-Ansichten: grid (Default, 2-Spalten) / single (eine Karte groß + Swipe)
  const [viewMode, setViewMode] = useState<'grid' | 'single'>('grid');
  // Status-Filter im Review: alle / erfolgreich (kein Rahmen) / gelb / rot+error
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'yellow' | 'red'>('all');
  // Single-View-Index — welche Karte gerade angezeigt wird (0 = neueste, N-1 = älteste)
  const [singleIdx, setSingleIdx] = useState<number>(0);
  // Ref für Horizontal-Swipe-Geste im Single-View (Pointer-Start-X)
  const swipeStartXRef = useRef<number | null>(null);
  // Startzeit der Geste — für Flick-Erkennung (kurzer, schneller Wisch snappt
  // auch bei geringer Strecke auf die nächste/vorherige Karte).
  const swipeStartTimeRef = useRef<number>(0);
  // Zuverlässiges „Swipe läuft"-Signal (unabhängig von Pointer-Capture, die durch
  // Re-Renders des separaten Panels verloren gehen kann). Entscheidung beim
  // Loslassen anhand des getrackten Drag-Offsets, nicht der Pointer-Position.
  const swipeActiveRef = useRef<boolean>(false);
  // Aktueller Drag-Offset als REF (nicht State) — der Up-Handler-Closure würde
  // sonst einen veralteten singleDragX lesen (State-Update aus dem letzten Move
  // ist beim Pointer-Up noch nicht neu gerendert) und den Swipe als Tap werten.
  const swipeDragXRef = useRef<number>(0);
  // Live-Drag-Offset während der Geste (Karte folgt dem Finger)
  const [singleDragX, setSingleDragX] = useState<number>(0);
  // Stapel-Interaktion. Animationsphase nach Pointer-Up:
  //  'commit-advance'  → oberste Karte fliegt zur Seite raus (Finger-Richtung), danach idx+1
  //  'commit-restore'  → vorherige Karte gleitet vom Rand in die Mitte, danach idx-1
  //  'snap'            → Karte snappt in Ausgangslage zurück (abgebrochen)
  const [singleAnim, setSingleAnim] = useState<
    'commit-advance' | 'commit-restore' | 'snap' | null
  >(null);
  // Gesten-Modus — RICHTUNGSbasiert (nicht Start-Zone): beim ersten spürbaren
  // Move entschieden. Von der Mitte weg = 'advance' (oberste Karte raus), zur
  // Mitte hin = 'restore' (vorherige Karte zurück). So kann man die Karte überall
  // anpacken und der Restore-Wisch startet auf der Karte (nicht am Bildschirmrand
  // → keine Browser-Zurück-Geste).
  const [singleMode, setSingleMode] = useState<'advance' | 'restore' | null>(null);
  const swipeModeRef = useRef<'advance' | 'restore' | null>(null);
  // Startposition als Anteil (0..1) der Breite — Basis für die Richtungslogik.
  const swipeStartFxRef = useRef<number>(0.5);
  // Rand-Vorzeichen bei 'restore' (−1 = von links, +1 = von rechts) und
  // Flug-Richtung bei 'advance' (Vorzeichen des Drag beim Loslassen).
  const restoreEdgeRef = useRef<number>(1);
  const advanceSignRef = useRef<number>(1);
  // Gemessene Panel-Breite für px-genaue Translate-Berechnung der eingehenden Karte
  const [singlePanelWidth, setSinglePanelWidth] = useState<number>(0);
  const singlePanelRef = useCallback((node: HTMLDivElement | null) => {
    if (node) setSinglePanelWidth(node.offsetWidth);
  }, []);
  // Sicherheitsnetz: schließt die Swipe-Animation garantiert ab, falls
  // `transitionend` mal nicht feuert (Mount-/Transition-Edge, v.a. bei der
  // eingleitenden Karte) — sonst bliebe der Swipe hängen. onTransitionEnd
  // setzt singleAnim → null; das cleart den Timer via Cleanup (kein Doppel-Commit).
  useEffect(() => {
    if (!singleAnim) return;
    const anim = singleAnim;
    const t = setTimeout(() => {
      if (anim === 'commit-advance') setSingleIdx(i => i + 1);
      else if (anim === 'commit-restore') setSingleIdx(i => Math.max(0, i - 1));
      setSingleDragX(0);
      setSingleAnim(null);
      setSingleMode(null);
    }, 260);
    return () => clearTimeout(t);
  }, [singleAnim]);
  // Long-Press für Markieren (>= 500ms ohne signifikante Bewegung)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef<boolean>(false);
  // Scanner-Workflow: Hinzufügen (Slider-Sammlung) vs. Erkennen (Lookup-Anzeige).
  const [scanMode, setScanMode] = useState<'add' | 'recognize'>('recognize');
  // Stream-Lifecycle: Auto-Start beim Mount — der BottomNav-FAB navigiert
  // direkt hierher, der User erwartet sofort Kamera. Kein Re-Tap nötig.
  const [cameraActive, setCameraActive] = useState<boolean>(true);
  const [streamPaused, setStreamPaused] = useState(false);
  // Im Erkennen-Modus: ID des aktuell zentral angezeigten Jobs. Wird beim
  // erfolgreichen Recognize-Scan gesetzt; Resume-Tap räumt ihn zurück.
  const [recognizedJobId, setRecognizedJobId] = useState<string | null>(null);
  // Mehrfachscan: angetippte Slider-Karte → Korrektur-Ansicht (wie Einzelscan).
  const [correctJobId, setCorrectJobId] = useState<string | null>(null);
  // „Alle löschen" fragt vor dem Verwerfen nach (Bulk-Aktion, nicht umkehrbar).
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  // Review-Grid: Mehrfachauswahl zum gebündelten Hinzufügen/Löschen.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);
  // Ref für scanMode — handleCapture hat empty-deps useCallback,
  // ohne Ref wäre der Wert stale.
  const scanModeRef = useRef(scanMode);
  useEffect(() => { scanModeRef.current = scanMode; }, [scanMode]);
  // Testmodus-Panel (gespeicherte Scans erneut durch die Pipeline, ohne Kamera).
  const [testPanelOpen, setTestPanelOpen] = useState(false);
  // Testmodus-Einstieg (oben mittig) nur zeigen, wenn in den Einstellungen aktiv.
  const [testModeEnabled, setTestModeEnabledState] = useState(false);
  useEffect(() => { setTestModeEnabledState(isTestModeEnabled()); }, []);

  // Auslöse-Modus: 'auto' (grün-gegatetes Auto-Auslösen, wie bisher) vs.
  // 'manual' (kein Live-Erkennen/Ampel, nur Ziel-Rahmen; Foto per Footer-Scan-
  // Button, Erkennung/Zuschnitt danach auf dem Standbild). In localStorage gemerkt.
  const [captureMode, setCaptureMode] = useState<'auto' | 'manual'>('auto');
  // Ref-Spiegel — handleCapture (empty-deps) liest den Modus asynchron nach der
  // Hintergrund-Erkennung (Auto-Stopp bei Fehler im Mehrfachscan).
  const captureModeRef = useRef(captureMode);
  useEffect(() => { captureModeRef.current = captureMode; }, [captureMode]);
  useEffect(() => {
    try { const v = localStorage.getItem('scanner-capture-mode'); if (v === 'manual' || v === 'auto') setCaptureMode(v); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('scanner-capture-mode', captureMode); } catch { /* ignore */ }
  }, [captureMode]);
  // Warmup (#2): beim Öffnen des Scanners die /api/scan-Route vorwärmen (Admin-SDK,
  // Referenzblätter, Serverless-Coldstart) → der erste echte Scan zahlt das nicht.
  useEffect(() => {
    fetch('/api/scan', { method: 'GET' }).catch(() => { /* best-effort */ });
  }, []);
  // Manueller Auslöser: der Footer-Scan-Button erhöht diesen Zähler → CameraCapture
  // reagiert per useEffect und macht das Standbild.
  const [shutterSignal, setShutterSignal] = useState(0);
  const switchCaptureMode = useCallback((m: 'auto' | 'manual') => {
    setCaptureMode(m);
    // Stream nur „aufwecken", wenn gerade KEINE erkannte Karte gezeigt wird —
    // sonst würde ein A|M-Wechsel die Ergebnis-Anzeige wegblenden (Stream lief
    // wieder an → live Kamera). Bei sichtbarer erkannter Karte bleibt alles
    // stehen; der Moduswechsel greift erst beim nächsten Scan.
    if (!recognizedJobId) setStreamPaused(false);
  }, [recognizedJobId]);

  // Quick-Add via +-Button: öffnet AddToCollectionModal direkt (kein
  // CardDetailSheet-Zwischenschritt). preVariant/preCondition aus dem Job.
  const [quickAddJobId, setQuickAddJobId] = useState<string | null>(null);
  const quickAddJob = jobs.find(j => j.id === quickAddJobId) ?? null;

  // Löschen via -Button: öffnet DeleteFromCollectionModal direkt (kein
  // CardDetailSheet-Zwischenschritt), analog zum Quick-Add-Modal oben.
  const [quickDeleteJobId, setQuickDeleteJobId] = useState<string | null>(null);
  const quickDeleteJob = jobs.find(j => j.id === quickDeleteJobId) ?? null;

  // Fehler-Diagnose-Modal (tappbar im Slider + Review-Grid)
  const [errorDetailJobId, setErrorDetailJobId] = useState<string | null>(null);
  const errorDetailJob = jobs.find(j => j.id === errorDetailJobId) ?? null;

  // Fake-Reasons-Popup: zeigt Gemini-Begründungen warum die Karte als
  // medium/high fake-risk eingestuft wurde.
  const [fakeReasonsJobId, setFakeReasonsJobId] = useState<string | null>(null);
  const fakeReasonsJob = jobs.find(j => j.id === fakeReasonsJobId) ?? null;
  // FIFO-Queue für Uploads: parallele Scans senden nacheinander statt
  // gleichzeitig — verhindert Bandbreiten-Konkurrenz auf schwachem Mobilnetz.
  const uploadChainRef = useRef<Promise<unknown>>(Promise.resolve());

  // Slider-Ref + Auto-Scroll-to-end: NUR wenn eine NEUE Karte dazukommt (Add-
  // Anzahl steigt) nach ganz rechts scrollen. Nicht beim Löschen, Status-Update
  // o.Ä. — sonst würde der Slider zurückspringen, während man im Pause-/Manuell-
  // Modus nach links scrollt, um eine Karte zu löschen (Nutzerwunsch: erst beim
  // nächsten Scan wieder nach rechts).
  const sliderRef = useRef<HTMLDivElement>(null);
  const prevAddCountRef = useRef(0);
  useEffect(() => {
    const addLen = jobs.filter(j => j.origin === 'add').length;
    const grew = addLen > prevAddCountRef.current;
    prevAddCountRef.current = addLen;
    if (grew && sliderRef.current) {
      sliderRef.current.scrollTo({ left: sliderRef.current.scrollWidth, behavior: 'smooth' });
    }
  }, [jobs]);

  // Scan-Ton-AudioContext einmalig bei der ersten User-Geste entsperren (iOS
  // verlangt das) — danach dürfen auch die geste-losen Auto-Scan-Töne abspielen.
  useEffect(() => {
    const unlock = () => unlockScanSound();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  // ── BottomNav-Bridge ────────────────────────────────────────────────────
  // Stream-Pause-Toggle vom BottomNav-FAB
  const toggleStreamPaused = useCallback(() => {
    if (!cameraActive) { setCameraActive(true); setStreamPaused(false); return; }
    setStreamPaused(prev => {
      if (prev) {
        // Resume: alten Recognize-Job aufräumen
        setRecognizedJobId(null);
        setJobs(p => p.filter(j => j.origin !== 'recognize'));
        return false;
      }
      return true;
    });
  }, [cameraActive]);

  // Mode-Switch vom BottomNav
  const switchScanMode = useCallback((m: 'add' | 'recognize') => {
    setJobs(prev => prev.filter(j => j.origin !== 'recognize'));
    setRecognizedJobId(null);
    setStreamPaused(false);
    setScanMode(m);
  }, []);

  // Grid-Toggle vom BottomNav
  const toggleGridMode = useCallback(() => {
    setMode(m => m === 'scanning' ? 'review' : 'scanning');
  }, []);

  // Einzeln-Modus: erkannte Karte, die gerade hinzugefügt werden könnte —
  // steuert den animierten +-Button oberhalb der FAB (BottomNav).
  const recognizedJob = jobs.find(j => j.id === recognizedJobId) ?? null;
  const recognizedCard = recognizedJob?.result?.card;
  const canAddRecognized = !!recognizedCard
    && !recognizedJob.added
    && recognizedJob.result!.ownedCount !== undefined;
  // Löschen-Button neben dem +-Button: erscheint nur, wenn die erkannte Karte
  // bereits im Besitz ist. Tap öffnet DeleteFromCollectionModal (siehe
  // onRemoveRecognized unten) — kompakter Löschen-Drawer mit einer Zeile pro
  // Exemplar (auch bei mehreren Exemplaren).
  const canDeleteRecognized = !!recognizedCard && (recognizedJob?.result?.ownedCount ?? 0) > 0;

  // Events vom BottomNav abonnieren
  useEffect(() => {
    const onTogglePause = () => toggleStreamPaused();
    const onToggleMode  = (e: Event) => {
      const m = (e as CustomEvent<'add' | 'recognize'>).detail;
      if (m) switchScanMode(m);
    };
    const onToggleGrid  = () => toggleGridMode();
    const onAddRecognized = () => {
      if (recognizedJobId) setQuickAddJobId(recognizedJobId);
    };
    const onRemoveRecognized = () => {
      if (recognizedJobId) setQuickDeleteJobId(recognizedJobId);
    };
    const onToggleCapture = (e: Event) => {
      const m = (e as CustomEvent<'auto' | 'manual'>).detail;
      if (m === 'auto' || m === 'manual') switchCaptureMode(m);
    };
    const onShutter = () => setShutterSignal(s => s + 1);
    window.addEventListener('scanner-toggle-pause', onTogglePause);
    window.addEventListener('scanner-toggle-mode',  onToggleMode as EventListener);
    window.addEventListener('scanner-toggle-grid',  onToggleGrid);
    window.addEventListener('scanner-add-recognized', onAddRecognized);
    window.addEventListener('scanner-remove-recognized', onRemoveRecognized);
    window.addEventListener('scanner-toggle-capture', onToggleCapture as EventListener);
    window.addEventListener('scanner-shutter', onShutter);
    return () => {
      window.removeEventListener('scanner-toggle-pause', onTogglePause);
      window.removeEventListener('scanner-toggle-mode',  onToggleMode as EventListener);
      window.removeEventListener('scanner-toggle-grid',  onToggleGrid);
      window.removeEventListener('scanner-add-recognized', onAddRecognized);
      window.removeEventListener('scanner-remove-recognized', onRemoveRecognized);
      window.removeEventListener('scanner-toggle-capture', onToggleCapture as EventListener);
      window.removeEventListener('scanner-shutter', onShutter);
    };
  }, [toggleStreamPaused, switchScanMode, toggleGridMode, switchCaptureMode, recognizedJobId]);

  // State an BottomNav schicken — paused/scanMode/jobsCount/gridVisible/reviewMode/canAdd
  const addJobsCount = jobs.filter(j => j.origin === 'add').length;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('scanner-state-changed', {
      detail: {
        paused: streamPaused,
        scanMode,
        captureMode,
        jobsCount: addJobsCount,
        // „Prüfen"-Chip in der BottomNav-Leiste (fest verankert) — nur im
        // Mehrfachscan mit gesammelten Karten, NICHT während das Korrektur-
        // Overlay offen ist (dort verdeckt der Chip sonst die Ansicht).
        gridVisible: scanMode === 'add' && addJobsCount > 0 && !correctJobId,
        reviewMode: mode === 'review',
        canAdd: canAddRecognized,
        canDelete: canDeleteRecognized,
      },
    }));
  }, [streamPaused, scanMode, captureMode, addJobsCount, mode, canAddRecognized, canDeleteRecognized, correctJobId]);

  // Beim Unmount: Reset, damit andere Seiten nicht den Scan-Pause-FAB sehen
  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('scanner-state-changed', {
        detail: { paused: false, scanMode: 'recognize', captureMode: 'auto', jobsCount: 0, gridVisible: false, reviewMode: false, canAdd: false, canDelete: false },
      }));
    };
  }, []);

  const reportJob = jobs.find(j => j.id === reportJobId) ?? null;

  const pendingCount = jobs.filter(j => j.status === 'processing').length;
  const doneJobs = jobs.filter(j => j.status === 'done' && j.result?.card);
  const activeJob = jobs.find(j => j.id === activeJobId) ?? null;

  // ── Memory-Wächter ─────────────────────────────────────────────────────────
  // Zählt unerledigte Add-Jobs (noch nicht in Sammlung übernommen). Ab 30 →
  // Warn-Banner; ab 40 → kritisch + Auto-Pause des Streams. Hysterese: erst
  // wenn < 25 wieder unten → Stream darf wieder laufen.
  const unaddedCount = jobs.filter(j =>
    j.origin === 'add' && (j.status !== 'done' || !j.added)
  ).length;
  const memoryLevel: 'ok' | 'warn' | 'critical' =
    unaddedCount >= 40 ? 'critical' :
    unaddedCount >= 30 ? 'warn' : 'ok';

  // Auto-Pause bei critical, Auto-Resume erst bei < 25 Jobs (Hysterese).
  const autoPausedRef = useRef(false);
  useEffect(() => {
    if (memoryLevel === 'critical' && !streamPaused) {
      autoPausedRef.current = true;
      setStreamPaused(true);
    } else if (autoPausedRef.current && unaddedCount < 25 && streamPaused) {
      autoPausedRef.current = false;
      setStreamPaused(false);
    }
  }, [memoryLevel, streamPaused, unaddedCount]);

  const removeJob = useCallback((id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id));
    setActiveJobId(prev => (prev === id ? null : prev));
  }, []);

  const markAdded = useCallback((id: string, opts?: { keepJob?: boolean }) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, added: true } : j));
    setActiveJobId(null);
    // `keepJob` (Einzelscan): Job NICHT automatisch entfernen — die erkannte
    // Karte soll mit ihren Daten stehen bleiben, bis der Nutzer den Bildschirm
    // schließt oder den Scan-Button drückt (Resume räumt selbst auf). Sonst
    // (Mehrfach-Slider/Review-Tiles): Memory-Cleanup 3s nach dem Hinzufügen —
    // das Tile verschwindet, die Karte selbst bleibt persistent in Firestore.
    if (opts?.keepJob) return;
    setTimeout(() => {
      setJobs(prev => prev.filter(j => j.id !== id));
    }, 3000);
  }, []);

  // Nach dem Hinzufügen ist die Karte jetzt im Besitz — ownedCount neu laden,
  // damit der Löschen-Button (FAB) sofort erscheint statt erst beim nächsten
  // Scan (ownedCount wurde bisher nur einmal direkt nach dem Erkennen gesetzt).
  const refreshOwnedCount = useCallback((jobId: string, tcgId: string) => {
    getCardsByTcgId(tcgId).then(copies => {
      const ownedNeedsReview = copies.some(c => c.needsReview);
      setJobs(prev => prev.map(j =>
        j.id === jobId && j.result ? { ...j, result: { ...j.result, ownedCount: copies.length, ownedNeedsReview, ownedCards: copies } } : j
      ));
    });
  }, []);

  /** Memory-Cleanup: nach 60s wird das Base64-Bild aus einem Job entfernt (Error
   *  ODER erfolgreich erkannt). Das Bild hatte nur als Diagnose-Hilfe Sinn (Debug-
   *  Modal, pHash-Vergleich) — der User hat genug Zeit, es sich anzuschauen.
   *  Verhindert, dass viele Snaps × 50-250 KB dauerhaft im Heap bleiben. */
  const scheduleImageCleanup = useCallback((id: string) => {
    setTimeout(() => {
      setJobs(prev => prev.map(j =>
        j.id === id && j.debug?.imageBase64
          ? { ...j, debug: { ...j.debug, imageBase64: undefined } }
          : j
      ));
    }, 60_000);
  }, []);

  /** Toggle manueller Gelb-Markierung — Slider-Tap-Toggle. */
  const toggleManualFlag = useCallback((id: string) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, flaggedManual: !j.flaggedManual } : j));
  }, []);

  // Idempotent: bei unverändertem Wert dieselbe `prev`-Referenz zurückgeben, damit
  // React kein Re-Render auslöst (der onVariantChange-Effekt in RecognizedAddBar
  // feuert sonst über den inline-Callback bei jedem Render eine Schleife).
  const setJobVariant = useCallback((id: string, variant: CardVariant) => {
    setJobs(prev => prev.some(j => j.id === id && j.editedVariant !== variant)
      ? prev.map(j => j.id === id ? { ...j, editedVariant: variant } : j) : prev);
  }, []);

  const setJobCondition = useCallback((id: string, condition: PersistedCondition) => {
    setJobs(prev => prev.some(j => j.id === id && j.editedCondition !== condition)
      ? prev.map(j => j.id === id ? { ...j, editedCondition: condition } : j) : prev);
  }, []);

  const setJobLanguage = useCallback((id: string, language: CardLanguage) => {
    setJobs(prev => prev.some(j => j.id === id && j.editedLanguage !== language)
      ? prev.map(j => j.id === id ? { ...j, editedLanguage: language } : j) : prev);
  }, []);

  // „Alle hinzufügen" öffnet jetzt ein Bulk-Modal zur Bestätigung der Werte.
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const openBulkAdd = useCallback(() => {
    // Im Auswahl-Modus nur die ausgewählten Karten, sonst alle unadded.
    const targets = jobs.filter(j => j.status === 'done' && !!j.result?.card && !j.added
      && (selectMode && selectedIds.size ? selectedIds.has(j.id) : true));
    if (targets.length === 0) return;
    setBulkModalOpen(true);
  }, [jobs, selectMode, selectedIds]);

  // Verlassen des Scanners: Sind noch gescannte Karten offen (weder hinzugefügt
  // NOCH gelöscht), erst nachfragen — beim Verlassen gehen sie verloren
  // (Nutzerwunsch: KEIN stilles Auto-Speichern mehr).
  const [confirmExit, setConfirmExit] = useState(false);
  const pendingExitCount = jobs.filter(j => j.origin === 'add' && !j.added).length;
  const handleClose = useCallback(() => {
    if (jobs.some(j => j.origin === 'add' && !j.added)) { setConfirmExit(true); return; }
    router.push('/');
  }, [jobs, router]);

  const clearAllJobs = useCallback(() => {
    setJobs([]);
    setActiveJobId(null);
    setQuickAddJobId(null);
    setFakeReasonsJobId(null);
    setRecognizedJobId(null);
  }, []);

  // Owned-Copies frisch laden, wenn ein Job ausgewählt wird (für das CardDetailSheet).
  useEffect(() => {
    if (!activeJobId) { setActiveOwnedCopies([]); return; }
    const job = jobs.find(j => j.id === activeJobId);
    const card = job?.result?.card;
    if (!card) { setActiveOwnedCopies([]); return; }
    let cancelled = false;
    getCardsByTcgId(card.id)
      .then(copies => { if (!cancelled) setActiveOwnedCopies(copies); })
      .catch(() => { if (!cancelled) setActiveOwnedCopies([]); });
    return () => { cancelled = true; };
  }, [activeJobId, jobs]);

  const handleCapture = useCallback(async (imageBase64: string, mimeType: string, meta?: CaptureMeta) => {
    const id = Math.random().toString(36).slice(2);
    const t0 = Date.now();
    // Testmodus-Einspeisung (gespeicherte Bilder erneut durch die Pipeline):
    // KEINE Telemetrie/Statistik schreiben, sonst verfälschen Testläufe den
    // Fehler-Korpus (scan_cases) und die Scan-Stats.
    const isTest = meta?.trigger === 'test';
    const imageSizeKb = Math.round((imageBase64.length * 3 / 4) / 1024);

    const debug: ScanDebug = { imageBase64, mimeType, imageSizeKb, lookupSteps: [] };
    // Telemetrie-Event-ID (wird nach dem Ergebnis gesetzt) — die spätere,
    // asynchrone pHash-Distanz wird darüber an dasselbe Event angehängt.
    let eventIdPromise: Promise<string | null> | null = null;

    // Bild wird nur EINMAL gespeichert (in debug.imageBase64) — verhindert
    // doppelten Speicherverbrauch (vorher: capturedImageBase64 + debug.imageBase64
    // hat iOS PWA bei vielen Scans gecrasht).
    const origin = scanModeRef.current;
    // Auto-Stopp bei Fehler: kommt eine Karte im Mehrfachscan-AUTOMATIK als nicht
    // erkannt (Fehler/unauflösbar) aus der Hintergrund-Erkennung zurück, den
    // Stream (async) pausieren — so kann der Nutzer reagieren, ohne dass der
    // schnelle Flow pro Karte blockiert.
    const stopAutoOnFail = () => {
      if (origin === 'add' && captureModeRef.current === 'auto') setStreamPaused(true);
    };
    setJobs(prev => {
      // Im Einzeln-Modus immer nur EIN Recognize-Job gleichzeitig: alte raus.
      const base = origin === 'recognize'
        ? prev.filter(j => j.origin !== 'recognize')
        : prev;
      return [...base, { id, origin, status: 'processing', result: null, debug, captureLevel: meta?.level, captureReason: meta?.reason, captureMeta: meta }];
    });
    // Sofort ein neutraler Auslöse-Ton („aufgenommen/bereit"). Der Erfolg-/
    // Fehlerton kommt später nach der Erkennung (siehe unten).
    if (!isTest) playScanCaptureSound();
    // Im Einzeln-Modus Stream SOFORT pausieren — verhindert Folge-Snaps während
    // Gemini noch arbeitet, die Seite zeigt die erkannte Karte groß. Im
    // Mehrfachscan NICHT pausieren: die Karte landet direkt im Slider und wird
    // im Hintergrund erkannt, während der Nutzer weiterscannt.
    if (origin === 'recognize') {
      setStreamPaused(true);
    }

    try {
      // ── FIFO-Upload-Queue: warten bis vorheriger Upload fertig ist ────────
      // (verhindert Bandbreiten-Konkurrenz auf schwachem Mobilnetz)
      const prevUpload = uploadChainRef.current;
      const tFetch = Date.now();
      const myUpload = prevUpload.then(async () => {
        // ── AbortController: 90s Timeout (Gemini hat gelegentlich 20-30s
        // Latenz; iOS-PWA-Standalone kann Page kurz pausieren) ────────────
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 90_000);
        try {
          // Binär statt base64-JSON: spart ~25 % Transfer + den großen String-
          // Parse serverseitig. Der MIME-Typ steckt im Content-Type-Header; der
          // Server liest die Bytes und base64-kodiert selbst für Gemini.
          const binStr = atob(imageBase64);
          const bytes = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
          return await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': mimeType },
            body: bytes,
            signal: ac.signal,
          });
        } finally {
          clearTimeout(to);
        }
      });
      uploadChainRef.current = myUpload.catch(() => {}); // Chain-Bruch verhindern
      const res = await myUpload;
      const gemini: GeminiResponse & { _debug?: { model: string; ms: number; attempts?: FallbackAttempt[]; rawText: string } }
        = await res.json();
      const fetchMs = Date.now() - tFetch;

      debug.geminiModel    = gemini._debug?.model;
      debug.geminiMs       = gemini._debug?.ms ?? fetchMs;
      debug.geminiAttempts = gemini._debug?.attempts;
      // Reine Netzwerk-/Server-Overhead-Zeit (Upload+Parse+Download) — ALLE
      // Gemini-Versuche müssen rausgerechnet werden, nicht nur der erfolgreiche:
      // schlägt z.B. gemini-2.5-flash-lite mit 503 fehl und Schritt 1 fällt auf
      // gemini-2.5-flash zurück, verschwand die Zeit des fehlgeschlagenen
      // Versuchs bisher unsichtbar in diesem Bucket. Gleiches gilt für Schritt 2
      // (Symbolabgleich) inkl. Referenzblätter-Bau.
      const sumAttempts = (attempts?: FallbackAttempt[]) => (attempts ?? []).reduce((sum, a) => sum + a.ms, 0);
      const step1TotalMs = gemini._debug?.attempts ? sumAttempts(gemini._debug.attempts) : gemini._debug?.ms;
      const step2TotalMs = gemini._symbolMatch?.triggered
        ? (gemini._symbolMatch.attempts ? sumAttempts(gemini._symbolMatch.attempts) : (gemini._symbolMatch.ms ?? 0)) + (gemini._symbolMatch.sheetBuildMs ?? 0)
        : 0;
      debug.uploadMs    = step1TotalMs != null ? fetchMs - step1TotalMs - step2TotalMs : undefined;
      debug.geminiRaw   = gemini._debug?.rawText;
      debug.geminiParsed = { ...gemini, _debug: undefined };
      console.log('[scanner] Gemini response:', { fetchMs, uploadMs: debug.uploadMs, gemini });

      // Gemini-Antwort als Debug-Info aufzeichnen
      const fakeTag = gemini.fakeRisk && gemini.fakeRisk !== 'low' ? ` ⚠️${gemini.fakeRisk}` : '';
      const geminiSummary = gemini.error
        ? `Gemini: ${gemini.error}`
        : `Gemini: ${gemini.setCode ?? (gemini.candidateSetCodes?.length ? `[${gemini.candidateSetCodes.join('/')}]` : '?')}/${gemini.number ?? '?'} ${gemini.language ?? '?'} (${gemini.confidence ?? '?'})${fakeTag}`;

      // Im Mehrere-Modus: "No card detected" stillschweigend verwerfen, statt
      // den Slider mit nutzlosen Error-Tiles zu fluten. Im Einzeln-Modus zeigen
      // wir den Fehler weiterhin (User will Feedback).
      if (gemini.error === 'No card detected' && scanModeRef.current === 'add') {
        setJobs(prev => prev.filter(j => j.id !== id));
        return;
      }

      // Hard-Fail nur wenn Gemini explizit „kein Karte" sagt ODER alle Identifier
      // fehlen. Mit dem neuen Prompt ist setCode=null bei Pre-S&V-Karten normal.
      const hasUsefulInfo = !!(gemini.setCode || gemini.number || gemini.nationalDexNumber || gemini.name);
      if (gemini.error || !hasUsefulInfo) {
        debug.error = gemini.error ?? 'Kein lesbarer Karten-Text';
        debug.totalMs = Date.now() - t0;
        const errDebug: ScanDebug = { ...debug };
        setJobs(prev => prev.map(j => j.id === id
          ? { ...j, status: 'error', result: { card: null, language: (gemini.language ?? 'de') as CardLanguage }, debugInfo: geminiSummary, debug: errDebug }
          : j));
        stopAutoOnFail();
        if (!isTest) playScanSound(false);   // Fehlton: nichts Lesbares erkannt
        // Telemetrie: Fehl-/Nichterkennung als Event + vollen Fall (mit Bildern).
        {
          const outcome: ScanOutcome = gemini.error ? 'error' : 'not_recognized';
          const quality = metaToQuality(meta);
          const gm = {
            name: gemini.name, setCode: gemini.setCode, number: gemini.number,
            printedTotal: gemini.printedTotal, nationalDexNumber: gemini.nationalDexNumber,
            hp: gemini.hp, language: gemini.language, confidence: gemini.confidence, error: gemini.error,
            model: gemini._debug?.model, ms: gemini._debug?.ms, attempts: gemini._debug?.attempts?.length,
          };
          if (!isTest) {
            void recordScanEvent({ outcome, quality, gemini: gm }).then(eventId => {
              if (eventId) setJobs(prev => prev.map(j => j.id === id ? { ...j, eventId, outcome } : j));
              void recordScanCase({
                outcome, quality, gemini: gm, reportType: 'auto_fail',
                warpedCropBase64: imageBase64, originalFrameBase64: meta?.originalFrameBase64, mimeType,
                lookupSteps: debug.lookupSteps, geminiRaw: gemini._debug?.rawText, eventId: eventId ?? undefined,
              });
            });
            void bumpScanStats(outcome, quality, undefined, gemini._debug?.ms);
          }
        }
        scheduleImageCleanup(id);
        return;
      }

      const rawNumber = typeof gemini.number === 'string' && gemini.number.includes('/')
        ? gemini.number.split('/')[0]
        : (gemini.number ?? '');

      // ── Catalog-Lookups (lookupMs misst diesen ganzen Block) ─────────────
      const tLookup = Date.now();
      let catalogCard = null as CatalogCard | null;
      let ambiguousCandidates: CatalogCard[] | null = null;
      let dexCandidateCount = 0;

      // Set-printedTotal-Cache für diesen Scan — vermeidet doppelte getSetById-Calls,
      // wenn mehrere Kandidaten (Dex-Fallback, Name+Number-Mehrdeutigkeit) geprüft werden.
      const setTotalCache = new Map<string, number | null>();
      const getSetPrintedTotal = async (setId: string): Promise<number | null> => {
        if (!setTotalCache.has(setId)) {
          const doc = await getSetById(setId).catch(() => null);
          setTotalCache.set(setId, doc?.printedTotal ?? null);
        }
        return setTotalCache.get(setId) ?? null;
      };

      // ── Schnellpfad: Server hat die Karte bereits aufgelöst (number+dex etc.)
      //    und mitgeschickt → die komplette zweite Firestore-Suche (Regel-Leiter
      //    + Fallback-Kette) überspringen. Spart einen Client-Firestore-Roundtrip
      //    und umgeht das Client-WebChannel-Coldstart-Risiko für den Normalfall. ──
      if (gemini._preLookup?.card) {
        catalogCard = gemini._preLookup.card;
        debug.lookupSteps!.push(`Server-Vorabtreffer (${gemini._preLookup.via}): ${gemini._preLookup.cardId}`);
      }

      // ── Primär: zentrale Regel-Leiter (lib/scan/resolve-card.ts) ──────────
      // R1 setCode+number · R2 printedTotal+number · R3 name+number · R4 dex+number,
      // jeweils mit Eindeutigkeits-Gate. Symbolabgleich-Kandidaten
      // (candidateSetCodes) bewusst NICHT hier — die sind unten die letzte Not-Option.
      if (!catalogCard) {
      const resolved = await resolveScannedCard(
        {
          setCode: gemini.setCode,
          number: rawNumber || null,
          printedTotal: gemini.printedTotal ?? null,
          name: gemini.name ?? null,
          nationalDexNumber: gemini.nationalDexNumber ?? null,
          energyType: gemini.energyType ?? null,
        },
        {
          bySetCodeAndNumber: getCardBySetCodeAndNumber,
          bySetAndNumber: getCardBySetAndNumber,
          byNameAndNumber: getCardsByNameAndNumber,
          byDexNumber: (dex: number) => getCardsByDexNumber(dex, 100),
          setIdsByPrintedTotal: getSetIdsByPrintedTotal,
          setPrintedTotal: getSetPrintedTotal,
          byNamePrefix: (prefix: string) => getCardsByNamePrefix(prefix, 40),
          dexForName: getDexForName,
        },
      );
      debug.lookupSteps!.push(...resolved.trace);
      if (resolved.status === 'unique') {
        catalogCard = resolved.card!;
      } else if (resolved.status === 'ambiguous') {
        ambiguousCandidates = resolved.candidates!;
        // Vorläufig den ersten Kandidaten zeigen; die Kandidaten-Auswahl-UI
        // (nächster Schritt) lässt den Nutzer gezielt wählen.
        catalogCard = ambiguousCandidates[0];
        debug.lookupSteps!.push(`mehrdeutig (${resolved.matchedBy}): ${ambiguousCandidates.length} Kandidaten`);
      }
      } // Ende Schnellpfad-Guard: nur suchen, wenn der Server nichts mitschickte

      // ── Fallback (nur wenn die Regel-Leiter NICHTS fand): alte Lookups +
      //    Symbolabgleich-Kandidaten als letzte Not-Option ────────────────────
      // 1) Direkter SetCode+Number-Lookup — probiert entweder Gemini's direkt
      //    gelesenes Klartext-Kürzel (S&V, ein einzelner Wert), oder — wenn das
      //    fehlt — der Reihe nach ALLE Symbolabgleich-Kandidaten (`candidateSetCodes`,
      //    von Schritt 2, nach Wahrscheinlichkeit sortiert), bis einer die Dex-Nr.-/
      //    Gesamtzahl-Gegenprobe besteht. So muss Gemini's Symbol-Ranking nicht auf
      //    Anhieb stimmen — es reicht, wenn der richtige Code IRGENDWO in der Liste
      //    steht, die deterministische Katalog-Gegenprobe entscheidet dann.
      const tryCatalogLookupBySetCode = async (setCode: string) => {
        let result = null as Awaited<ReturnType<typeof getCardBySetCodeAndNumber>>;

        // pokemontcg.io speichert "number" grundsätzlich OHNE führende Nullen
        // (auch wenn die Karte selbst "005" aufgedruckt hat) — unser Katalog
        // übernimmt dieses Feld 1:1 (lib/sync-catalog.ts). Die von Gemini
        // gelesene, gepolsterte Zahl ("062") trifft also so gut wie nie; zuerst
        // die normalisierte (führende Nullen entfernt) probieren spart in der
        // Mehrheit der Fälle einen Firestore-Roundtrip.
        const normalized = /^\d+$/.test(rawNumber) ? String(parseInt(rawNumber, 10)) : rawNumber;
        debug.lookupSteps!.push(`getCardBySetCodeAndNumber("${setCode}", "${normalized}")`);
        result = await getCardBySetCodeAndNumber(setCode, normalized);
        debug.lookupSteps![debug.lookupSteps!.length - 1] += result ? ` → ${result.id}` : ' → null';

        // Fallback: gepolsterte Schreibweise (falls der Katalog für dieses Set
        // doch mit führenden Nullen gespeichert ist).
        if (!result && normalized !== rawNumber) {
          debug.lookupSteps!.push(`getCardBySetCodeAndNumber("${setCode}", "${rawNumber}")`);
          result = await getCardBySetCodeAndNumber(setCode, rawNumber);
          debug.lookupSteps![debug.lookupSteps!.length - 1] += result ? ` → ${result.id}` : ' → null';
        }

        // Dex-Nummer-Gegenprobe: Gemini liest Dex-Nr. unabhängig vom setCode
        // (eigenes Feld im Prompt). Weicht sie von der gefundenen Karte ab, war
        // der setCode falsch (z.B. Symbolabgleich hat ein ähnliches, aber
        // falsches Set getroffen) — verwerfen und nächsten Kandidaten probieren.
        if (result && gemini.nationalDexNumber && result.nationalDexNumber
            && result.nationalDexNumber !== gemini.nationalDexNumber) {
          debug.lookupSteps!.push(
            `verworfen: Dex-Nr. passt nicht (Katalog=${result.nationalDexNumber}, Gemini=${gemini.nationalDexNumber})`,
          );
          result = null;
        }

        // Gesamtzahl-Gegenprobe: dieselbe Idee wie die Dex-Gegenprobe, aber mit der
        // unabhängig gelesenen `printedTotal` ("053/172" → 172). Fängt z.B. den Fall
        // ab, dass ein setCode-Treffer zwar denselben Namen+Nummer hat, aber aus dem
        // falschen Set stammt (unterschiedliche Gesamtzahl verrät das zuverlässig).
        if (result && gemini.printedTotal) {
          const setTotal = await getSetPrintedTotal(result.setId);
          if (setTotal && setTotal !== gemini.printedTotal) {
            debug.lookupSteps!.push(
              `verworfen: Set-Gesamtzahl passt nicht (Katalog=${setTotal}, Gemini=${gemini.printedTotal})`,
            );
            result = null;
          }
        }

        // Namens-Gegenprobe: bei Promos fehlen Dex UND printedTotal → der Name ist
        // dann die EINZIGE Kontrolle gegen ein falsches setCode-Ergebnis (z.B.
        // Symbolabgleich "BKP" → Clefairy statt Mega-Quajutsu). Passt der von Gemini
        // gelesene Name zu keinem Namensfeld der Karte (DE/EN, Teil-Übereinstimmung
        // erlaubt), verwerfen.
        if (result && gemini.name) {
          const g = normalizeCardName(gemini.name);
          const cand = [result.nameLower, result.nameDeLower, result.name, result.nameDe]
            .filter((x): x is string => !!x)
            .map(normalizeCardName);
          const ok = g.length >= 3 && cand.some(c =>
            c.length >= 3 && (c === g || c.includes(g) || g.includes(c) || levenshtein(c, g) <= 2));
          if (!ok) {
            debug.lookupSteps!.push(
              `verworfen: Name passt nicht (Katalog="${result.nameDe ?? result.name}", Gemini="${gemini.name}")`,
            );
            result = null;
          }
        }
        return result;
      };

      if (!catalogCard && !ambiguousCandidates && rawNumber) {
        const codesToTry = gemini.setCode ? [gemini.setCode] : (gemini.candidateSetCodes ?? []);
        for (const code of codesToTry) {
          catalogCard = await tryCatalogLookupBySetCode(code);
          if (catalogCard) break;
        }
      }

      // 3) Name+Number-Fallback — bestes Identifier-Paar wenn setCode fehlt
      //    (Trainer haben keinen Dex; bei Karten ohne Letter-Code ist der
      //    gedruckte Karten-Name eindeutig pro Number).
      if (!catalogCard && gemini.name && rawNumber) {
        debug.lookupSteps!.push(`getCardsByNameAndNumber("${gemini.name}", "${rawNumber}")`);
        const nameCards = await getCardsByNameAndNumber(gemini.name, rawNumber);
        debug.lookupSteps![debug.lookupSteps!.length - 1] += ` → ${nameCards.length} Kandidaten`;

        if (nameCards.length === 0) {
          // Format-Variante probieren
          const alt = /^\d+$/.test(rawNumber)
            ? String(parseInt(rawNumber, 10))
            : rawNumber.padStart(3, '0');
          if (alt !== rawNumber) {
            debug.lookupSteps!.push(`getCardsByNameAndNumber("${gemini.name}", "${alt}")`);
            const altCards = await getCardsByNameAndNumber(gemini.name, alt);
            debug.lookupSteps![debug.lookupSteps!.length - 1] += ` → ${altCards.length} Kandidaten`;
            if (altCards.length === 1) {
              catalogCard = altCards[0];
            } else if (altCards.length > 1) {
              ambiguousCandidates = altCards;
              catalogCard = altCards[0];
            }
          }
        } else if (nameCards.length > 1) {
          // Mehrdeutig — z.B. derselbe Name+Nummer existiert zufällig in zwei
          // verschiedenen Sets (Clefairy #53 in EX Unseen Forces UND Brilliant
          // Stars). Gesamtzahl-Gegenprobe entscheidet, wenn Gemini sie gelesen hat.
          let picked: typeof nameCards[number] | null = null;
          if (gemini.printedTotal) {
            for (const c of nameCards) {
              const setTotal = await getSetPrintedTotal(c.setId);
              if (setTotal === gemini.printedTotal) { picked = c; break; }
            }
          }
          if (picked) {
            catalogCard = picked;
            debug.lookupSteps!.push(
              `name+number mehrdeutig: ${nameCards.length} Kandidaten — per Set-Gesamtzahl (${gemini.printedTotal}) auf ${picked.id} aufgelöst`,
            );
          } else {
            // Mehrere Karten teilen Name+Nummer (verschiedene Sets), keine
            // Gesamtzahl trennt sie → NICHT raten, Kandidaten zur Auswahl zeigen.
            ambiguousCandidates = nameCards;
            catalogCard = nameCards[0];
            debug.lookupSteps!.push(`name+number mehrdeutig: ${nameCards.length} — Kandidaten zur Auswahl (nicht geraten)`);
          }
        } else {
          catalogCard = nameCards[0];
        }
      }

      // 4) Fallback: Pokédex-Nummer + Number-Filter. NIE blind raten — nur wenn
      //    die gelesene Nummer TATSÄCHLICH zu Karten dieser Dex-Nummer passt.
      //    Passt sie zu keiner (z.B. eine Promo/Neuware, die (noch) nicht im
      //    Katalog ist), lieber ehrlich „nicht gefunden" zeigen, statt irgendeine
      //    Karte des Pokémon zu präsentieren — das war die Ursache dafür, dass
      //    beim wiederholten Scannen jedes Mal eine ANDERE (falsche) Karte kam
      //    (Geminis OCR schwankt, die Nummer traf nie → früher: erste Karte der
      //    Liste).
      if (!catalogCard && gemini.nationalDexNumber) {
        debug.lookupSteps!.push(`getCardsByDexNumber(${gemini.nationalDexNumber}, 100)`);
        const dexCards = await getCardsByDexNumber(gemini.nationalDexNumber, 100);
        dexCandidateCount = dexCards.length;
        debug.lookupSteps![debug.lookupSteps!.length - 1] += ` → ${dexCards.length} Kandidaten`;

        if (dexCards.length > 0 && rawNumber) {
          const altNumber = /^\d+$/.test(rawNumber)
            ? String(parseInt(rawNumber, 10))
            : rawNumber.padStart(3, '0');
          let filtered = dexCards.filter(c => c.number === rawNumber || c.number === altNumber);
          debug.lookupSteps!.push(`filter by number=${rawNumber} → ${filtered.length} übrig`);

          // Bei mehreren Treffern per Letter-Code eingrenzen, falls Gemini einen las.
          if (filtered.length > 1 && gemini.setCode) {
            const byCode = filtered.filter(c => c.setCode === gemini.setCode);
            if (byCode.length > 0) {
              filtered = byCode;
              debug.lookupSteps!.push(`filter by setCode=${gemini.setCode} → ${filtered.length} übrig`);
            }
          }

          if (filtered.length === 1) {
            catalogCard = filtered[0];
          } else if (filtered.length > 1) {
            // Echte Mehrdeutigkeit (mehrere Sets, gleiche Dex+Nummer) → Auswahl
            // anbieten statt zu raten.
            ambiguousCandidates = filtered;
            catalogCard = filtered[0];
            debug.lookupSteps!.push(`dex+number mehrdeutig: ${filtered.length} Kandidaten (nicht geraten)`);
          } else {
            debug.lookupSteps!.push(`Nummer ${rawNumber} passt zu keiner Karte von Dex ${gemini.nationalDexNumber} → nicht geraten`);
          }
        } else if (dexCards.length > 0) {
          debug.lookupSteps!.push(`Dex ${gemini.nationalDexNumber}: ${dexCards.length} Karten, aber keine Nummer gelesen → nicht geraten`);
        }
      }

      debug.lookupMs = Date.now() - tLookup;
      debug.catalogMatch = catalogCard
        ? { id: catalogCard.id, name: catalogCard.name, setId: catalogCard.setId, number: catalogCard.number }
        : null;
      debug.totalMs = Date.now() - t0;

      const catalogInfo = catalogCard
        ? `Katalog: ${catalogCard.name} (${catalogCard.setId}/${catalogCard.number})`
        : `Katalog: nicht gefunden (setCode=${gemini.setCode ?? 'null'}/${rawNumber || 'null'}, dex=${gemini.nationalDexNumber ?? 'null'}, ${dexCandidateCount} Kandidaten)`;

      // Memory-Cleanup beim Finalisieren:
      //  - geminiParsed + lookupSteps bleiben erhalten — werden fürs Debug-Modal
      //    gebraucht (kleine JSON-Objekte, kein nennenswerter Speicherverbrauch)
      //  - imageBase64: bleibt zunächst stehen (Debug-Modal + pHash-Vergleich
      //    brauchen es), wird aber per scheduleImageCleanup() nach 60s gestrippt —
      //    sowohl bei Erfolg als auch bei Error (verhindert, dass viele Snaps
      //    dauerhaft Bild-Bytes im Heap halten).
      const finalDebug: ScanDebug = { ...debug };

      // Kein Katalog-Treffer, aber verwertbare Werte (Hard-Fail — gar keine
      // Werte — wurde oben schon abgefangen): eine VORLÄUFIGE Platzhalter-Karte
      // aus den gelesenen Werten bauen. Sie ist anzeig- UND aufnehmbar (rotes
      // „?"-Badge, generische Kartenoptik) und wird beim nächsten Katalog-Sync
      // automatisch mit dem echten Eintrag verknüpft (lib/scan/reconcile-pending).
      // Eine vorläufige Karte NUR anlegen, wenn außer dem Namen mindestens EIN
      // Identifikator gelesen wurde (Set-Kürzel, Sammelnummer oder Pokédex-Nr.).
      // Der Name allein trifft im Katalog viele Einträge (z.B. „Traunfugil" 21×)
      // → nie eindeutig verknüpfbar. Fehlt jeder Identifikator, ist es kein
      // sinnvoller „nicht im Katalog"-Fall, sondern ein zu dünner Scan: als
      // Fehler behandeln (classifyJobError → 'gemini-thin' „Set & Nummer
      // unlesbar"), damit der Nutzer näher/ohne Reflexion neu scannt.
      // Pending-Karte nur, wenn die Sammelnummer gelesen wurde — sie ist die
      // Mindestanforderung jedes Lookups und der einzige Schlüssel, mit dem sich
      // die Pending-Karte später rekonziliieren lässt. Ohne Nummer (nur Name/
      // Set-Kürzel/Dex) ist es „nicht vollständig erkannt", nicht „nicht im Katalog".
      // Pending „nicht im Katalog" NUR, wenn außer der Sammelnummer auch ein
      // set-unterscheidendes Signal gelesen wurde (Set-Kürzel, Gesamtzahl oder
      // Pokédex-Nr.). Nummer allein wiederholt sich in fast jedem Set → weder ein
      // ehrliches „fehlt im Katalog" noch eine spätere eindeutige Verknüpfung
      // (Reconcile) möglich. Fehlt jedes Set-Signal → zu dünner Scan (oben als
      // Fehler „nicht vollständig erkannt" klassifiziert), keine Pending-Karte.
      const hasIdentifier = !!(rawNumber || gemini.number);
      const hasStrongId = !!(gemini.setCode || gemini.printedTotal != null || gemini.nationalDexNumber != null);
      const pendingCard: CardInfo | null = (!catalogCard && hasIdentifier && hasStrongId) ? {
        id: `pending-${id}`,
        name: gemini.name ?? 'Unbekannte Karte',
        number: rawNumber || gemini.number || '',
        setId: '',
        setName: gemini.setCode ?? '?',
        setCode: gemini.setCode ?? undefined,
        printedTotal: gemini.printedTotal ?? undefined,
        hp: gemini.hp ?? undefined,
        nationalDexNumber: gemini.nationalDexNumber ?? undefined,
        imgSmall: '', imgLarge: '',
        pendingCatalog: true,
      } : null;
      const finalCard: CardInfo | null = catalogCard ? catalogCardToInfo(catalogCard) : pendingCard;

      // Karte SOFORT rendern, ownedCount kommt asynchron nach.
      // Spart 5-15s Render-Verzögerung auf schwacher Firebase-Verbindung.
      const initialVariant: CardVariant = (catalogCard?.variants?.[0]) ?? 'standard';
      const initialCondition: PersistedCondition = gemini.condition
        ? GEMINI_TO_PERSISTED[gemini.condition]
        : 'NM';
      setJobs(prev => prev.map(j => j.id === id ? {
        ...j,
        status: finalCard ? 'done' : 'error',
        debugInfo: `${geminiSummary} | ${catalogInfo}`,
        debug: finalDebug,
        editedVariant:   initialVariant,
        editedCondition: initialCondition,
        result: {
          card: finalCard,
          language: (gemini.language ?? 'de') as CardLanguage,
          ownedCount: undefined, // wird non-blocking nachgeladen
          condition: gemini.condition,
          fakeRisk: gemini.fakeRisk,
          fakeReasons: gemini.fakeReasons,
          candidates: ambiguousCandidates ? ambiguousCandidates.map(catalogCardToInfo) : undefined,
        },
      } : j));
      if (!finalCard) stopAutoOnFail();   // unauflösbar → Auto-Stopp (Mehrfachscan)
      if (!isTest) playScanSound(!!finalCard);   // Erfolg-/Fehlton je nach Auflösung

      // ── Telemetrie ────────────────────────────────────────────────────────
      // Für JEDEN Scan ein kompaktes Event (Qualität/Gemini/Lookup, kein Bild) +
      // Live-Statistik. Bei Fehlern/Pending zusätzlich einen vollen Fall MIT
      // Bildern (Fehler-Korpus). Grundwahrheit trägt später der „Melden"-Flow nach.
      const scanOutcome: ScanOutcome = catalogCard ? 'recognized' : (finalCard ? 'pending' : 'not_recognized');
      {
        const quality = metaToQuality(meta);
        const gm = {
          name: gemini.name, setCode: gemini.setCode, number: gemini.number,
          printedTotal: gemini.printedTotal, nationalDexNumber: gemini.nationalDexNumber,
          hp: gemini.hp, language: gemini.language, confidence: gemini.confidence, error: gemini.error,
          model: gemini._debug?.model, ms: gemini._debug?.ms, attempts: gemini._debug?.attempts?.length,
        };
        const lookup = { via: gemini._preLookup?.via, stepsCount: finalDebug.lookupSteps?.length, recognizedCardId: finalCard?.id ?? undefined };
        if (!isTest) {
          eventIdPromise = recordScanEvent({ outcome: scanOutcome, quality, gemini: gm, lookup });
          void eventIdPromise.then(eventId => {
            if (eventId) setJobs(prev => prev.map(j => j.id === id ? { ...j, eventId, outcome: scanOutcome } : j));
            if (eventId && scanOutcome !== 'recognized') {
              void recordScanCase({
                outcome: scanOutcome, quality, gemini: gm, lookup, reportType: 'auto_fail',
                warpedCropBase64: imageBase64, originalFrameBase64: meta?.originalFrameBase64, mimeType,
                lookupSteps: finalDebug.lookupSteps, geminiRaw: gemini._debug?.rawText,
                catalogMatch: finalDebug.catalogMatch, eventId,
              });
            }
          });
          void bumpScanStats(scanOutcome, quality, undefined, gemini._debug?.ms);
        }
      }

      // Erkennen-Modus: nach erfolgreicher Erkennung Job zentral GROSS anzeigen —
      // auch für vorläufige (nicht katalogisierte) Karten. Im Mehrfachscan bleibt
      // die Karte im Slider (Hintergrund-Erkennung), keine große Anzeige.
      if (finalCard && scanModeRef.current === 'recognize') {
        setRecognizedJobId(id);
      }
      scheduleImageCleanup(id);

      // ── Owned-Count non-blocking nachladen ────────────────────────────────
      if (catalogCard) {
        const tOwned = Date.now();
        getCardsByTcgId(catalogCard.id)
          .then(copies => {
            setJobs(prev => prev.map(j => j.id === id && j.result
              ? {
                  ...j,
                  result: { ...j.result, ownedCount: copies.length, ownedNeedsReview: copies.some(c => c.needsReview), ownedCards: copies },
                  debug: { ...j.debug, ownedMs: Date.now() - tOwned } as ScanDebug,
                }
              : j));
          })
          .catch(() => {
            // Auth/Permission-Fehler → ownedCount bleibt undefined (Badge blendet aus)
            setJobs(prev => prev.map(j => j.id === id && j.debug
              ? { ...j, debug: { ...j.debug, ownedMs: Date.now() - tOwned } }
              : j));
          });
      }

      // ── pHash-Bild-Verifikation / Kandidaten-Rangfolge (non-blocking) ──────
      // Server-seitig (images.tcgdex/pokemontcg.io senden keine CORS-Header), nutzt
      // `debug.imageBase64` (lokale Var — NICHT `finalDebug`, das strippt das Bild).
      //  • Eindeutige Karte: nur diagnostischer Ähnlichkeits-Abstand (gelber/roter
      //    Rahmen), ändert die Erkennung nicht.
      //  • Mehrdeutig: Bild-Hash gegen JEDEN Kandidaten → nach Ähnlichkeit sortieren
      //    und den visuell NÄCHSTEN vorwählen, statt blind Kandidat [0]. Der Nutzer
      //    kann im Picker weiter frei umwählen. Fehler degradieren still (kein Rang).
      if (debug.imageBase64) {
        const lang = (gemini.language ?? 'de') as CardLanguage;
        // pHash-Referenzbild über die zentrale Kandidaten-Logik (bestes Katalog-
        // bild in der erkannten Sprache).
        const pickImageUrl = (info: CardInfo) => resolveCardImage(info, 'large', lang) ?? null;
        const phashOne = async (url: string): Promise<number | null> => {
          try {
            const { distance } = await fetch('/api/scan/verify-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageBase64: debug.imageBase64, catalogImageUrl: url }),
            }).then(r => r.json());
            return typeof distance === 'number' ? distance : null;
          } catch { return null; }
        };

        if (ambiguousCandidates && ambiguousCandidates.length > 1) {
          const infos = ambiguousCandidates.map(catalogCardToInfo);
          // Blinde Vorauswahl vor pHash (Kandidat [0]) — merken, damit die
          // asynchrone pHash-Rangfolge eine INZWISCHEN vom Nutzer im Picker
          // getroffene Wahl NICHT überschreibt (Race: der fetch dauert, der Nutzer
          // tippt in der Zeit einen anderen Kandidaten an). Reihenfolge + Distanz
          // dürfen weiter aktualisiert werden, nur die Karte bleibt dann stehen.
          const blindDefaultId = infos[0]?.id;
          void (async () => {
            const scored = await Promise.all(infos.map(async info => {
              const url = pickImageUrl(info);
              const distance = url ? await phashOne(url) : null;
              return { info, distance: distance ?? Infinity };
            }));
            scored.sort((a, b) => a.distance - b.distance);
            const best = scored[0];
            setJobs(prev => prev.map(j => {
              if (j.id !== id || !j.result) return j;
              const userPicked = !!j.result.card && j.result.card.id !== blindDefaultId;
              return {
                ...j,
                result: {
                  ...j.result,
                  card: userPicked ? j.result.card : best.info,
                  candidates: scored.map(s => s.info),
                },
                pHashDistance: Number.isFinite(best.distance) ? best.distance : undefined,
              };
            }));
            if (Number.isFinite(best.distance)) void eventIdPromise?.then(eid => { if (eid) void updateScanEventPHash(eid, best.distance); });
          })();
        } else if (catalogCard) {
          const url = pickImageUrl(catalogCardToInfo(catalogCard));
          if (url) void phashOne(url).then(distance => {
            if (distance != null) {
              setJobs(prev => prev.map(j => j.id === id ? { ...j, pHashDistance: distance } : j));
              void eventIdPromise?.then(eid => { if (eid) void updateScanEventPHash(eid, distance); });
            }
          });
        }
      }
    } catch (err) {
      console.error('Scan error:', err);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const msg = isAbort ? 'Upload-Timeout 90s' : err instanceof Error ? err.message : String(err);
      debug.error = msg;
      debug.totalMs = Date.now() - t0;
      const errDebug: ScanDebug = { ...debug, geminiParsed: undefined, lookupSteps: undefined };
      setJobs(prev => prev.map(j => j.id === id
        ? { ...j, status: 'error', result: { card: null, language: 'de' }, debugInfo: `Netzwerkfehler: ${msg}`, debug: errDebug }
        : j));
      stopAutoOnFail();
      if (!isTest) playScanSound(false);   // Fehlton: Netzwerk-/Serverfehler
      if (!isTest) {
        const quality = metaToQuality(meta);
        void recordScanEvent({ outcome: 'error', quality, gemini: { error: msg } }).then(eventId => {
          if (eventId) setJobs(prev => prev.map(j => j.id === id ? { ...j, eventId, outcome: 'error' } : j));
          void recordScanCase({
            outcome: 'error', quality, gemini: { error: msg }, reportType: 'auto_fail',
            warpedCropBase64: imageBase64, originalFrameBase64: meta?.originalFrameBase64, mimeType,
            eventId: eventId ?? undefined,
          });
        });
        void bumpScanStats('error', quality);
      }
      scheduleImageCleanup(id);
    }
  }, [scheduleImageCleanup]);

  // „Melden": vollen Fall mit Grundwahrheit ablegen + Event markieren. Nutzt das
  // im Job gehaltene Bild/Debug/Meta (Bild ggf. schon aufgeräumt → dann ohne).
  const submitReport = useCallback(async (job: ScanJob, result: ScanReportResult) => {
    setReportJobId(null);
    const quality = metaToQuality(job.captureMeta);
    const gp = (job.debug?.geminiParsed ?? undefined) as Record<string, unknown> | undefined;
    const gm = gp ? {
      name: gp.name as string, setCode: gp.setCode as string, number: gp.number as string,
      printedTotal: gp.printedTotal as number, nationalDexNumber: gp.nationalDexNumber as number,
      hp: gp.hp as number, language: gp.language as string, confidence: gp.confidence as string,
    } : undefined;
    void recordScanCase({
      outcome: job.outcome ?? 'recognized',
      quality, gemini: gm,
      lookup: { recognizedCardId: job.result?.card?.id },
      pHashDistance: job.pHashDistance,
      reportType: result.reportType,
      correctedCardId: result.correctedCardId,
      note: result.note,
      warpedCropBase64: job.debug?.imageBase64,
      originalFrameBase64: job.captureMeta?.originalFrameBase64,
      mimeType: job.debug?.mimeType,
      lookupSteps: job.debug?.lookupSteps,
      geminiRaw: job.debug?.geminiRaw,
      catalogMatch: job.debug?.catalogMatch,
      eventId: job.eventId,
    });
    if (job.eventId) void markEventReported(job.eventId, result.correctedCardId);
    void bumpScanStats(job.outcome ?? 'recognized', quality, job.pHashDistance, undefined, true);

    // Korrigierte Karte übernehmen: die Erkannt-Anzeige IMMER auf die vom Nutzer
    // gewählte richtige Karte umstellen (auch wenn noch nichts gespeichert war /
    // die Erkennung „pending" war) → sie erscheint danach als normale erkannte
    // Karte und lässt sich über die Leiste hinzufügen. War bereits ein (falsches)
    // reguläres Exemplar gespeichert, wird dieses zusätzlich IN-PLACE umgebogen
    // (tcgId + Felder), sodass die Sammlungs-/Binder-Zuordnung erhalten bleibt.
    if (result.reportType === 'wrong' && result.correctedCardId) {
      const correctedId = result.correctedCardId;
      const wrong = job.result?.card ?? null;
      void (async () => {
        try {
          const [cat] = await getCatalogCardsByIds([correctedId]);
          if (!cat) return;
          const correctedInfo = catalogCardToInfo(cat);

          // 1) Anzeige sofort auf die korrigierte Karte umstellen — auch eine
          //    NICHT erkannte Karte (status 'error', result evtl. null) wird so zu
          //    einer normalen erkannten, hinzufügbaren Karte.
          setJobs(prev => prev.map(j => j.id === job.id
            ? {
                ...j,
                status: 'done',
                result: {
                  ...(j.result ?? { language: 'de' as CardLanguage }),
                  card: correctedInfo,
                  ownedCount: undefined,
                },
              }
            : j));
          // Erkennen-Modus: die korrigierte Karte zentral als erkannte Karte zeigen.
          if (job.origin === 'recognize') setRecognizedJobId(job.id);

          // 2) Bereits gespeichertes falsches (reguläres) Exemplar in-place umbiegen.
          let correctedStored = false;
          const wrongTcgId = wrong?.id;
          if (wrongTcgId && wrongTcgId !== cat.id && !wrongTcgId.startsWith('pending-')) {
            const copies = await getCardsByTcgId(wrongTcgId);
            if (copies.length) {
              const target = [...copies].sort((a, b) =>
                ((b.addedAt as { toMillis?: () => number })?.toMillis?.() ?? 0) -
                ((a.addedAt as { toMillis?: () => number })?.toMillis?.() ?? 0))[0];
              await updateCard(target.id, {
                tcgId: cat.id, name: cat.nameDe ?? cat.name, setId: cat.setId, setName: cat.setName,
                series: cat.series, number: cat.number, rarity: cat.rarity,
                pokemonType: cat.types?.[0], supertype: cat.supertype,
              });
              correctedStored = true;
            }
          }
          // Besitzzähler der korrigierten Karte laden; „hinzugefügt"-Haken nur, wenn
          // wir ein vorhandenes Exemplar umgebogen haben (sonst frisch hinzufügbar).
          setJobs(prev => prev.map(j => j.id === job.id ? { ...j, added: correctedStored } : j));
          refreshOwnedCount(job.id, cat.id);

          // 3) Vorlagen-Sammlungen beider Karten neu arrangieren (falls betroffen).
          const templates = (await getBinders()).filter(b => b.template);
          const affected = new Set<string>();
          matchTemplateBinders(cat, templates).forEach(b => affected.add(b.id));
          if (wrong) {
            matchTemplateBinders(
              { artist: undefined, nationalDexNumber: wrong.nationalDexNumber, setId: wrong.setId },
              templates,
            ).forEach(b => affected.add(b.id));
          }
          if (affected.size > 0) await syncTemplateBinders({ binderIds: [...affected] });
        } catch (e) {
          console.error('[report] Karten-Korrektur fehlgeschlagen', e);
        }
      })();
    }

    setReportToast(true);
    setTimeout(() => setReportToast(false), 2200);
  }, [refreshOwnedCount]);

  return (
    // `dark`: der Scanner ist IMMER eine dunkle Fläche (schwarzes Kamerabild /
    // schwarzer Review-Grund), unabhängig vom App-Theme. Ohne erzwungenen Dark-
    // Kontext lösen `text-glass(-muted)` und die Glas-Komponenten (ButtonGroup)
    // im Light-Theme zu DUNKLEM Text auf → auf dem schwarzen Grund unlesbar.
    <div className="dark fixed inset-0 bg-black overflow-hidden">

      {/* ── Kamera fullscreen (nur im Scan-Modus) ──────────────────
          Beim Wechsel zu Review wird CameraCapture unmounted → Stream stoppt.
          Beim Zurück-Wechsel mountet die Komponente neu und zeigt initial
          das „Kamera starten"-Overlay — getUserMedia erst nach Tap. */}
      {mode === 'scanning' && (
        <div className="absolute inset-0">
          <CameraCapture
            onCapture={handleCapture}
            pendingCount={pendingCount}
            active={cameraActive}
            paused={streamPaused}
            autoDetect={captureMode === 'auto'}
            shutterSignal={shutterSignal}
            recognized={recognizedJobId != null}
            batchMode={scanMode === 'add'}
            hideFrame={scanMode === 'recognize' && streamPaused && (captureMode === 'auto' || recognizedJobId != null)}
          />
          {/* Testmodus-Einstieg — oben MITTIG, nur wenn der Testmodus in den
              Einstellungen aktiviert ist. Die Admin-Route hinter dem Panel prüft
              die Berechtigung selbst. */}
          {testModeEnabled && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setTestPanelOpen(true)}
              aria-label="Testmodus"
              className="absolute left-1/2 -translate-x-1/2 z-30"
              style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
            >
              Test
            </Button>
          )}
        </div>
      )}

      {testPanelOpen && (
        <ScanTestPanel
          onClose={() => setTestPanelOpen(false)}
          onRecognize={handleCapture}
          scanMode={scanMode}
        />
      )}

      {/* ── Review-Modus: schwarzer Hintergrund, scrollbar ──────── */}
      {mode === 'review' && (() => {
        const addJobs = jobs.filter(j => j.origin === 'add');
        // Filter anwenden basierend auf statusFilter — addJobs bleibt unverändert
        // (wichtig für korrekte depthFromTop-Berechnung), filtered ist die sichtbare Liste
        const matchesFilter = (job: ScanJob): boolean => {
          if (statusFilter === 'all') return true;
          const s = computeBorderStatus(job);
          if (statusFilter === 'success') return s === 'none';
          if (statusFilter === 'yellow')  return s === 'manual-yellow' || s === 'auto-yellow';
          if (statusFilter === 'red')     return s === 'auto-red' || s === 'error';
          return true;
        };
        const filtered = addJobs.filter(matchesFilter);

        // Die Liste/Single zeigen "neueste oben" — wir reversen die Reihenfolge für die Anzeige
        const filteredReversed = [...filtered].reverse();

        // Zähler je Statusfilter (für die Segment-Beschriftung).
        const statusCounts = addJobs.reduce((acc, j) => {
          const s = computeBorderStatus(j);
          acc.all++;
          if (s === 'none') acc.success++;
          else if (s === 'manual-yellow' || s === 'auto-yellow') acc.yellow++;
          else if (s === 'auto-red' || s === 'error') acc.red++;
          return acc;
        }, { all: 0, success: 0, yellow: 0, red: 0 });

        return (
        <div
          className="absolute inset-0 overflow-y-auto bg-black px-4"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 186px)',
            paddingBottom: viewMode === 'single'
              ? 'calc(env(safe-area-inset-bottom, 0px) + 20px)'
              : 'calc(env(safe-area-inset-bottom, 0px) + 130px)',
          }}
        >
          {/* ── Header-Panel im App-Stil: eine schwebende Glas-Karte (wie
              Sammlung/Mappen) mit Zurück-Button, Titel/Zähler und den Aktionen
              (View-Switch, Filter, Mehrfachauswahl). Baut auf denselben
              Komponenten auf (Button, ButtonGroup). */}
          <div
            className="fixed left-0 right-0 top-0 z-20 px-3"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
          >
          {/* Rahmenlos: der harte 1px-Glasrand fällt auf dem schwarzen Scanner-
              Grund unangenehm auf — hier nur Blur/Tönung, kein Rahmen. */}
          <div className="glass rounded-[20px] px-4 pt-2 pb-3 space-y-2" style={{ border: 'none' }}>
            {/* Zeile 1: Zurück („Scannen") + Zähler — ohne eigene Überschrift. */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMode('scanning')}
                className="px-0 -ml-1"
                icon={<ChevronLeft size={18} strokeWidth={2} />}
              >
                Scannen
              </Button>
              <span className="text-base text-glass-muted font-mono ml-auto px-1 tabular-nums">
                {viewMode === 'single' && filteredReversed.length > 0
                  ? `${Math.min(singleIdx, filteredReversed.length - 1) + 1}/${filteredReversed.length}`
                  : `${filtered.length}/${addJobs.length}`}
              </span>
            </div>
            {/* Zeile 2: Statusfilter — volle Breite, eigene Zeile. Standard-
                ButtonGroup (wie app-weit) mit Klartext-Labels + Zählern. */}
            <ButtonGroup
              className="w-full"
              options={[
                { value: 'all',     label: 'Alle',     count: statusCounts.all },
                { value: 'success', label: 'Erkannt',  count: statusCounts.success },
                { value: 'yellow',  label: 'Unsicher', count: statusCounts.yellow },
                { value: 'red',     label: 'Fehler',   count: statusCounts.red },
              ]}
              value={statusFilter}
              onChange={v => setStatusFilter(v as typeof statusFilter)}
            />
            {/* Zeile 3: Ansicht-Switch (Klartext) links + „Bearbeiten"-Button
                rechts — Bearbeiten exakt wie in den Sammlungen (Stift → Fertig). */}
            <div className="flex items-center gap-2">
              <ButtonGroup
                iconOnly
                options={[
                  { value: 'grid',   label: <LayoutGrid size={18} />, ariaLabel: 'Raster' },
                  { value: 'single', label: <Square size={18} />,     ariaLabel: 'Einzeln' },
                ]}
                value={viewMode}
                onChange={v => { setViewMode(v as 'grid' | 'single'); if (v === 'single') setSingleIdx(0); }}
              />
              {viewMode === 'grid' && (
                selectMode ? (
                  <Button
                    variant="primary" size="sm" accentColor="#2f855a" icon={<Check />}
                    aria-label="Fertig" className="shrink-0 ml-auto"
                    onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}
                  />
                ) : (
                  <Button
                    variant="secondary" size="sm" icon={<Pencil />}
                    aria-label="Bearbeiten" className="shrink-0 ml-auto"
                    onClick={() => { setSelectMode(true); setSelectedIds(new Set()); }}
                  />
                )
              )}
            </div>
          </div>
          </div>

          {viewMode === 'grid' && (
          <div className="grid grid-cols-2 gap-3">
            {(() => {
              return filteredReversed.map((job) => {
                const origIdx = addJobs.indexOf(job);
                const idx = origIdx; // for depth calc — but our depth uses addJobs index
                const card = job.result?.card;
                const canOpen = job.status === 'done' && !!card;
                const isError = job.status === 'error';
                const borderStatus = computeBorderStatus(job);
                const depthFromTop = addJobs.length - idx;
                // Auswahl-Modus: Antippen (nur erkannte Karten) togglet die
                // Auswahl. Sonst → Korrektur-Ansicht (Fehlerkarten: Melden-Flow).
                const selected = selectedIds.has(job.id);
                const onCardClick = () => {
                  if (selectMode) { if (canOpen) toggleSelected(job.id); return; }
                  if (canOpen || isError) setCorrectJobId(job.id);
                };

                // ── Erkannte Karte → geteilte Card-Komponente (neutral: keine
                // Sammlungs-Semantik) + Scan-Overlay (Löschen/Hinzufügen, Auswahl,
                // Fake/Zustand/Wert/Tiefe). Nicht-erkannte/verarbeitende Karten
                // laufen weiter über die eigene Box unten (Fehlerkarte/Loader).
                if (canOpen && card) {
                  const cardBorder: 'green' | 'yellow' | 'red' | undefined =
                    job.result?.fakeRisk === 'high' ? 'red'
                    : job.result?.fakeRisk === 'medium' ? 'yellow'
                    : borderStatus === 'auto-red' ? 'red'
                    : (borderStatus === 'manual-yellow' || borderStatus === 'auto-yellow') ? 'yellow'
                    : undefined;
                  const symbolOnly = !!card.series && SYMBOL_ONLY_SERIES.includes(card.series);
                  const symbolUrl = card.setId ? setSymbolMap.get(card.setId) : undefined;
                  const cond = job.result?.condition ? GEMINI_TO_PERSISTED[job.result.condition] : null;
                  // Sublabel = Nummer (mit führenden Nullen wie aufgedruckt) — der
                  // Name steht auf der Karte. Set-Kürzel/-Symbol kommt als Prefix
                  // davor (numberPrefix…), genau wie in den Sammlungen/Suche.
                  const cardNum = card.number && card.printedTotal && /^\d+$/.test(card.number)
                    ? card.number.padStart(String(card.printedTotal).length, '0')
                    : (card.number ?? '');
                  // Besitz-/„ungeprüft"-Badges rendert die Card-Komponente selbst
                  // (Standard-Look, aus ownedCards). Hier nur noch, was Card nicht
                  // kennt: Tiefen-Badge (Scan-Reihenfolge) + Wert-Badge — beide so
                  // gesetzt, dass sie NICHT mit Cards Badges (tr=Anzahl, tl=„!")
                  // kollidieren.
                  const ownedCardDocs = job.result?.ownedCards ?? [];
                  const totalOwned = ownedCardDocs.reduce((s, c) => s + c.quantity, 0);
                  const ownedNeedsReview = job.result?.ownedNeedsReview ?? false;
                  const hasDepthBadge = borderStatus === 'manual-yellow' || borderStatus === 'auto-yellow' || borderStatus === 'auto-red';
                  return (
                    <div key={job.id} className="relative">
                      <Card
                        size="md"
                        neutral
                        card={card}
                        ownedCards={job.result?.ownedCards}
                        border={cardBorder}
                        sublabel={cardNum}
                        numberPrefixCode={symbolOnly ? undefined : card.setCode}
                        numberPrefixSymbolUrl={symbolOnly ? symbolUrl : undefined}
                        setCode={card.setCode}
                        // Auswahl übernimmt die Card selbst (Standard-Look: Ring +
                        // Häkchen, Anzahl-Badge im Auswahl-Modus ausgeblendet).
                        onCardClick={() => setCorrectJobId(job.id)}
                        selectMode={selectMode}
                        selectable
                        selected={selected}
                        onToggleSelect={() => toggleSelected(job.id)}
                      />
                      {/* Scan-Overlay — deckt sich exakt mit dem 2.5:3.5-Bildbereich
                          der Card (gleiche Breite, top ausgerichtet). */}
                      <div className="absolute inset-x-0 top-0 aspect-[2.5/3.5] pointer-events-none">
                        {/* Tiefen-Badge (Scan-Reihenfolge) oben links — nur wenn
                            dort nicht schon Cards „ungeprüft"-Badge (tl) sitzt. */}
                        {hasDepthBadge && !ownedNeedsReview && (
                          <div
                            className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold z-10"
                            style={{
                              background: borderStatus === 'auto-red' ? 'rgba(239,68,68,0.92)' : 'rgba(250,204,21,0.92)',
                              color: borderStatus === 'auto-red' ? '#fff' : '#1a1a1a',
                            }}
                          >
                            #{depthFromTop}
                          </div>
                        )}
                        {/* „Hinzugefügt"-Overlay */}
                        {job.added && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-[10px]">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(72,187,120,.9)' }}>
                              <Check size={20} color="#fff" strokeWidth={3} />
                            </div>
                          </div>
                        )}
                        {/* Fake-Warnung */}
                        {(job.result?.fakeRisk === 'medium' || job.result?.fakeRisk === 'high') && (
                          <button
                            onClick={e => { e.stopPropagation(); setFakeReasonsJobId(job.id); }}
                            className="absolute top-2 left-2 w-9 h-9 rounded-full flex items-center justify-center pointer-events-auto"
                            style={{ background: 'rgba(0,0,0,0.7)' }}
                            aria-label="Fake-Verdacht"
                          >
                            <AlertTriangle size={16} color={job.result.fakeRisk === 'high' ? '#ef4444' : '#facc15'} fill={job.result.fakeRisk === 'high' ? '#ef4444' : '#facc15'} />
                          </button>
                        )}
                        {/* Abweichende Werte (Variante/Zustand/Sprache ≠ Standard)
                            unten links AUF der Karte — identisch zum Slider. */}
                        {(() => {
                          const meta = nonDefaultScanMeta(job);
                          return meta.length > 0 ? (
                            <div className="absolute bottom-1 left-1 flex flex-col items-start gap-0.5 max-w-[68%]">
                              {meta.map((m, i) => (
                                <span key={i} className="text-[8px] font-bold leading-none px-1 py-0.5 rounded bg-black/70 text-white truncate max-w-full">{m}</span>
                              ))}
                            </div>
                          ) : null;
                        })()}
                        {/* Wert-Badge oben rechts — nur wenn dort nicht schon Cards
                            Anzahl-Badge (×N, im neutral-Modus ab 1 Exemplar) sitzt. */}
                        {!selectMode && totalOwned === 0 && (
                          <div className="absolute top-1 right-1">
                            <ValueBadge tcgId={card.id} iconOnly />
                          </div>
                        )}
                        {/* Keine per-Karte-Buttons (analog zu den Sammlungen):
                            Antippen öffnet die Korrektur, Löschen/Hinzufügen läuft
                            im Bearbeiten-Modus über Mehrfachauswahl + Fußleiste. */}
                      </div>
                    </div>
                  );
                }

              return (
                <div key={job.id} className="relative flex flex-col">
                  <div
                    className="relative rounded-md overflow-hidden"
                    style={{
                      background: '#1a1a1a',
                      aspectRatio: '63/88',
                      ...borderStyleFor(borderStatus, job.result?.fakeRisk),
                      cursor: (canOpen || isError) ? 'pointer' : 'default',
                    }}
                    onClick={onCardClick}
                  >
                    {/* Depth-Badge im Review-Grid */}
                    {(borderStatus === 'manual-yellow' || borderStatus === 'auto-yellow' || borderStatus === 'auto-red') && (
                      <div
                        className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold z-10"
                        style={{
                          background: borderStatus === 'auto-red' ? 'rgba(239,68,68,0.92)' : 'rgba(250,204,21,0.92)',
                          color: borderStatus === 'auto-red' ? '#fff' : '#1a1a1a',
                        }}
                      >
                        #{depthFromTop}
                      </div>
                    )}
                    {/* Auswahl-Overlay (Mehrfachauswahl): Ring + Häkchen. */}
                    {selectMode && canOpen && (
                      <div
                        className="absolute inset-0 z-20 pointer-events-none"
                        style={{ boxShadow: selected ? 'inset 0 0 0 3px #22c55e' : 'inset 0 0 0 2px rgba(255,255,255,0.25)' }}
                      >
                        <div
                          className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center"
                          style={{ background: selected ? '#22c55e' : 'rgba(0,0,0,0.55)' }}
                        >
                          {selected && <Check size={15} color="#fff" strokeWidth={3} />}
                        </div>
                      </div>
                    )}
                    {job.status === 'processing' ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 size={24} color="rgba(255,255,255,0.4)" className="animate-spin" />
                      </div>
                    ) : isError ? (() => {
                      const ec = classifyJobError(job);
                      const ErrIcon = ec.Icon;
                      const miniNormalDark = '#6f6d4e';
                      return (
                        <div
                          className="w-full h-full flex flex-col"
                          style={{
                            background: 'linear-gradient(180deg, #d9d4b0 0%, #b8b287 100%)',
                            padding: 4,
                          }}
                        >
                          <div
                            className="flex-1 flex flex-col"
                            style={{
                              background: 'linear-gradient(180deg, #f7f4e4 0%, #ece5c4 100%)',
                              borderRadius: 4,
                              overflow: 'hidden',
                            }}
                          >
                            {/* Mini-Header */}
                            <div
                              className="flex items-center justify-between px-1.5 py-1 gap-1"
                              style={{ background: 'rgba(111,109,78,0.16)' }}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                <span
                                  className="text-[7px] font-bold px-1 rounded text-white shrink-0"
                                  style={{ background: miniNormalDark }}
                                >
                                  NORMAL
                                </span>
                                <span className="text-[10px] font-extrabold leading-none truncate" style={{ color: '#1a1a1a' }}>
                                  {ec.cardName}
                                </span>
                              </div>
                              <span className="text-[9px] font-extrabold shrink-0" style={{ color: miniNormalDark }}>
                                ???
                              </span>
                            </div>
                            {/* Mini-Artwork: Snap-Foto wenn da, sonst gezeichnete Landschaft */}
                            <div
                              className="flex-1 mx-1 my-1 relative overflow-hidden"
                              style={{
                                border: '2px solid rgba(0,0,0,0.55)',
                                borderRadius: 2,
                              }}
                            >
                              {job.debug?.imageBase64 ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={`data:${job.debug.mimeType ?? 'image/jpeg'};base64,${job.debug.imageBase64}`}
                                  alt="Scan"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <ErrorLandscapeArtwork className="w-full h-full" />
                              )}
                              {/* Klein-Icon oben rechts als sekundärer Hint zum Fehler-Typ */}
                              <div
                                className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full flex items-center justify-center"
                                style={{ background: 'rgba(255,255,255,0.65)' }}
                              >
                                <ErrIcon size={14} color={ec.iconColor} strokeWidth={2} />
                              </div>
                            </div>
                            {/* Mini-Footer */}
                            <div
                              className="px-1.5 py-0.5 text-[8px] font-mono flex items-center justify-between"
                              style={{ background: 'rgba(0,0,0,0.06)', color: '#1a1a1a' }}
                            >
                              <span className="font-bold" style={{ color: miniNormalDark }}>???</span>
                              <span>0/0</span>
                            </div>
                          </div>
                        </div>
                      );
                    })() : (
                      <>
                        <ScanCardImage job={job} />
                        {/* Holo-Glanz nur bei EINDEUTIG-Foil-Karten (Katalog ohne
                            standard-Variante) — die Scan-Variante selbst ist nur
                            geraten, daher nicht als Glanz-Signal genutzt. */}
                        {(() => {
                          const foil = inherentFoilVariant(card?.variants);
                          return foil ? (
                            <div
                              className={`absolute inset-0 ${holoShimmerClass(foil, card?.rarity)}`}
                              aria-hidden="true"
                            />
                          ) : null;
                        })()}
                      </>
                    )}
                    {job.added && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(72,187,120,.9)' }}>
                          <Check size={20} color="#fff" strokeWidth={3} />
                        </div>
                      </div>
                    )}
                    {/* Fake-Warnung oben links */}
                    {(job.result?.fakeRisk === 'medium' || job.result?.fakeRisk === 'high') && (
                      <button
                        onClick={e => { e.stopPropagation(); setFakeReasonsJobId(job.id); }}
                        className="absolute top-2 left-2 w-9 h-9 rounded-full flex items-center justify-center"
                        style={{ background: 'rgba(0,0,0,0.7)' }}
                        aria-label="Fake-Verdacht"
                      >
                        <AlertTriangle size={16} color={job.result.fakeRisk === 'high' ? '#ef4444' : '#facc15'} fill={job.result.fakeRisk === 'high' ? '#ef4444' : '#facc15'} />
                      </button>
                    )}
                    {/* Condition-Pill unten links auf der Karte */}
                    {job.result?.condition && (() => {
                      const p = GEMINI_TO_PERSISTED[job.result.condition];
                      const c = PERSISTED_CONDITION_COLOR[p];
                      return (
                        <span className="absolute bottom-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md shadow-md"
                          style={{ background: c.bg, color: c.text }}>
                          {p}
                        </span>
                      );
                    })()}
                    {/* Wert-Badge oben rechts auf Grid-Tile (nur ab 'wertvoll') */}
                    {card && (
                      <div className="absolute top-1 right-1">
                        <ValueBadge tcgId={card.id} iconOnly />
                      </div>
                    )}
                    {/* Trash + Quick-Add unten rechts */}
                    <div
                      className="absolute flex items-end gap-1"
                      style={{ right: 2, bottom: 2 }}
                      onClick={e => e.stopPropagation()}
                    >
                      <Button
                        variant="primary"
                        size="sm"
                        accentColor="#c53030"
                        icon={<Trash2 />}
                        onClick={e => { e.stopPropagation(); removeJob(job.id); }}
                        aria-label="Entfernen"
                        className="shadow-md"
                      />
                      {canOpen && !job.added && (
                        <Button
                          variant="primary"
                          size="md"
                          accentColor="#2f855a"
                          icon={<Plus />}
                          onClick={e => { e.stopPropagation(); setQuickAddJobId(job.id); }}
                          aria-label="Zur Sammlung hinzufügen"
                          className="shadow-md"
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2 mt-2 px-1">
                    {card?.setCode && (() => {
                      const symbolOnly = !!card.series && SYMBOL_ONLY_SERIES.includes(card.series);
                      const symbolUrl = card.setId ? setSymbolMap.get(card.setId) : undefined;
                      return (
                        <div
                          className="shrink-0 flex flex-col items-center leading-tight rounded-md border px-1.5 py-0.5 font-mono"
                          style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}
                        >
                          {symbolOnly && symbolUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={symbolUrl} alt="" className="w-3.5 h-3.5 object-contain" />
                          ) : (
                            <span className="text-[10px] font-bold">{card.setCode}</span>
                          )}
                          {card.number && (
                            <span className="text-[9px] text-white/75">{card.number}</span>
                          )}
                        </div>
                      );
                    })()}
                    <p className="text-xs text-white/90 truncate">
                      {card ? <CardNameLabel card={card} secondaryClassName="opacity-70" /> : (job.status === 'processing' ? '…' : 'Fehler')}
                    </p>
                  </div>
                </div>
              );
              });
            })()}
          </div>
          )}

          {viewMode === 'single' && (() => {
            if (filteredReversed.length === 0) {
              return (
                <p className="text-center text-white/55 text-sm py-8">
                  Keine Karten in dieser Auswahl.
                </p>
              );
            }
            const safeIdx = Math.min(singleIdx, filteredReversed.length - 1);
            const job = filteredReversed[safeIdx];
            const prevJob = safeIdx > 0 ? filteredReversed[safeIdx - 1] : null;
            const nextJob = safeIdx < filteredReversed.length - 1 ? filteredReversed[safeIdx + 1] : null;

            // Stapel-Modell. Die drei Ebenen sind (bei vorhandenem Nachbarn) IMMER
            // gemountet, damit Übergänge zuverlässig feuern:
            //  - below (nächste Karte): liegt statisch hinter der obersten Karte;
            //    wird sichtbar, wenn die oberste beim 'advance' zur Seite fliegt.
            //  - top (aktuelle/oberste Karte): folgt beim 'advance' dem Finger und
            //    fliegt in Finger-Richtung raus.
            //  - incoming (vorherige Karte): sitzt off-screen am Rand; gleitet beim
            //    'restore' vom Start-Rand in die Mitte auf den Stapel.
            const w = singlePanelWidth;
            // Stapel-Optik: die nächste Karte liegt als kleinere, leicht nach unten
            // versetzte „Stapel-Karte" hinter der obersten. Fortschritt der Geste
            // (0..1) treibt Wachsen/Zurückweichen, damit man sieht, wie die oberste
            // Karte oben vom Stapel weggeht bzw. eine Karte oben drauf zurückkommt.
            const STACK_SCALE = 0.93;   // Größe der Karte(n) hinter der obersten
            const STACK_Y = 16;         // px-Versatz nach unten
            const dragP = w > 0 ? Math.min(1, Math.abs(singleDragX) / w) : 0;
            const advP = (singleMode === 'advance' && !!nextJob)
              ? (singleAnim === 'commit-advance' ? 1 : singleAnim === 'snap' ? 0 : dragP)
              : 0;
            const resP = (singleMode === 'restore' && !!prevJob)
              ? (singleAnim === 'commit-restore' ? 1 : singleAnim === 'snap' ? 0 : dragP)
              : 0;
            const stackTransition = singleAnim ? 'transform 220ms ease-out' : undefined;

            // Oberste Karte: 'advance' → folgt dem Finger 1:1 und fliegt in Finger-
            // Richtung raus; 'restore' → weicht in den Stapel zurück (die zurückkehrende
            // Karte legt sich oben drauf); am Rand ('bounce') → gedämpft dem Finger
            // folgen und zurückschnappen; sonst full-size mittig.
            const topTransform =
              (singleMode === 'advance' || singleMode === null)
                ? (singleAnim === 'commit-advance' ? `translateX(${advanceSignRef.current * (w + 80)}px)`
                   : singleAnim === 'snap' ? 'translateX(0px)'
                   : `translateX(${singleDragX}px)`)
                : /* restore */ `translateY(${STACK_Y * resP}px) scale(${1 - (1 - STACK_SCALE) * resP})`;
            const topTransition = stackTransition;

            // Nächste Karte (Stapel-Karte hinter der obersten): wächst beim 'advance'
            // aus der Stapel-Position in die oberste Position.
            const belowTransform = `translateY(${STACK_Y * (1 - advP)}px) scale(${STACK_SCALE + (1 - STACK_SCALE) * advP})`;
            const belowTransition = stackTransition;

            // Vorherige Karte — Ausgangslage off-screen am Rand (restoreEdge · Breite);
            // gleitet beim 'restore' in voller Größe oben auf den Stapel.
            const incomingBase = restoreEdgeRef.current * w;
            const incomingTransform =
              singleAnim === 'commit-restore' ? 'translateX(0px)' :
              singleAnim === 'snap' && singleMode === 'restore' ? `translateX(${incomingBase}px)` :
              singleMode === 'restore' ? `translateX(${incomingBase + singleDragX}px)` :
              `translateX(${incomingBase}px)`;
            const incomingTransition = stackTransition;

            const showBelow    = !!nextJob && w > 0;
            const showIncoming = !!prevJob && w > 0;

            // Ein Karten-Panel = die volle Einzelscan-Ansicht (RecognizedCardLarge),
            // eingebettet (füllt den Swipe-Layer, Header bleibt darüber sichtbar).
            // Optik + Bedienung identisch zum Einzelscan: Owned-Rahmen, großes Bild,
            // Glas-Leiste mit Set/Name/Preis, Hinzufügen/Verwalten/Korrigieren,
            // Holo-Glanz. Tap aufs Bild öffnet das Kartendetail; die untere
            // Add-Leiste ist per data-scan-interactive vom Swipe ausgenommen.
            // Nur das KARTENBILD (horizontale Swipe-Ebenen). Bedienung/Add-Leiste
            // liegt separat im vertikal ein-/ausgleitenden Panel (siehe unten) —
            // so swipt nur das Bild. Callbacks hier no-op (nur Anzeige).
            const noop = () => {};
            const renderImage = (j: typeof job, interactive: boolean) => (
              <div className="absolute inset-0" style={{ pointerEvents: interactive ? undefined : 'none' }}>
                <RecognizedCardLarge
                  embedded
                  part="image"
                  job={j}
                  onCardTap={noop}
                  onSubmitReport={noop}
                  onPickNotInCatalog={noop}
                  onPickCandidate={noop}
                  onSaved={noop}
                  onManage={noop}
                />
              </div>
            );

            const clearLongPress = () => {
              if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
            };

            const handlePointerUp = (e: React.PointerEvent) => {
              const started = swipeActiveRef.current;
              swipeActiveRef.current = false;
              swipeStartXRef.current = null;
              clearLongPress();
              if (longPressFiredRef.current) {
                // Long-Press hat schon getoggelt — Drag/Tap-Logik unterdrücken
                longPressFiredRef.current = false;
                setSingleDragX(0);
                return;
              }
              if (!started) return;
              // Entscheidung anhand des per Ref getrackten Drag-Offsets (robust gegen
              // verlorene Pointer-Capture UND veraltete State-Closures).
              const dx = swipeDragXRef.current;
              swipeDragXRef.current = 0;
              const mode = swipeModeRef.current;
              const wNow = singlePanelWidth || 1;
              const fxEnd = swipeStartFxRef.current + dx / wNow; // Finger-Position beim Loslassen (0..1)
              // Kurzer Tap (kaum Bewegung) auf der Karte → Kartendetail.
              if (Math.abs(dx) < 10) {
                setSingleDragX(0);
                setSingleMode(null);
                if (mode === 'advance' && canOpen) setActiveJobId(job.id);
                return;
              }
              if (mode === 'restore') {
                // Vorherige Karte fliegt nur rein, wenn nach INNEN gezogen UND der
                // Finger INNERHALB der aktuellen Karte losgelassen wird; sonst zurück.
                const inward = restoreEdgeRef.current * dx < 0;
                const insideCard = fxEnd > 0.15 && fxEnd < 0.85;
                if (prevJob && inward && insideCard) setSingleAnim('commit-restore');
                else setSingleAnim('snap');
              } else {
                // Oberste Karte fliegt nur weg, wenn sie NETTO weit genug aus der
                // Mitte verschoben wurde (Distanz zur Mitte) — unabhängig von der
                // Griffposition und immun gegen Zickzack (nur die Netto-Strecke
                // zählt, nicht die zurückgelegte Gesamtstrecke). Vorzeichen = Richtung.
                const movedFar = Math.abs(dx) > wNow * 0.33;
                if (nextJob && movedFar) {
                  advanceSignRef.current = dx < 0 ? -1 : 1;
                  setSingleAnim('commit-advance');
                } else {
                  setSingleAnim('snap');
                }
              }
            };

            // Outer container — feste Höhe, alles passt rein, keine Scroll
            const containerHeight = 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 170px)';
            const canOpen = job.status === 'done' && !!job.result?.card;

            return (
              <div
                ref={singlePanelRef}
                className="relative touch-none select-none overflow-hidden overscroll-x-none"
                // Full-bleed über die VOLLE Viewport-Breite (bricht aus dem px-4 des
                // Eltern-Containers aus) — sonst blieben die äußersten ~16px ein
                // „toter" Rand, an dem die Restore-Geste vom Bildschirmrand nicht
                // starten konnte.
                style={{ height: containerHeight, minHeight: '320px', width: '100vw', marginLeft: 'calc(50% - 50vw)' }}
                onPointerDown={e => {
                  if (singleAnim) return;
                  // Interaktive Steuerung (Add-Leiste mit Dropdowns/Buttons/Grabber,
                  // per data-scan-interactive markiert) handhabt ihre Gesten selbst —
                  // dort KEINEN Swipe/Tap starten (sonst schluckt der Pointer-Capture
                  // die Klicks der Leiste).
                  if ((e.target as Element).closest?.('button, select, input, a, [data-scan-interactive]')) return;
                  const rect = (e.currentTarget as Element).getBoundingClientRect();
                  swipeStartFxRef.current = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
                  // Modus aus der STARTPOSITION: Griff AUF der obersten Karte
                  // (data-scan-card) → 'advance' (Karte folgt dem Finger, fliegt erst
                  // am Rand weg). Griff NEBEN der Karte (Rand) → 'restore' (vorherige
                  // Karte von dort reinziehen).
                  const onCard = !!(e.target as Element).closest?.('[data-scan-card]');
                  const mode: 'advance' | 'restore' = onCard ? 'advance' : 'restore';
                  swipeModeRef.current = mode;
                  if (mode === 'restore') restoreEdgeRef.current = swipeStartFxRef.current < 0.5 ? -1 : 1;
                  setSingleMode(mode);
                  swipeActiveRef.current = true;
                  swipeDragXRef.current = 0;
                  swipeStartXRef.current = e.clientX;
                  swipeStartTimeRef.current = Date.now();
                  try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
                }}
                onPointerMove={e => {
                  const start = swipeStartXRef.current;
                  if (start == null || singleAnim) return;
                  const dx = e.clientX - start;
                  swipeDragXRef.current = dx;
                  setSingleDragX(dx);
                }}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onLostPointerCapture={handlePointerUp}
              >
                {/* Karten-Ebenen als KEYED Liste (Schlüssel = job.id): so bleibt jede
                    Karten-Instanz über den Rollenwechsel hinweg dieselbe. Beim Advance
                    wird die bereits geladene „nächste"-Karte zur obersten OHNE Neuladen
                    — sonst blitzte beim Bild-Reload kurz die ÜBERNÄCHSTE Karte durch.
                    Rolle bestimmt z-index/Transform/Handler:
                      below (z1)     — nächste Karte, Stapel-Karte dahinter
                      top   (z2)     — aktuelle/oberste Karte
                      incoming (z3)  — vorherige Karte, gleitet beim 'restore' rein */}
                {(() => {
                  const layers: { j: typeof job; role: 'below' | 'top' | 'incoming' }[] = [];
                  if (showBelow && nextJob) layers.push({ j: nextJob, role: 'below' });
                  layers.push({ j: job, role: 'top' });
                  if (showIncoming && prevJob) layers.push({ j: prevJob, role: 'incoming' });
                  return layers.map(({ j: lj, role }) => {
                    const isTop = role === 'top';
                    const style: React.CSSProperties =
                      role === 'below'
                        ? { transform: belowTransform, transition: belowTransition, willChange: 'transform', zIndex: 1 }
                        : isTop
                        ? { transform: topTransform, transition: topTransition, willChange: 'transform', zIndex: 2 }
                        : { transform: incomingTransform, transition: incomingTransition, willChange: 'transform', zIndex: 3, pointerEvents: 'none' };
                    return (
                      <div
                        key={lj.id}
                        className="absolute inset-0"
                        style={style}
                        onTransitionEnd={ev => {
                          if (ev.propertyName !== 'transform') return;
                          if (isTop && singleAnim === 'commit-advance') {
                            setSingleIdx(idx => idx + 1);
                            setSingleDragX(0); setSingleAnim(null); setSingleMode(null);
                          } else if (isTop && singleAnim === 'snap' && singleMode === 'advance') {
                            setSingleDragX(0); setSingleAnim(null); setSingleMode(null);
                          } else if (role === 'incoming' && singleAnim === 'commit-restore') {
                            setSingleIdx(idx => Math.max(0, idx - 1));
                            setSingleDragX(0); setSingleAnim(null); setSingleMode(null);
                          } else if (role === 'incoming' && singleAnim === 'snap' && singleMode === 'restore') {
                            setSingleDragX(0); setSingleAnim(null); setSingleMode(null);
                          }
                        }}
                      >
                        {renderImage(lj, isTop && !singleAnim && singleDragX === 0)}
                      </div>
                    );
                  });
                })()}

                {/* Info-/Add-Panel — SEPARAT vom horizontalen Bild-Swipe. Nur das
                    Bild swipt seitlich; das Panel gleitet beim Kartenwechsel nach
                    unten raus und mit den neuen Infos wieder rein (vertikal). Bei
                    reinem Zurückschnappen (kein Kartenwechsel) bleibt es stehen.
                    overflow-hidden des Containers kappt es beim Rausgleiten. */}
                <div
                  className="absolute inset-x-0 z-20"
                  style={{
                    // Etwas über der Unterkante angedockt, damit der Positions-Marker
                    // UNTER der Panel-Kante Platz hat (siehe unten).
                    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)',
                    transform: (singleAnim === 'commit-advance' || singleAnim === 'commit-restore')
                      ? 'translateY(140%)' : 'translateY(0)',
                    transition: 'transform 200ms ease',
                  }}
                >
                  <RecognizedCardLarge
                    key="single-panel"
                    embedded
                    part="panel"
                    job={job}
                    onCardTap={() => setActiveJobId(job.id)}
                    onSubmitReport={result => submitReport(job, result)}
                    onPickNotInCatalog={pending => {
                      setJobs(prev => prev.map(x => x.id === job.id && x.result
                        ? { ...x, status: 'done' as const, result: { ...x.result, card: pending }, editedVariant: 'standard' as CardVariant }
                        : x));
                      submitReport(job, { reportType: 'not_in_catalog' });
                    }}
                    onPickCandidate={picked => {
                      setJobs(prev => prev.map(x => x.id === job.id && x.result
                        ? { ...x, status: 'done' as const, result: { ...x.result, card: picked }, editedVariant: picked.variants?.[0] ?? 'standard' }
                        : x));
                      refreshOwnedCount(job.id, picked.id);
                    }}
                    onSaved={() => {
                      markAdded(job.id, { keepJob: true });
                      if (job.result?.card) refreshOwnedCount(job.id, job.result.card.id);
                    }}
                    onManage={() => setQuickDeleteJobId(job.id)}
                    onEditVariant={v => setJobVariant(job.id, v)}
                    onEditCondition={c => setJobCondition(job.id, c)}
                    onEditLanguage={l => setJobLanguage(job.id, l)}
                  />
                </div>

                {/* Positions-Marker (Page Control) — ganz unten am Seitenrand, mittig,
                    über allem. pointer-events-none, damit er den Swipe nicht stört. */}
                {filteredReversed.length > 1 && (
                  <div
                    className="pointer-events-none fixed left-1/2 -translate-x-1/2 z-[30]"
                    style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 3px)' }}
                  >
                    <SliderPageDots total={filteredReversed.length} index={safeIdx} />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        );
      })()}

      {/* ── Header (schwebt oben) ──────────────────────────────────
          Im Review-Modus links Back-Arrow zurück zum Scan, rechts X-Close
          zum vollständigen Schließen. Im Scanning-Modus zusätzlich mittig
          (zwischen Blitz-Button links und Schließen rechts) der Einzeln/
          Mehrere-Umschalter — drei flex-1-Zonen garantieren echte
          Zentrierung unabhängig von der Breite der Rand-Elemente. */}
      {/* pointer-events-none auf der Leiste, damit die leeren flex-1-Zonen KEINE
          Taps abfangen (sonst blockiert die transparente linke Zone den darunter
          liegenden Taschenlampen-Button in CameraCapture). Nur die echten
          Bedienelemente bekommen pointer-events-auto. */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center px-4 pb-3 pointer-events-none"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        {/* Der Zurück-Button für den Review-Modus sitzt jetzt im Prüfen-Header-
            Panel (zusammen mit View-Switch/Filter). Hier bleibt nur die
            Zentrier-Zone für den Schließen-Button im Scan-Modus. */}
        <div className="flex-1 flex justify-start" />
        {/* Einzeln/Mehrere-Umschalter ist in die Footer-Leiste gewandert
            (links neben dem Scan-Button) — Header-Mitte bleibt leer für die
            Zentrierung des Schließen-Buttons. */}
        <div className="flex-1" />
        <div className="flex-1 flex justify-end">
          {mode === 'scanning' && (
            <button
              onClick={handleClose}
              className="pointer-events-auto w-[46px] h-[46px] flex items-center justify-center rounded-full glass-overlay"
              aria-label="Scanner schließen"
            >
              <X size={20} color="#fff" />
            </button>
          )}
        </div>
      </div>

      {/* Memory-Wächter-Banner — sichtbar wenn der Stapel zu groß wird */}
      {memoryLevel !== 'ok' && (
        <div
          className="absolute left-0 right-0 z-30 px-4 flex justify-center pointer-events-none"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 60px)' }}
        >
          <div
            className="pointer-events-auto rounded-lg px-3 py-2 text-sm font-semibold shadow-lg max-w-md text-center"
            style={{
              background: memoryLevel === 'critical' ? '#ef4444' : '#facc15',
              color: memoryLevel === 'critical' ? '#fff' : '#1a1a1a',
            }}
          >
            {memoryLevel === 'critical' ? (
              <>
                <div className="font-bold mb-0.5">Speicher fast voll ({unaddedCount} Karten)</div>
                <div className="text-xs font-normal opacity-90">
                  Bitte „Alle hinzufügen" oder „Alle löschen", dann kann der Scan weitergehen.
                </div>
              </>
            ) : (
              <>
                <div className="font-bold mb-0.5">{unaddedCount} Karten im Stapel</div>
                <div className="text-xs font-normal opacity-80">
                  Bitte zur Sammlung übernehmen oder löschen, bevor du weiterscannst.
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Hinzufügen-Modus: Thumbnail-Slider unten ──────────────────
          4 Tiles immer sichtbar, Rest per Swipe mit scroll-snap. */}
      {mode === 'scanning' && scanMode === 'add' && jobs.length > 0 && (
        <div
          className="absolute left-0 right-0 z-10"
          // Über der „prüfen"-Pille (bottom 90, ~40px) und der BottomNav-Leiste,
          // damit weder Pille noch die vergrößerte letzte Karte überlappen.
          // KEIN horizontales Padding: der Slider läuft randlos — die linke Karte
          // blutet an den Bildschirmrand, rechts hält nur ein Gap-Abstand (pr-2).
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 118px)' }}
        >
          {/* „Prüfen"-Aktion sitzt jetzt als fest verankerte Pille in der
              BottomNav-Leiste (gridVisible) — nicht mehr floatend über dem
              Slider. */}
          <div
            ref={sliderRef}
            className="flex items-end gap-2 overflow-x-auto pb-3 pt-8 pr-2"
            style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory' }}
          >
            {(() => {
              // Nur Add-Origin-Jobs im Slider (recognize sind temporär + werden gepurged)
              const addJobs = jobs.filter(j => j.origin === 'add');
              return addJobs.map((job, idx) => {
                const c = job.result?.card;
                const symbolUrl = c?.setId ? setSymbolMap.get(c.setId) : undefined;
                return (
                  <ScannedCardTile
                    key={job.id}
                    job={job}
                    isLatest={idx === addJobs.length - 1}
                    isFirst={idx === 0}
                    symbolUrl={symbolUrl}
                    onRemove={() => removeJob(job.id)}
                    onOpen={() => setCorrectJobId(job.id)}
                  />
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* ── Mehrfachscan: Korrektur-Ansicht einer angetippten Slider-Karte —
          dieselbe UI wie im Einzelscan (Karte groß + Kandidaten/„Korrigieren").
          Overlay über dem Slider mit Schließen-Button; Auswahl aktualisiert die
          Karte im Slider und schließt. */}
      {scanMode === 'add' && correctJobId && (() => {
        const job = jobs.find(j => j.id === correctJobId);
        if (!job || job.status === 'processing') return null;
        const close = () => setCorrectJobId(null);
        const isBlind = job.status === 'error' && classifyJobError(job).kind === 'gemini-blind';
        return (
          <div className="fixed inset-0 z-[55]" style={{ background: 'rgba(0,0,0,0.9)' }}>
            <button
              type="button"
              onClick={close}
              aria-label="Schließen"
              className="absolute right-3 z-50 w-10 h-10 rounded-full flex items-center justify-center text-white"
              style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)', background: 'rgba(0,0,0,0.5)' }}
            >
              <X size={20} />
            </button>
            {isBlind ? (
              <div
                className="absolute inset-x-0 flex flex-col items-center justify-center gap-4 px-8 text-center"
                style={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
              >
                <p className="text-white/85 text-role-title">Karte nicht erkannt</p>
                <p className="text-white/50 text-role-label">Wähle die richtige Karte, um sie zu übernehmen.</p>
                <Button icon={<Flag />} onClick={() => { setReportJobId(job.id); close(); }}>
                  Richtige Karte wählen
                </Button>
              </div>
            ) : (
              <RecognizedCardLarge
                key={job.id}
                job={job}
                correctionOnly
                // Tap aufs große Bild öffnet das Kartendetail ÜBER dem Overlay
                // (wie im Einzelscan). Das Korrektur-Overlay bleibt darunter offen
                // — Schließen des Details führt zurück hierher, nicht in den Slider.
                onCardTap={() => setActiveJobId(job.id)}
                // Korrigieren/Melden lässt das Overlay OFFEN (wie im Einzelscan):
                // man bleibt in der Karten-Ansicht und sieht die korrigierte Karte;
                // erst der X-Button schließt zurück in den Slider/das Grid.
                onSubmitReport={result => submitReport(job, result)}
                onPickNotInCatalog={pending => {
                  setJobs(prev => prev.map(j => j.id === job.id && j.result
                    ? { ...j, status: 'done' as const, result: { ...j.result, card: pending }, editedVariant: 'standard' as CardVariant }
                    : j));
                  submitReport(job, { reportType: 'not_in_catalog' });
                }}
                onPickCandidate={picked => {
                  setJobs(prev => prev.map(j => j.id === job.id && j.result
                    ? { ...j, status: 'done' as const, result: { ...j.result, card: picked }, editedVariant: picked.variants?.[0] ?? 'standard' }
                    : j));
                  refreshOwnedCount(job.id, picked.id);
                }}
                onSaved={() => {
                  markAdded(job.id, { keepJob: true });
                  if (job.result?.card) refreshOwnedCount(job.id, job.result.card.id);
                }}
                onManage={() => setQuickDeleteJobId(job.id)}
                onEditVariant={v => setJobVariant(job.id, v)}
                onEditCondition={c => setJobCondition(job.id, c)}
                onEditLanguage={l => setJobLanguage(job.id, l)}
              />
            )}
          </div>
        );
      })()}

      {/* ── Erkennen-Modus: kompakter „wird erkannt"-Hinweis während Gemini lädt.
          Sitzt unten (über der Footer-Leiste), damit das eingefrorene Foto mit
          Ampel-Rahmen in der Kameraansicht sichtbar bleibt. Verschwindet, sobald
          die erkannte Karte (recognizedJobId) übernimmt. */}
      {mode === 'scanning' && scanMode === 'recognize' && !recognizedJobId && (() => {
        const processing = jobs.find(j => j.origin === 'recognize' && j.status === 'processing');
        if (!processing) return null;
        return (
          <div
            className="absolute inset-x-0 z-10 flex justify-center pointer-events-none"
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 104px)' }}
          >
            <div
              className="flex items-center gap-2 px-4 py-2 rounded-full"
              style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            >
              <Loader2 size={16} color="#fff" className="animate-spin" />
              <span className="text-white text-xs font-medium">Karte wird erkannt …</span>
            </div>
          </div>
        );
      })()}

      {/* ── Erkennen-Modus: „Keine Karte im Bild" (gemini-blind) ───────────
          Nur DIESER Fall zeigt die gezeichnete Enigmon-Fehlerkarte — hier gibt
          es nichts zu korrigieren (Gemini sah gar keine Karte). Alle anderen
          nicht-erkannt-Fälle (nicht vollständig erkannt / Katalog-Miss / Nicht-
          Western) laufen über RecognizedCardLarge (unresolved) mit Korrigieren-
          Flow — siehe Block darunter. */}
      {mode === 'scanning' && scanMode === 'recognize' && !recognizedJobId && (() => {
        const errored = jobs.find(j => j.origin === 'recognize' && j.status === 'error');
        if (!errored) return null;
        const ec = classifyJobError(errored);
        if (ec.kind !== 'gemini-blind') return null;   // korrigierbare Fälle: siehe unten
        const { Icon: HeaderIcon, iconColor, cardName, attackTitle, attackText } = ec;
        // Normal-Typ-Farbe (Hauptspiel-Normal-Typ-Ton), für eine authentisch
        // wirkende Karte statt der früheren rot eingefärbten Glitch-Optik.
        const normalDark = '#6f6d4e';

        return (
          <div
            className="absolute inset-x-0 z-10 flex flex-col items-center px-6 gap-3 pointer-events-none"
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + 56px)',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
            }}
          >
            {/* Pokémon-Karten-Look: unbekannte Karte (Typ Normal) */}
            <div
              className="relative pointer-events-auto"
              style={{
                aspectRatio: '63 / 88',
                height: 'min(70vh, 100%)',
                maxWidth: '100%',
                borderRadius: 14,
                background: 'linear-gradient(180deg, #d9d4b0 0%, #b8b287 100%)',
                padding: 8,
                boxShadow: '0 10px 40px rgba(0,0,0,0.55)',
              }}
            >
              {/* Innerer Kartenrahmen */}
              <div
                className="w-full h-full flex flex-col"
                style={{
                  borderRadius: 8,
                  background: 'linear-gradient(180deg, #f7f4e4 0%, #ece5c4 100%)',
                  overflow: 'hidden',
                }}
              >
                {/* Header: Name + Typ + KP */}
                <div
                  className="flex items-center justify-between px-3 py-2 gap-2"
                  style={{ background: 'rgba(111,109,78,0.16)' }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white shrink-0"
                      style={{ background: normalDark }}
                    >
                      NORMAL
                    </span>
                    <span className="text-base font-extrabold leading-none truncate" style={{ color: '#1a1a1a' }}>
                      {cardName}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-0.5 shrink-0">
                    <span className="text-[10px] font-bold" style={{ color: '#1a1a1a' }}>KP</span>
                    <span className="text-base font-extrabold" style={{ color: normalDark }}>???</span>
                  </div>
                </div>

                {/* Artwork-Bereich: gezeichnete Landschaft mit Fragezeichen */}
                <div
                  className="flex-1 mx-3 my-2 relative overflow-hidden"
                  style={{
                    border: '3px solid rgba(0,0,0,0.55)',
                    borderRadius: 4,
                    minHeight: 100,
                  }}
                >
                  <ErrorLandscapeArtwork className="w-full h-full" />
                  {/* Sekundäres Fehlertyp-Icon oben rechts (klein, zur Diagnose) */}
                  <div className="absolute top-2 right-2 p-1 rounded-full" style={{ background: 'rgba(255,255,255,0.65)' }}>
                    <HeaderIcon size={18} color={iconColor} strokeWidth={2.5} />
                  </div>
                </div>

                {/* Beschreibungs-Banner — Stufe + Pokédex-Nr.-Stil */}
                <div className="px-3 py-1 text-[10px] italic flex items-center gap-1.5" style={{ color: '#1a1a1a' }}>
                  <span className="font-mono">Nr. 0404</span>
                  <span>·</span>
                  <span>Unbekannt-Pokémon</span>
                  <span>·</span>
                  <span>Größe ?,? m</span>
                </div>

                {/* Attacken-Box */}
                <div className="px-3 py-2 flex-grow-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-sm font-bold" style={{ color: '#1a1a1a' }}>{attackTitle}</span>
                    <span className="text-xs font-extrabold" style={{ color: normalDark }}>●</span>
                  </div>
                  <p className="text-[11px] leading-snug" style={{ color: '#3a3a3a' }}>
                    {attackText}
                  </p>
                </div>

                {/* Footer: Set-Code + Nummer (echtes Pokémon-Layout) */}
                <div
                  className="flex items-center justify-between px-3 py-1 text-[10px] font-mono"
                  style={{ background: 'rgba(0,0,0,0.06)', color: '#1a1a1a' }}
                >
                  <span className="flex items-center gap-1">
                    <span className="font-bold" style={{ color: normalDark }}>???</span>
                    <span>0/0</span>
                  </span>
                  <span className="text-[9px]">©Pokédex Error-Edition</span>
                </div>
              </div>
            </div>

            {/* Manuelle Rettung: richtige Karte selbst wählen (öffnet den Picker) →
                nicht-erkannte Karte wird danach als erkannte Karte hinzufügbar. */}
            <button
              onClick={() => setReportJobId(errored.id)}
              className="pointer-events-auto flex items-center gap-2 h-11 px-6 rounded-full font-semibold text-sm text-white glass-overlay"
            >
              <Flag size={16} /> Richtige Karte wählen
            </button>
          </div>
        );
      })()}

      {/* ── Erkennen-Modus: NICHT (vollständig) erkannt → gleiche Ansicht wie
          eine erkannte Karte (Foto + gelesene Werte), aber mit deaktiviertem
          „Hinzufügen" und prominentem „Korrigieren". Korrigieren öffnet den
          ScanCorrectionPanel-Slider; die Auswahl macht daraus via submitReport
          eine normale erkannte Karte (dann greift der Block darunter). Gilt für
          alle korrigierbaren Fehler-Arten (nicht gemini-blind). */}
      {mode === 'scanning' && scanMode === 'recognize' && !recognizedJobId && (() => {
        const errored = jobs.find(j => j.origin === 'recognize' && j.status === 'error');
        if (!errored) return null;
        if (classifyJobError(errored).kind === 'gemini-blind') return null; // → Enigmon-Block oben
        return (
          <RecognizedCardLarge
            key={errored.id}
            job={errored}
            onCardTap={() => { /* keine echte Karte → kein Detail */ }}
            onSubmitReport={result => submitReport(errored, result)}
            onPickNotInCatalog={pending => {
              setJobs(prev => prev.map(j => j.id === errored.id && j.result
                ? { ...j, status: 'done' as const, result: { ...j.result, card: pending }, editedVariant: 'standard' as CardVariant }
                : j));
              if (errored.origin === 'recognize') setRecognizedJobId(errored.id);
              submitReport(errored, { reportType: 'not_in_catalog' });
            }}
            onPickCandidate={picked => {
              setJobs(prev => prev.map(j => j.id === errored.id && j.result
                ? { ...j, status: 'done' as const, result: { ...j.result, card: picked }, editedVariant: picked.variants?.[0] ?? 'standard' }
                : j));
              if (errored.origin === 'recognize') setRecognizedJobId(errored.id);
              refreshOwnedCount(errored.id, picked.id);
            }}
            onSaved={() => {
              markAdded(errored.id, { keepJob: true });
              if (errored.result?.card) refreshOwnedCount(errored.id, errored.result.card.id);
            }}
            onManage={() => setQuickDeleteJobId(errored.id)}
          />
        );
      })()}

      {/* ── Erkennen-Modus: zentrale große Karten-Anzeige ──────────────
          Zeigt nur den zuletzt erfolgreich gescannten Job. Neuer Scan
          überschreibt visuell, aber alle Scans bleiben in `jobs`. */}
      {mode === 'scanning' && scanMode === 'recognize' && recognizedJobId && (() => {
        // Große erkannte Karte erst NACH Gemini. Der Ampel-Rahmen direkt nach dem
        // (manuellen) Auslösen läuft davor am eingefrorenen Foto in der
        // Kameraansicht (CameraCapture) — nicht hier an der großen Karte.
        const recognized = jobs.find(j => j.id === recognizedJobId) ?? null;
        if (!recognized?.result?.card) return null;
        return (
          <RecognizedCardLarge
            key={recognized.id}
            job={recognized}
            onCardTap={() => setActiveJobId(recognized.id)}
            onSubmitReport={result => submitReport(recognized, result)}
            onPickNotInCatalog={pending => {
              // Anzeige auf die Pending-Karte umstellen (→ „Hinzufügen" legt sie
              // an, Reconcile beim nächsten Sync) UND als „nicht im Katalog" melden.
              setJobs(prev => prev.map(j => j.id === recognized.id && j.result
                ? { ...j, result: { ...j.result, card: pending }, editedVariant: 'standard' as CardVariant }
                : j));
              submitReport(recognized, { reportType: 'not_in_catalog' });
            }}
            onPickCandidate={picked => {
              setJobs(prev => prev.map(j => j.id === recognized.id && j.result
                ? { ...j, result: { ...j.result, card: picked }, editedVariant: picked.variants?.[0] ?? 'standard' }
                : j));
              refreshOwnedCount(recognized.id, picked.id);
            }}
            onSaved={() => {
              // keepJob: Einzelscan bleibt auf der erkannten Karte stehen (kein
              // Auto-Zurück in die Live-Ansicht) — erst Schließen/Scan-Button
              // (Resume) räumt auf.
              markAdded(recognized.id, { keepJob: true });
              if (recognized.result?.card) refreshOwnedCount(recognized.id, recognized.result.card.id);
            }}
            onManage={() => setQuickDeleteJobId(recognized.id)}
          />
        );
      })()}

      {/* ── Bulk-Action-Row: Alle hinzufügen / Alle löschen ─────────────
          Sichtbar wenn Karten im Slider (Add-Modus) oder im Review-Grid.
          Im Add-Modus zwischen Slider und Toolbar.
          Im Review-Modus direkt über der Safe-Area (Toolbar ist dort weg). */}
      {(() => {
        const visible = mode === 'review' && jobs.length > 0 && viewMode !== 'single';
        if (!visible) return null;
        const unaddedCount = jobs.filter(j => j.status === 'done' && !!j.result?.card && !j.added).length;
        const totalCount = jobs.filter(j => j.origin === 'add').length;
        const selCount = selectedIds.size;
        const selAddable = jobs.filter(j => j.status === 'done' && !!j.result?.card && !j.added && selectedIds.has(j.id)).length;
        return (
          <div
            className="fixed z-40"
            style={{
              // Exakt an der Position der Footer-Navi (BottomNav ist im Review-
              // Modus ausgeblendet, die Bulk-Buttons übernehmen ihre Rolle):
              // bottom 12 / seitlich 14, wie die schwebende Navi-Leiste.
              bottom: 12, left: 14, right: 14,
            }}
          >
          {/* Glas-Panel wie die Footer-Navi (gleiche .glass-Optik + Radius 26),
              darin die beiden Aktions-Buttons in ihren Standardfarben. */}
          <div className="glass flex gap-2 p-2" style={{ borderRadius: 26 }}>
            {selectMode ? (
              <>
                <Button
                  variant="primary" size="md" accentColor="#c53030" icon={<Trash2 />}
                  onClick={() => { selectedIds.forEach(id => removeJob(id)); setSelectedIds(new Set()); }}
                  disabled={selCount === 0}
                  className="flex-1"
                >
                  {`Löschen${selCount ? ` (${selCount})` : ''}`}
                </Button>
                <Button
                  variant="primary" size="md" accentColor="#2f855a" icon={<Plus />}
                  onClick={openBulkAdd}
                  disabled={selAddable === 0}
                  className="flex-1"
                >
                  {`Hinzufügen${selAddable ? ` (${selAddable})` : ''}`}
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" size="md" accentColor="#c53030" icon={<Trash2 />} onClick={() => setConfirmClearAll(true)} className="flex-1">
                  {`Alle löschen${totalCount ? ` (${totalCount})` : ''}`}
                </Button>
                <Button
                  variant="primary" size="md" accentColor="#2f855a" icon={<Plus />}
                  onClick={openBulkAdd}
                  disabled={unaddedCount === 0}
                  className="flex-1"
                >
                  {`Alle hinzufügen${unaddedCount > 0 ? ` (${unaddedCount})` : ''}`}
                </Button>
              </>
            )}
          </div>
          </div>
        );
      })()}

      {/* ── „Alle löschen" — Sicherheitsabfrage (Bulk-Aktion) ───────────── */}
      <Dialog open={confirmClearAll} onClose={() => setConfirmClearAll(false)} title="Alle löschen?">
        <p className="text-glass-muted text-role-body mb-5">
          {(() => {
            const n = jobs.filter(j => j.origin === 'add').length;
            return `${n} gescannte ${n === 1 ? 'Karte wird' : 'Karten werden'} verworfen. Bereits hinzugefügte Karten bleiben in deiner Sammlung.`;
          })()}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmClearAll(false)}>
            Abbrechen
          </Button>
          <Button
            variant="primary" accentColor="#c53030" icon={<Trash2 />} className="flex-1"
            onClick={() => { clearAllJobs(); setConfirmClearAll(false); }}
          >
            Alle löschen
          </Button>
        </div>
      </Dialog>

      {/* ── Scanner verlassen — Bestätigung bei offenen Karten ──────────── */}
      <Dialog open={confirmExit} onClose={() => setConfirmExit(false)} title="Scannen verlassen?">
        <p className="text-glass-muted text-role-body mb-5">
          {`${pendingExitCount} gescannte ${pendingExitCount === 1 ? 'Karte ist' : 'Karten sind'} noch nicht hinzugefügt. Beim Verlassen ${pendingExitCount === 1 ? 'geht sie' : 'gehen sie'} verloren.`}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmExit(false)}>
            Abbrechen
          </Button>
          <Button
            variant="primary" accentColor="#c53030" icon={<X strokeWidth={2.5} />} className="flex-1"
            onClick={() => { setConfirmExit(false); router.push('/'); }}
          >
            Verlassen
          </Button>
        </div>
      </Dialog>


      {/* Footer wird jetzt von der globalen BottomNav übernommen.
          Stream-Pause, Mode-Switch und Grid-Button laufen über Custom-Events
          (siehe useEffect am Anfang der Component). */}

      {/* ── Bulk-Add-Modal: „Alle hinzufügen" fragt Werte ab ─────────── */}
      {bulkModalOpen && (() => {
        const targets = jobs.filter(j => j.status === 'done' && !!j.result?.card && !j.added
          && (selectMode && selectedIds.size ? selectedIds.has(j.id) : true));
        const bulkJobs = targets.map(j => ({
          id: j.id,
          card: j.result!.card!,
          language: j.editedLanguage ?? j.result!.language,
          editedVariant: j.editedVariant,
          editedCondition: j.editedCondition,
        }));
        return (
          <BulkAddToCollectionModal
            jobs={bulkJobs}
            onClose={() => setBulkModalOpen(false)}
            onJobSaved={(id) => {
              markAdded(id);
              const tcgId = jobs.find(j => j.id === id)?.result?.card?.id;
              if (tcgId) refreshOwnedCount(id, tcgId);
            }}
            onAllSaved={() => { setBulkModalOpen(false); setSelectedIds(new Set()); }}
          />
        );
      })()}

      {/* ── Fehler-Diagnose-Modal — tappbar von jeder Error-Tile ──────── */}
      {errorDetailJob && (() => {
        const job = errorDetailJob;
        const gp = job.debug?.geminiParsed as
          | { error?: string; setCode?: string | null; number?: string | null;
              language?: string; confidence?: string; nationalDexNumber?: number | null;
              _symbolMatch?: GeminiResponse['_symbolMatch'] }
          | undefined;

        let HeaderIcon = AlertCircle;
        let iconColor = '#f87171';
        let title = 'Karte konnte nicht erkannt werden';
        let hint = 'Halte die Karte deutlicher in den Rahmen oder versuche eine andere Belichtung.';
        let kind: 'gemini-blind' | 'gemini-thin' | 'catalog-miss' = 'catalog-miss';
        if (gp?.error || job.debug?.error === 'No card detected') {
          kind = 'gemini-blind';
          HeaderIcon = EyeOff;
          iconColor = '#facc15';
          title = 'Keine Karte im Bild';
          hint = 'Bitte Karte deutlicher in den Rahmen halten.';
        } else if (!gp?.setCode && !gp?.number && !gp?.nationalDexNumber) {
          kind = 'gemini-thin';
          HeaderIcon = AlertTriangle;
          iconColor = '#fb923c';
          title = 'Karten-Text konnte nicht gelesen werden';
          hint = 'Beleuchte die Karte stärker oder rücke näher heran.';
        } else {
          kind = 'catalog-miss';
          HeaderIcon = SearchX;
          iconColor = '#f87171';
          title = 'Karte nicht im Katalog gefunden';
          hint = 'Möglicherweise ein Set, das noch nicht synchronisiert ist.';
        }

        const close = () => setErrorDetailJobId(null);
        const removeAndClose = () => {
          setJobs(prev => prev.filter(j => j.id !== job.id));
          close();
        };

        return (
          <div
            className="fixed inset-0 z-[70] flex items-end"
            onClick={close}
          >
            <div className="absolute inset-0 bg-black/60" />
            <div
              className="relative w-full rounded-t-2xl bg-card border-t border-border p-5 pb-safe flex flex-col gap-3"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-border mx-auto" />
              <div className="flex flex-col items-center gap-2 text-center">
                <HeaderIcon size={36} color={iconColor} />
                <p className="text-base font-semibold leading-tight">{title}</p>
                <p className="text-sm text-muted-foreground leading-snug max-w-xs">{hint}</p>
              </div>

              {gp && kind !== 'gemini-blind' && (
                <div
                  className="rounded-lg px-3 py-2.5"
                  style={{ background: 'var(--secondary)', fontFamily: 'monospace' }}
                >
                  <div className="text-[10px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Gemini
                  </div>
                  <div className="grid grid-cols-[80px_1fr] gap-x-2 text-[12px] leading-snug">
                    <span className="text-muted-foreground">Set-Code</span>
                    <span>
                      {gp.setCode ?? <span className="text-muted-foreground">— (Symbol)</span>}
                      {!gp.setCode && gp._symbolMatch?.triggered && (gp._symbolMatch.candidateSetCodes?.length ?? 0) > 0 && (
                        <span className="text-muted-foreground text-[10px]"> (Symbol-Abgleich: {gp._symbolMatch.candidateSetCodes!.join(', ')}, {gp._symbolMatch.matchConfidence ?? '?'}{gp._symbolMatch.matchAmbiguous ? ', mehrdeutig' : ''})</span>
                      )}
                    </span>
                    <span className="text-muted-foreground">Nummer</span>
                    <span>{gp.number ?? <span className="text-muted-foreground">—</span>}</span>
                    <span className="text-muted-foreground">Sprache</span>
                    <span>{gp.language ?? '—'}</span>
                    <span className="text-muted-foreground">Dex-Nr.</span>
                    <span>{gp.nationalDexNumber ?? <span className="text-muted-foreground">—</span>}</span>
                    <span className="text-muted-foreground">Confidence</span>
                    <span>{gp.confidence ?? '—'}</span>
                  </div>
                  {kind === 'catalog-miss' && job.debugInfo && (
                    <div className="text-[11px] text-muted-foreground mt-1.5 break-words">
                      {job.debugInfo.split('|').slice(-1)[0].trim()}
                    </div>
                  )}
                </div>
              )}

              {/* An Gemini hochgeladenes Bild — zeigt, was tatsächlich gesnappt wurde
                  (Karte sauber / abgeschnitten / leerer Frame mit Hand?) */}
              {job.debug?.imageBase64 && (
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--secondary)' }}>
                  <p className="text-[10px] text-muted-foreground px-2 py-1 uppercase tracking-wide font-mono">
                    An Gemini gesendet{job.debug.imageSizeKb ? ` · ${job.debug.imageSizeKb} KB` : ''}
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${job.debug.mimeType ?? 'image/jpeg'};base64,${job.debug.imageBase64}`}
                    alt="Scan-Crop"
                    className="w-full object-contain bg-black"
                    style={{ maxHeight: 280 }}
                  />
                </div>
              )}

              <Button
                variant="primary"
                icon={<Flag />}
                onClick={() => { setReportJobId(job.id); close(); }}
                className="w-full mt-1"
              >
                Richtige Karte wählen
              </Button>
              <div className="flex gap-2 pt-1">
                <Button
                  variant="primary"
                  accentColor="#c53030"
                  icon={<Trash2 />}
                  onClick={removeAndClose}
                  className="flex-1"
                >
                  Entfernen
                </Button>
                <Button variant="secondary" onClick={close} className="flex-1">
                  Schließen
                </Button>
              </div>
            </div>
          </div>
        );
      })()}


      {/* ── Melden-Sheet (Grundwahrheit für die Fehleranalyse erfassen) ─── */}
      {reportJob && (() => {
        // Geminis gelesener Name/Sprache (oft korrekt, auch wenn der Katalog-
        // Lookup danebenlag) als Such-Vorbelegung + Anzeige-/Sortier-Sprache.
        const gp = reportJob.debug?.geminiParsed as { name?: string | null; language?: string | null } | undefined;
        return (
          <ScanReportSheet
            recognizedName={reportJob.result?.card?.name}
            seedQuery={gp?.name ?? reportJob.result?.card?.name ?? undefined}
            language={gp?.language ?? reportJob.result?.language ?? undefined}
            imageSrc={reportJob.debug?.imageBase64 ? `data:${reportJob.debug.mimeType ?? 'image/jpeg'};base64,${reportJob.debug.imageBase64}` : undefined}
            onClose={() => setReportJobId(null)}
            onSubmit={result => submitReport(reportJob, result)}
          />
        );
      })()}
      {reportToast && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[120] px-4 py-2 rounded-full bg-black/85 text-white text-sm font-medium"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 90px)' }}>
          Danke — gemeldet ✓
        </div>
      )}

      {/* ── CardDetailSheet (öffnet sich beim Tap auf eine erkannte Karte) ─ */}
      <CardDetailSheet
        card={activeJob?.result?.card ?? null}
        ownedCopies={activeOwnedCopies}
        onClose={() => setActiveJobId(null)}
        onSaved={() => {
          if (activeJob) {
            markAdded(activeJob.id);
            if (activeJob.result?.card) refreshOwnedCount(activeJob.id, activeJob.result.card.id);
          }
        }}
      />

      {/* ── Quick-Add-Modal (via + Button auf der Tile) ────────────────
          Öffnet AddToCollectionModal mit Variante/Condition/Sprache
          aus den Job-Werten vorbelegt — User pickt nur Binder + speichert. */}
      {quickAddJob?.result?.card && (
        <AddToCollectionModal
          card={quickAddJob.result.card}
          preVariant={quickAddJob.editedVariant ?? quickAddJob.result.variant}
          preCondition={quickAddJob.editedCondition}
          preLanguage={quickAddJob.result.language}
          fromScanner
          onClose={() => setQuickAddJobId(null)}
          onSaved={() => {
            markAdded(quickAddJob.id);
            refreshOwnedCount(quickAddJob.id, quickAddJob.result!.card!.id);
            setQuickAddJobId(null);
          }}
        />
      )}

      {/* ── Löschen-Drawer (via - Button auf der Tile) ─────────────────
          Zeigt alle Sammlungen, in denen die Karte steckt, mit Löschen pro
          Zeile + „Überall löschen" — kein CardDetailSheet-Zwischenschritt. */}
      {quickDeleteJob?.result?.card && (
        <DeleteFromCollectionModal
          card={quickDeleteJob.result.card}
          fromScanner
          matchVariant={quickDeleteJob.editedVariant ?? quickDeleteJob.result.variant}
          matchCondition={quickDeleteJob.editedCondition}
          matchLanguage={quickDeleteJob.result.language}
          onClose={() => setQuickDeleteJobId(null)}
          onDeleted={() => {
            const tcgId = quickDeleteJob.result!.card!.id;
            getCardsByTcgId(tcgId).then(copies => {
              setJobs(prev => prev.map(j =>
                j.id === quickDeleteJob.id && j.result
                  ? { ...j, result: { ...j.result, ownedCount: copies.length } }
                  : j
              ));
            });
          }}
        />
      )}

      {/* ── Fake-Reasons-Sheet (warum Gemini Fake/Verdacht meldet) ─────── */}
      {fakeReasonsJob?.result && (fakeReasonsJob.result.fakeRisk === 'medium' || fakeReasonsJob.result.fakeRisk === 'high') && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center"
          onClick={() => setFakeReasonsJobId(null)}
        >
          <div
            className="w-full max-w-md bg-card rounded-t-2xl p-5 pb-8 shadow-elevated"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle
                size={22}
                color={fakeReasonsJob.result.fakeRisk === 'high' ? '#ef4444' : '#facc15'}
                fill={fakeReasonsJob.result.fakeRisk === 'high' ? '#ef4444' : '#facc15'}
              />
              <h3 className="text-foreground font-semibold text-base">
                {fakeReasonsJob.result.fakeRisk === 'high' ? 'Fake-Verdacht' : 'Verdächtig'}
              </h3>
              <button
                onClick={() => setFakeReasonsJobId(null)}
                className="ml-auto w-9 h-9 rounded-full bg-secondary flex items-center justify-center"
                aria-label="Schließen"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Gemini meldet diese Karte als <strong>{fakeReasonsJob.result.fakeRisk === 'high' ? 'wahrscheinlich gefälscht' : 'verdächtig'}</strong>. Begründungen:
            </p>
            {fakeReasonsJob.result.fakeReasons && fakeReasonsJob.result.fakeReasons.length > 0 ? (
              <ul className="space-y-2 text-sm text-foreground">
                {fakeReasonsJob.result.fakeReasons.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Keine spezifischen Gründe genannt. Manchmal liegt's an Bildqualität, Beleuchtung oder Reflexionen — kein zwingender Fake-Hinweis.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ───── Scan-Karten-Bild ──────────────────────────────────────────────────
// Gemeinsame Bildanzeige für Slider-Kachel UND Review-Grid: probiert ALLE
// Katalogbild-Kandidaten (nicht nur den ersten) und fällt bei echtem Fehlschlag
// aufs Scan-Foto zurück — sonst zeigte das Grid ein „?" (kaputtes <img>), wenn
// der erste Kandidat 404 lieferte (z.B. fehlendes TCGdex-DE-Bild).
function ScanCardImage({ job, className = 'w-full h-full object-cover' }: { job: ScanJob; className?: string }) {
  const card    = job.result?.card;
  const isError = job.status === 'error';
  const scanPhoto = job.debug?.imageBase64
    ? `data:${job.debug?.mimeType ?? 'image/jpeg'};base64,${job.debug.imageBase64}`
    : null;
  const cardCandidates = (!isError && card)
    ? cardImageCandidates(card, { size: 'small', language: job.result?.language })
    : [];
  const [candIdx, setCandIdx] = useState(0);
  useEffect(() => { setCandIdx(0); }, [card?.id]);
  const cardImg = candIdx < cardCandidates.length ? cardCandidates[candIdx] : null;
  const shown   = cardImg ?? scanPhoto;
  if (!shown) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-red-500/10">
        <AlertCircle size={24} color="#f87171" />
      </div>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={shown}
      alt={card?.name ?? ''}
      className={className}
      onError={() => { if (cardImg) setCandIdx(i => i + 1); }}
    />
  );
}

// ───── Scanned-Card-Tile ─────────────────────────────────────────────────
// Tile-Breite: so gewählt, dass ~3 Karten voll sichtbar sind und links eine
// vierte angeschnitten „hervorlugt" (Slider-Hinweis). Der Slider läuft jetzt
// randlos (kein Container-Padding), nur rechts hält ein Gap (pr-2, 8px) — daher
// „100vw - 8px" statt „- 32px": die Kacheln werden dadurch etwas größer.
// Divisor 3.15 statt glatt 3 → der linke Peek.
const TILE_WIDTH_CSS = 'calc((100vw - 8px) / 3.15)';
// Zuletzt gescannte Karte größer — als ECHTE Layout-Breite (nicht transform:scale),
// damit sie die Nachbarn nicht überlappt und der Abstand konstant bleibt.
const TILE_WIDTH_LATEST_CSS = 'calc((100vw - 8px) / 3.15 * 1.16)';

interface ScannedCardTileProps {
  job: ScanJob;
  isLatest:          boolean;
  /** Erste (älteste) Kachel — bekommt `margin-left:auto`, damit der Slider bei
   *  wenigen Karten RECHTSbündig ist (neueste Karte ganz rechts). Bei Überlauf
   *  kollabiert die Auto-Margin auf 0 → normales Scrollen, Start erreichbar. */
  isFirst:           boolean;
  /** Set-Symbol-URL (nur Symbol-only-Sets) für das Sublabel unter der Karte. */
  symbolUrl?:        string;
  onRemove:          () => void;
  /** Antippen der Karte → Korrektur-/Detail-Ansicht (wie Einzelscan). */
  onOpen:            () => void;
}

// Bewusst reduziert (Nutzerwunsch): nur Kartenbild + EIN Löschen-Button. Keine
// Varianten-/Zustand-Pillen, kein Wert-/Tiefen-Badge — die Feinbearbeitung
// passiert beim Antippen (Korrektur-Ansicht) bzw. im Review-Grid/Bulk-Add.
function ScannedCardTile({ job, isLatest, isFirst, symbolUrl, onRemove, onOpen }: ScannedCardTileProps) {
  const card      = job.result?.card;
  const isError   = job.status === 'error';
  const borderStatus = computeBorderStatus(job);
  // Sublabel-Werte (wie im Grid): Set-Kürzel/-Symbol + Nummer (mit führenden
  // Nullen, wie aufgedruckt).
  const symbolOnly = !!card?.series && SYMBOL_ONLY_SERIES.includes(card.series);
  const cardNum = card?.number && card.printedTotal && /^\d+$/.test(card.number)
    ? card.number.padStart(String(card.printedTotal).length, '0')
    : (card?.number ?? '');
  // Besitz-Anzahl (Summe der Exemplar-Mengen, wie in der Card-Komponente).
  const ownedTotal = (job.result?.ownedCards ?? []).reduce((s, c) => s + c.quantity, 0);
  // Scan-Foto — nur noch für NICHT (sicher) erkannte Karten (zum Korrigieren).
  // Erkannte Karten rendern über die geteilte CardImage-Komponente (dieselbe wie
  // im Grid): Skeleton → Katalogbild (Kandidaten-Kette, next/image, lazy),
  // Platzhalter statt Schwarz. Das behebt die extrem langsame/parallele
  // Roh-<img>-Ladekette + die schwarzen Kacheln.
  const scanPhoto = job.debug?.imageBase64
    ? `data:${job.debug?.mimeType ?? 'image/jpeg'};base64,${job.debug.imageBase64}`
    : null;

  return (
    <div
      className="shrink-0"
      style={{
        width: isLatest ? TILE_WIDTH_LATEST_CSS : TILE_WIDTH_CSS,
        // Rechtsbündig bei wenigen Karten: die erste Kachel schiebt die Gruppe
        // per Auto-Margin nach rechts; bei Überlauf wird die Margin 0 (scrollbar).
        marginLeft: isFirst ? 'auto' : undefined,
        scrollSnapAlign: 'end',
        transition: 'width 0.2s ease-out',
        zIndex: isLatest ? 2 : 1,
      }}
    >
      {/* Karten-Body — antippen öffnet die Korrektur-/Detail-Ansicht (außer
          während der Verarbeitung). */}
      <div
        className="relative w-full rounded-md overflow-hidden"
        style={{
          aspectRatio: '63 / 88',
          // Nicht erkannt → roter Rahmen als „bitte prüfen"-Hinweis; sonst die
          // normale Rahmenlogik (pHash-Mismatch/Fake/none).
          ...(isError ? { border: '2.5px solid #ef4444' } : borderStyleFor(borderStatus, job.result?.fakeRisk)),
          background: '#1a1a1a',
          cursor: job.status === 'processing' ? 'default' : 'pointer',
        }}
        onClick={job.status === 'processing' ? undefined : onOpen}
      >
        {card && !isError ? (
          /* Erkannte Karte: geteilte CardImage-Komponente (wie im Grid) — Skeleton
             → Katalogbild (egal welche Größe zuerst lädt), Platzhalter statt
             Schwarz, lazy geladen. */
          <CardImage
            card={card}
            size="small"
            language={job.result?.language}
            alt={card.name}
            width={245}
            height={342}
            className="w-full h-full object-cover"
            placeholderInfo={{
              name: card.name, hp: card.hp, number: card.number,
              total: card.printedTotal ?? card.total, dexNumber: card.nationalDexNumber,
              setCode: card.setCode, types: card.types, pending: card.pendingCatalog,
            }}
          />
        ) : job.status === 'processing' ? (
          /* Erkennung läuft → Skeleton (Karte kommt gleich). */
          <div className="absolute inset-0 animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
        ) : scanPhoto ? (
          /* Nicht (sicher) erkannt: das aufgenommene Foto zeigen, damit man beim
             Antippen korrigieren kann. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={scanPhoto} alt="Scan" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-red-500/10">
            <AlertCircle size={22} color="#f87171" />
          </div>
        )}

        {/* Einziger Bedien-Button: Löschen — App-Standard-Button (rund, rot,
            Trash2) statt eines eigenen eckigen Roh-Buttons. */}
        <Button
          variant="primary"
          size="sm"
          accentColor="#c53030"
          icon={<Trash2 />}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label="Entfernen"
          className="absolute bottom-1 right-1 shadow-md"
        />

        {/* Abweichende Werte (Variante/Zustand/Sprache ≠ Standard) unten links. */}
        {(() => {
          const meta = nonDefaultScanMeta(job);
          return meta.length > 0 ? (
            <div className="absolute bottom-1 left-1 flex flex-col items-start gap-0.5 max-w-[68%]">
              {meta.map((m, i) => (
                <span key={i} className="text-[8px] font-bold leading-none px-1 py-0.5 rounded bg-black/70 text-white truncate max-w-full">{m}</span>
              ))}
            </div>
          ) : null;
        })()}

        {/* Standard-Badges wie auf den App-Kacheln (CardBadge): Anzahl (grün,
            oben rechts, ab 1 Exemplar — Dubletten beim Scannen erkennen) +
            „ungeprüft" (gelb „!", oben links). */}
        {ownedTotal > 0 && (
          <CardBadge size={24} color="rgba(53,209,90,.9)" corner="tr" cornerRadius={6} style={{ top: 0, right: 0 }}>
            ×{ownedTotal}
          </CardBadge>
        )}
        {job.result?.ownedNeedsReview && (
          <CardBadge size={24} color="var(--pokedex-yellow)" corner="tl" cornerRadius={6} style={{ top: 0, left: 0 }} ariaLabel="Besitz ungeprüft" title="Mind. ein Exemplar ungeprüft">
            <ExclamationMark size={13} strokeWidth={3} className="text-white" />
          </CardBadge>
        )}

        {/* Added-Overlay */}
        {job.added && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Check size={28} color="#48bb78" strokeWidth={3} />
          </div>
        )}
      </div>

      {/* Sublabel unter der Karte: Set-Kürzel/-Symbol + Nummer (wie im Grid). */}
      {card && (cardNum || card.setCode) && (
        <div className="mt-1.5 flex items-center justify-center gap-1 px-0.5">
          {symbolOnly && symbolUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={symbolUrl} alt="" className="w-[13px] h-[13px] object-contain shrink-0" />
          ) : card.setCode ? (
            <span
              className="text-[9px] font-bold rounded-[5px] shrink-0 leading-none"
              style={{ color: '#9A9DA6', background: '#F2F2F2', padding: '1px 5px', letterSpacing: '.03em' }}
            >
              {card.setCode}
            </span>
          ) : null}
          <span className="text-[11px] text-glass truncate">{cardNum}</span>
        </div>
      )}
    </div>
  );
}

// ───── Recognized-Card-Large ─────────────────────────────────────────────
// Zentrale große Karten-Anzeige im Erkennen-Modus. Banner oben zeigt Owned-
// Status (grün=in Sammlung, rot=neu). Pills bleiben editierbar (für Stufe-2-
// Add-Workflow via Tap), aber kein Trash, kein Add-Button.

interface RecognizedCardLargeProps {
  job: ScanJob;
  onCardTap: () => void;
  /** Korrektur/Melden aus dem Inline-Panel: korrigierte Karte übernehmen +
   *  still melden (reportType 'wrong'), oder 'not_in_catalog'. */
  onSubmitReport: (result: ScanReportResult) => void;
  /** Nutzer wählt bei mehrdeutiger Erkennung eine der Kandidaten-Karten. */
  onPickCandidate: (card: CardInfo) => void;
  /** „Nicht im Katalog" aus dem Korrektur-Panel: die aus dem Scan gebaute
   *  Pending-Karte als aktive Karte übernehmen (→ „Hinzufügen" legt sie an) +
   *  melden. */
  onPickNotInCatalog: (pending: CardInfo) => void;
  /** Nach Hinzufügen über die Inline-Leiste: ownedCount/added aktualisieren. */
  onSaved: () => void;
  /** Öffnet den Exemplar-Verwalten/Löschen-Drawer. */
  onManage: () => void;
  /** Nur-Korrektur-Modus (Mehrfachscan-Slider-Tipp): blendet die Hinzufügen-/
   *  Verwalten-Leiste aus, zeigt nur „Korrigieren" + Kandidaten-Auswahl.
   *  Hinzufügen/Löschen passiert dort gebündelt im Review-Grid. */
  correctionOnly?: boolean;
  /** Eingebettet in den Einzelkarten-View (Mehrfachscan-Grid „Einzeln"): füllt
   *  den Eltern-Layer (absolute inset-0) statt sich selbst als Vollbild über
   *  den fixen Header zu legen. Optik/Bedienung sonst identisch zum Einzelscan. */
  embedded?: boolean;
  /** Teil-Rendering für den Einzelkarten-Swipe: 'image' rendert nur das
   *  Kartenbild (horizontale Swipe-Ebenen), 'panel' nur das Info-/Add-Panel
   *  (das separat vertikal ein-/ausgleitet). 'full' (Default) = beides zusammen
   *  (Einzelscan/Korrektur). So swipt nur das Bild, während das Panel unten
   *  raus- und mit den neuen Infos wieder reingleitet. */
  part?: 'full' | 'image' | 'panel';
  /** Persistiert die im Inline-Panel gewählten Werte am Job (Korrektur-Overlay)
   *  — damit „Alle hinzufügen" im Grid je Karte die richtigen Werte nimmt. */
  onEditVariant?: (variant: CardVariant) => void;
  onEditCondition?: (condition: PersistedCondition) => void;
  onEditLanguage?: (language: CardLanguage) => void;
}

function RecognizedCardLarge({
  job, onCardTap, onSubmitReport, onPickCandidate, onPickNotInCatalog, onSaved, onManage,
  correctionOnly = false, embedded = false, part = 'full', onEditVariant, onEditCondition, onEditLanguage,
}: RecognizedCardLargeProps) {
  const [correcting, setCorrecting] = useState(false);

  // Pending-Karte aus den gelesenen Gemini-Werten bauen (für „Nicht im Katalog"
  // im Korrektur-Panel). Anders als beim Scan-Zeitpunkt (der ein Set-Signal
  // verlangt, um pending vs. Fehler automatisch zu entscheiden) genügt hier
  // Name ODER Nummer — der Nutzer sagt aktiv „nicht im Katalog", wir bauen die
  // Karte aus dem, was gelesen wurde. Nur wenn gar nichts lesbar ist → null.
  const pendingFromScan: CardInfo | null = (() => {
    const gp = job.debug?.geminiParsed as {
      name?: string | null; setCode?: string | null; number?: string | null;
      printedTotal?: number | null; nationalDexNumber?: number | null; hp?: number | null;
    } | undefined;
    const num = gp?.number ? String(gp.number) : '';
    if (!gp || (!num && !gp.name)) return null;
    return {
      id: `pending-${job.id}`,
      name: gp.name ?? 'Unbekannte Karte',
      number: num,
      setId: '',
      setName: gp.setCode ?? '?',
      setCode: gp.setCode ?? undefined,
      printedTotal: gp.printedTotal ?? undefined,
      hp: gp.hp ?? undefined,
      nationalDexNumber: gp.nationalDexNumber ?? undefined,
      imgSmall: '', imgLarge: '',
      pendingCatalog: true,
    };
  })();
  const card      = job.result?.card;
  // „Noch nicht aufgelöst": Karte wurde nicht (sicher) erkannt (status 'error',
  // result.card null) — trotzdem wie eine erkannte Karte anzeigen (Foto + soweit
  // gelesene Werte) und über „Korrigieren" die richtige Karte wählen lassen.
  const unresolved = !card;
  // Anzeige-Karte: die echte erkannte Karte, sonst die aus dem Scan gebaute
  // Pending-Karte (Name/Nummer soweit gelesen), sonst eine neutrale Unbekannt-
  // Karte, damit die Ansicht + „Korrigieren" immer funktionieren.
  const displayCard: CardInfo = card ?? pendingFromScan ?? {
    id: `pending-${job.id}`, name: 'Nicht erkannt', number: '', setId: '',
    setName: '?', imgSmall: '', imgLarge: '', pendingCatalog: true,
  };
  // Bild-Kandidaten in Prioritätsreihenfolge — bei 404/Ladefehler eines
  // Kandidaten (z.B. fehlendes TCGdex-DE-Bild) probiert onError automatisch
  // den nächsten, bevor der Platzhalter gezeigt wird (siehe img-Rendering
  // unten). Während des Scans (processing) UND im unresolved-Fall (keine
  // Katalog-Karte) gibt's nur das lokale Foto.
  const imgCandidates = (job.status === 'processing' || unresolved) && job.debug?.imageBase64
    ? [`data:${job.debug.mimeType ?? 'image/jpeg'};base64,${job.debug.imageBase64}`]
    : cardImgUrlsLarge(job);
  const [imgIdx, setImgIdx] = useState(0);
  useEffect(() => { setImgIdx(0); }, [job.id]);
  const img = imgCandidates[imgIdx];
  const setMeta   = useSetMeta(card?.setId, undefined, card?.setName);
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => { setLogoFailed(false); }, [setMeta?.logoUrl]);
  // Echtes Seitenverhältnis des geladenen Kartenfotos — sobald bekannt (onLoad),
  // wird die Box exakt danach dimensioniert statt einer 63:88-Annahme zu folgen.
  // Fotos/Scans weichen leicht vom exakten Kartenformat ab (Zuschnitt-Ränder),
  // die Annahme führte sonst zu Zuschneiden (object-cover) oder Rand (object-contain).
  const [imgAspect, setImgAspect] = useState<number | null>(null);
  // Bis das Foto geladen ist, mit dem Standard-Kartenformat rechnen (verhindert
  // Layout-Sprung) — danach exakt mit dem echten Verhältnis des Fotos.
  const cardRatio = imgAspect ?? 63 / 88;

  // Verfügbarer Platz für die Karte (der Slot, NICHT die Karte selbst) —
  // gemessen per ResizeObserver auf dem umgebenden flex-1-Slot. Vorher wurde
  // die Kartengröße rein per CSS (aspect-ratio + max-width/max-height, ohne
  // explizite width/height) aus dem *Bildinhalt* abgeleitet — das brach
  // zusammen, sobald das Bild nicht lud (404/Netzwerkfehler): ohne Bild-
  // Eigengröße schrumpfte die Box auf die winzige "kaputtes Bild"-Anzeige,
  // wodurch auch Logo/Setname (die proportional zu sizeBasePx skalieren)
  // viel zu klein wurden. Jetzt wird die Kartengröße unabhängig vom Bild aus
  // dem verfügbaren Slot berechnet (klassische object-fit:contain-Mathematik)
  // und als expliziter px-Wert gesetzt — stabil, egal ob das Bild lädt.
  const slotRef = useRef<HTMLDivElement>(null);
  const [slotSize, setSlotSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const target = slotRef.current;
    if (!target) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSlotSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(target);
    return () => ro.disconnect();
  }, []);
  const fittedSize = (() => {
    if (!slotSize || slotSize.w <= 0 || slotSize.h <= 0) return null;
    const slotRatio = slotSize.w / slotSize.h;
    // Karte bewusst auf 80 % des verfügbaren Slots (nicht full-contain) — die
    // Karte wird groß gezeigt, aber das Glas-Overlay unten verdeckt sonst zu
    // viel; kleinere Karte lässt oben/unten Luft. Korrektur-Overlay nutzt dasselbe
    // Layout wie der Einzelscan.
    const CARD_SCALE = 0.8;
    const base = slotRatio > cardRatio
      ? { w: slotSize.h * cardRatio, h: slotSize.h }
      : { w: slotSize.w, h: slotSize.w / cardRatio };
    return { w: Math.round(base.w * CARD_SCALE), h: Math.round(base.h * CARD_SCALE) };
  })();

  // Gerenderte Kartenbreite — Basis für Logo-/Text-Größen und Ecken-Radius,
  // die proportional zur tatsächlichen Kartenbreite skalieren sollen (siehe
  // sizeBasePx unten). Kommt jetzt direkt aus fittedSize (kein separater
  // ResizeObserver auf dem Container mehr nötig).
  const containerRef = useRef<HTMLDivElement>(null);

  const ownedCount = job.result?.ownedCount;
  const isOwned    = (ownedCount ?? 0) > 0;

  // Rahmenfarbe: nur Fake-Risk hat Vorrang (wie Slider/Review-Grid). Der
  // pHash-Mismatch-Rahmen (auto-yellow/auto-red) wird HIER bewusst NICHT
  // angezeigt — im Einzeln-Modus sieht der Nutzer Foto, Name und Nummer
  // direkt nebeneinander und beurteilt selbst, ob die Karte stimmt; anders
  // als im Slider (Mehrere-Modus), wo der Warnrahmen als Hinweis beim
  // schnellen Durchscannen ohne Einzelprüfung dient (siehe ScannedCardTile).
  // Erst wenn nichts davon greift, zeigt der Rahmen stattdessen den
  // Besitz-Status an (grün = schon in der Sammlung, sonst keiner).
  // Während der Verarbeitung (Foto liegt vor, Karte noch nicht erkannt): Rahmen
  // nach Ampel-Bewertung des Fotos (grün = ok, gelb/rot = Reflexion/unscharf …).
  // Danach greift wieder die normale Besitz-/Fake-Rahmenlogik.
  const capColor: Record<string, string> = { green: '#48bb78', yellow: '#facc15', red: '#ef4444' };
  const processingBorder = job.status === 'processing' && job.captureLevel && capColor[job.captureLevel]
    ? `3px solid ${capColor[job.captureLevel]}`
    : null;
  const statusFlagged = !!job.result?.fakeRisk;
  const cardBorder = processingBorder ?? (statusFlagged
    ? borderStyleFor('none', job.result?.fakeRisk).border
    : isOwned ? '1.5px solid #35d15a' : '2.5px solid transparent');
  // Zusätzlicher Glow beim grünen Besitz-Rahmen — reiner Farbrand geht auf bunten
  // Kartenmotiven schnell unter, der Schein macht "schon vorhanden" unmissverständlich.
  // Farbe/Glow-Werte aus dem Glas-Handoff (design_handoff_scanner_glass, Match-Rahmen).
  const cardGlow = processingBorder
    ? `0 0 26px ${capColor[job.captureLevel!]}55`
    : !statusFlagged && isOwned
      ? '0 0 0 1.5px rgba(255,255,255,0.2), 0 8px 24px rgba(53,209,90,0.35)'
      : undefined;

  const setCode  = displayCard.setCode ?? (displayCard.setId ? displayCard.setId.toUpperCase() : undefined);
  const seriesDe = displayCard.series ? (SERIES_NAMES_DE[displayCard.series] ?? displayCard.series) : null;
  // Setnummer ("111/159") — direkt unter dem Namen, printedTotal aus tcg_sets
  // (nicht aus dem Scan-Ergebnis, siehe useSetMeta). Nur wenn eine Nummer vorliegt
  // (im unresolved-Fall evtl. leer).
  const cardNumBase  = displayCard.number ? displayCard.number.split('/')[0].padStart(3, '0') : null;
  const cardNumTotal = setMeta?.printedTotal ? String(setMeta.printedTotal).padStart(3, '0') : null;
  const cardDex = displayCard.nationalDexNumber != null ? `#${String(displayCard.nationalDexNumber).padStart(3, '0')}` : null;
  const showLogo = !!setMeta?.logoUrl && !logoFailed;
  // Sets vor Scarlet & Violet tragen KEINEN echten Kürzel-Aufdruck auf der Karte —
  // nur ein grafisches Symbol. `setCode` ist dort nur ein internes pokemontcg.io-
  // Kürzel (z.B. "BS", "JU"), niemals als vermeintlicher Kartendruck anzeigen.
  const isSymbolOnlySet = !!displayCard.series && SYMBOL_ONLY_SERIES.includes(displayCard.series);
  // sizeBasePx: die berechnete Kartenbreite (fittedSize, s.o.) — Basis für
  // Logo/Text-Größen darunter, damit die proportional mitskalieren.
  const sizeBasePx = fittedSize?.w ?? null;
  const logoHeight = sizeBasePx != null ? `${sizeBasePx * 0.15}px` : '40px';

  // Griff: Info-/Add-Panel einklappen — dieselbe Mechanik wie die Filter-Panels
  // (useGrabberCollapse): der Griff folgt dem Finger und snappt beim Loslassen.
  // Eine Region (die Add-Sektion), ohne Scroll-Trigger (fixes Overlay), mit
  // invertierter Zieh-Richtung (Griff oben an einem Bottom-Panel → runter = zu).
  const { stage, registerRegion, regionStyle, grabberProps } = useGrabberCollapse({
    regionCount: 1, ready: true, scrollTrigger: false, invertDrag: true,
    // Eingebetteter Einzelkarten-View (Mehrfachscan) startet zusammengeklappt —
    // die Karte steht groß im Fokus, das Info-/Add-Panel klappt der Nutzer bei Bedarf auf.
    initialStage: embedded ? 1 : 0,
  });

  // Vom RecognizedAddBar gemeldete Varianten-Auswahl — steuert den Holo-/
  // Reverse-Glanz auf dem großen Kartenbild (holo = Artwork, reverse = Rahmen).
  const [shimmerVariant, setShimmerVariant] = useState<CardVariant | null>(
    job.editedVariant ?? job.result?.variant ?? null,
  );
  // Im eingebetteten Swipe-View bleibt dieselbe Instanz erhalten (kein Remount
  // pro Karte, um Größen-Neumessung/Flackern zu vermeiden) — daher den Glanz
  // beim Kartenwechsel explizit auf die neue Karte synchronisieren.
  useEffect(() => {
    setShimmerVariant(job.editedVariant ?? job.result?.variant ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  return (
    <div
      className={part === 'panel'
        ? 'relative w-full'
        : `absolute z-10 flex flex-col items-center px-4 gap-3 ${embedded ? 'inset-0' : 'inset-x-0'}`}
      style={part === 'panel' || embedded ? undefined : {
        top: 'calc(env(safe-area-inset-top, 0px) + 64px)',
        // Overlay-Panel dockt unten an; näher an die Footer-Leiste gerückt
        // (nutzt den freien Platz über dem Scan-FAB). Nur so viel Abstand, dass
        // das Panel knapp über der schwebenden Glas-Toolbar (bottom 14 + 64)
        // endet.
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
      }}
    >
      {/* Karten-Body — die Slot-Zelle (flex-1/min-h-0) füllt per nativer
          Flexbox-Berechnung exakt den verbleibenden Platz in der Spalte (statt
          eine Höhe per vh/dvh zu schätzen). fittedSize berechnet daraus per
          object-fit:contain-Mathematik eine explizite Breite/Höhe für die
          Karten-Box — UNABHÄNGIG vom Bildinhalt (vorher: aspect-ratio +
          max-width/max-height ohne explizite Größe, das die Box anhand des
          *Bildes* auf Inhaltsgröße schrumpfen ließ — brach zusammen, wenn das
          Bild nicht lud). Varianten-/Zustand-Auswahl passiert nicht mehr hier,
          sondern beim Hinzufügen im AddToCollectionModal. */}
      {part !== 'panel' && (
      <div ref={slotRef} className="absolute inset-0 z-0 flex items-start justify-center">
      <div
        ref={containerRef}
        data-scan-card
        className="relative overflow-hidden"
        style={{
          width: fittedSize?.w,
          height: fittedSize?.h,
          // Fester px-Wert statt % — bei % skaliert die Ecke elliptisch (Breite
          // und Höhe getrennt), auf einer Hochformat-Karte sieht die Rundung
          // dadurch oben/unten anders aus als links/rechts. Ein px-Wert relativ
          // zur Breite ergibt eine gleichmäßige, kreisrunde Ecke wie im Original.
          borderRadius: sizeBasePx != null ? `${sizeBasePx * 0.07}px` : '7%',
          border: cardBorder,
          boxShadow: cardGlow,
          // Im eingebetteten Stapel KEIN dunkler Box-Hintergrund — sonst blitzt
          // beim (Neu-)Laden des Katalogbildes kurz eine „schwarze Karte" auf.
          // Transparent lässt so lange die Karte dahinter/den Grund durch.
          background: embedded ? 'transparent' : '#1a1a1a',
          cursor: card ? 'pointer' : 'default',
        }}
        onClick={card ? onCardTap : undefined}
      >
        {processingBorder && job.captureLevel !== 'green' && job.captureReason && (
          <div
            className="absolute top-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full text-xs font-semibold text-white"
            style={{ background: `${capColor[job.captureLevel!]}e6` }}
          >
            {job.captureReason}
          </div>
        )}
        {img ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={img}
            src={img}
            alt={card?.name ?? ''}
            className="w-full h-full object-fill"
            onLoad={e => {
              const el = e.currentTarget;
              if (el.naturalWidth && el.naturalHeight) setImgAspect(el.naturalWidth / el.naturalHeight);
            }}
            // Kandidat 404/Ladefehler → nächsten Kandidaten aus imgCandidates
            // probieren (siehe cardImgUrlsLarge oben), statt das native
            // "kaputtes Bild"-Icon zu zeigen.
            onError={() => setImgIdx(i => i + 1)}
          />
        ) : card?.pendingCatalog ? (
          /* Vorläufige (nicht katalogisierte) Karte: generische Platzhalter-
             Optik mit den erkannten Werten statt Warn-Icon. */
          <CardPlaceholder
            info={{
              name: card.name,
              hp: card.hp,
              number: card.number,
              total: card.printedTotal,
              dexNumber: card.nationalDexNumber,
              setCode: card.setCode,
              pending: true,
            }}
            className="w-full h-full"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-red-500/10">
            <AlertCircle size={28} color="#f87171" />
          </div>
        )}

        {/* Holo-/Reverse-Glanz nach aktueller Varianten-Auswahl im
            RecognizedAddBar (holo = Artwork, reverse = Rahmen) — reaktiv, damit
            das Umstellen der Variante sofort am großen Kartenbild sichtbar ist. */}
        {img && (shimmerVariant === 'holo' || shimmerVariant === 'reverse') && (
          <div
            className={`absolute inset-0 ${holoShimmerClass(shimmerVariant as 'holo' | 'reverse', card?.rarity)}`}
            aria-hidden="true"
          />
        )}

        {/* ×N-Besitz-Hinweis beim Scannen bereits ab EINEM Exemplar — der Sinn
            ist „diese Karte hast du schon", damit man Dubletten sofort erkennt
            (anders als auf den Sammlungs-Kacheln, wo ×1 nur Rauschen wäre).
            Nutzt die App-Badge-Komponente (CardBadge, Ecken-Variante). */}
        {ownedCount != null && ownedCount > 0 && (
          <CardBadge
            size={Math.max(40, Math.round((sizeBasePx ?? 220) * 0.2))}
            shape="pill"
            color="rgba(53,209,90,.95)"
            corner="tr"
            cornerRadius={sizeBasePx != null ? sizeBasePx * 0.07 : 12}
            style={{ top: 0, right: 0 }}
            ariaLabel={`${ownedCount}× in Sammlung`}
          >
            ×{ownedCount}
          </CardBadge>
        )}
      </div>
      </div>
      )}

      {/* Info-/Add-Overlay: liegt als getöntes Glas ÜBER der groß angezeigten
          Karte (unten angedockt), statt darunter im Fluss. Die Karte füllt
          dahinter die ganze Fläche (Slot absolute inset-0). Feste rgba()-Werte
          identisch zur Dark-Variante der globalen .glass-Klasse — der Scanner
          liegt immer über dem (dunklen) Kamerabild. */}
      {part !== 'image' && (
      <div
        className={part === 'panel'
          ? 'w-full z-10 px-4 flex flex-col gap-3'
          : 'absolute inset-x-0 bottom-0 z-10 px-4 flex flex-col gap-3'}
        data-scan-interactive
      >
      {displayCard && (
        <div
          className="relative w-full flex flex-col items-start gap-2 px-4 py-4 rounded-[24px] glass-overlay"
          // Dunkle Basis (überschreibt die helle .glass-overlay-Tönung) mit
          // Verlauf — oben am kräftigsten, da dort die großen Texte (Set/Name/
          // Preis) über der Karte liegen. Sonst scheinen helle Karten (z.B.
          // gelbe Elektro-Commons) durchs Glas und der weiße Text wird
          // unlesbar. Blur/Border/Schatten kommen weiter aus .glass-overlay.
          style={{ background: 'linear-gradient(to bottom, rgba(10,12,18,0.86) 0%, rgba(10,12,18,0.64) 48%, rgba(10,12,18,0.56) 100%)' }}
        >
          {/* Griff: Info-Panel einklappen (mehr Karte sichtbar) — im Korrektur-
              Overlay identisch zum Einzelscan. */}
          <Grabber
            expanded={stage === 0}
            barClassName="bg-white/40"
            padClassName="py-[13px] -my-1"
            className="w-full -mt-1"
            {...grabberProps}
          />

          {/* Logo + Zyklus/Setname als ein Block — Logo links, rechts daneben
              Zyklus- und Setname linksbündig in zwei Zeilen übereinander,
              beide zusammen so hoch wie das Logo. */}
          <div className="flex items-center justify-start gap-2.5 max-w-full">
            {showLogo ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={setMeta!.logoUrl}
                alt={setCode ?? ''}
                className="object-contain shrink-0"
                style={{ height: logoHeight, maxWidth: '40%' }}
                onError={() => setLogoFailed(true)}
              />
            ) : setMeta?.symbolUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={setMeta.symbolUrl}
                alt={setCode ?? ''}
                className="object-contain shrink-0"
                style={{ height: logoHeight, width: logoHeight }}
              />
            ) : (
              // Kürzel-Text nur als allerletzter Fallback, und nur wenn er echt
              // aufgedruckt sein könnte (S&V-Ära) — alte Sets zeigen sonst nichts,
              // statt ein erfundenes Kürzel wie ein Kartendruck aussehen zu lassen.
              !isSymbolOnlySet && setCode && (
                <span className="font-mono font-bold text-white/90" style={{ fontSize: `calc(${logoHeight} * 0.5)` }}>
                  {setCode}
                </span>
              )
            )}
            <div
              className="flex flex-col justify-center items-start min-w-0 text-white/90"
              style={{
                height: logoHeight,
                fontSize: `calc(${logoHeight} * 0.3 - 1px)`,
                lineHeight: 1.25,
                gap: 'calc(0.15em - 1px)',
                transform: 'translateY(-2px)',
              }}
            >
              {seriesDe && <span className="truncate max-w-full text-left font-bold">{seriesDe}</span>}
              <span className="truncate max-w-full text-left" style={{ fontSize: 'calc(1em - 1px)' }}>
                {setMeta?.nameDe ?? displayCard.setName}
              </span>
            </div>
          </div>

          <h2
            className="text-white font-bold text-3xl truncate text-left max-w-full"
            style={{ textShadow: '0 2px 12px rgba(0,0,0,0.3)' }}
          >
            <CardNameLabel card={displayCard} secondaryClassName="text-[0.6em] font-semibold text-white/70" />
          </h2>
          {/* Nummer/Dex links, Preis rechts — eine Zeile, wie im Handoff-
              Referenzbild (design_handoff_scanner_glass, Info-Sheet). */}
          <div className="w-full flex items-baseline justify-between gap-2 -mt-1.5">
            {(cardNumBase || cardDex) && (
              <div className="flex items-baseline gap-2 font-mono tabular-nums">
                {cardNumBase && (
                  <span className="text-white text-sm font-bold">
                    {cardNumBase}{cardNumTotal && <span className="text-white/60 font-normal">/{cardNumTotal}</span>}
                  </span>
                )}
                {cardDex && (
                  <span className="text-white/60 text-sm">{cardDex}</span>
                )}
              </div>
            )}
            {/* Preis nur bei echter Katalog-Karte — nicht bei Pending/unresolved. */}
            {card && (
              <CardPrice
                tcgId={card.id}
                variant={shimmerVariant ?? undefined}
                plain
                fontSize={44}
                className="[text-shadow:0_2px_12px_rgba(0,0,0,.25)] ml-auto"
              />
            )}
          </div>

          {/* Inline-Leiste unter der erkannten Karte — im Mehrfachscan-Slider/Grid
              (correctionOnly) wird der breite „Hinzufügen"-Button zum gelben
              „Korrigieren"-Button; Layout/Höhe bleiben identisch zum Einzelscan
              (Hinzufügen/Löschen passiert dort gebündelt im Review-Grid). */}
          <RecognizedAddBar
            card={displayCard}
            unresolved={unresolved}
            correctionOnly={correctionOnly}
            preVariant={job.editedVariant ?? job.result?.variant}
            preCondition={job.editedCondition}
            preLanguage={job.editedLanguage ?? job.result?.language}
            ownedCount={ownedCount ?? 0}
            onSaved={onSaved}
            onManage={onManage}
            regionStyle={regionStyle(0)}
            regionRef={registerRegion(0)}
            onVariantChange={(v) => { setShimmerVariant(v); onEditVariant?.(v); }}
            onConditionChange={onEditCondition}
            onLanguageChange={onEditLanguage}
            onCorrectTap={() => setCorrecting(true)}
          />

          {/* Korrektur-Panel (B2): gleitet über das Info-Sheet, das große
              Kartenbild dahinter bleibt fix. Auswahl korrigiert die Anzeige
              (via onSubmitReport → submitReport tauscht die Karte) + meldet still. */}
          {displayCard && (
            <ScanCorrectionPanel
              open={correcting}
              fullScreen={correctionOnly}
              card={displayCard}
              candidates={job.result?.candidates}
              language={job.result?.language}
              pendingCard={pendingFromScan}
              onClose={() => setCorrecting(false)}
              onPick={(cardId) => { setCorrecting(false); onSubmitReport({ reportType: 'wrong', correctedCardId: cardId }); }}
              onNotInCatalog={() => {
                setCorrecting(false);
                // Pending-Karte baubar → übernehmen (aufnehmbar) + melden; sonst nur melden.
                if (pendingFromScan) onPickNotInCatalog(pendingFromScan);
                else onSubmitReport({ reportType: 'not_in_catalog' });
              }}
            />
          )}
        </div>
      )}

      {/* Mehrdeutige Erkennung: mehrere Karten passen gleich gut (z.B. gleicher
          Name+Nummer in zwei Sets). Statt still den ersten zu nehmen, die
          Kandidaten zur Auswahl zeigen — Tippen setzt die aktive Karte. */}
      {card && (job.result?.candidates?.length ?? 0) > 1 && (
        <div className="w-full flex flex-col gap-2 px-4 py-3 rounded-[24px] glass-overlay" style={{ background: 'rgba(10,12,18,0.72)' }}>
          <div className="flex items-center gap-2 text-white/90 text-sm font-semibold">
            <AlertTriangle size={15} color="#fbbf24" />
            Mehrdeutig — welche Karte?
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {job.result!.candidates!.map(cand => {
              const selected = cand.id === card.id;
              return (
                <CardTileButton
                  key={cand.id}
                  selected={selected}
                  accent="#35d15a"
                  borderWidth={2}
                  onClick={() => onPickCandidate(cand)}
                  className="flex flex-col items-center gap-1 rounded-lg p-1"
                  aria-label={`${cand.name} ${cand.setCode ?? cand.setId} ${cand.number}`}
                >
                  <CardImage
                    card={cand}
                    size="small"
                    language={job.result?.language}
                    alt={cand.name}
                    width={64}
                    height={89}
                    className="w-16 rounded object-contain"
                  />
                  <span className="text-white/80 text-[10px] font-mono tabular-nums">
                    {(cand.setCode ?? cand.setId?.toUpperCase() ?? '?')} {cand.number}
                  </span>
                </CardTileButton>
              );
            })}
          </div>
        </div>
      )}
      </div>
      )}

    </div>
  );
}
