/**
 * Ton- und Haptik-Rückmeldung beim Scannen (Mehrfach- wie Einzelscan):
 *  - Auslösen (Foto)      → knackiger Kamera-Auslöser-Klick ("ka-tschk").
 *  - Erfolg (erkannt)     → klares, aufsteigendes „Bing" (zwei Noten).
 *  - Fehler (nicht erkannt)→ tiefer, dumpfer „Buzz".
 *
 * Bewusst per Web Audio SYNTHETISIERT statt MP3-Dateien: keine Assets/Netz,
 * offline-tauglich, minimal. iOS verlangt, dass der AudioContext EINMAL in einer
 * User-Geste „entsperrt" wird (siehe `unlockScanSound`, beim ersten Tap).
 *
 * WICHTIG (iOS): Web-Audio wird bei aktiviertem KLINGEL-/STUMM-Schalter am iPhone
 * NICHT ausgegeben — dann hört man trotz allem nichts. Und iOS-Safari besitzt
 * KEINE Vibrations-API (`navigator.vibrate` ist dort undefined) → Haptik gibt es
 * nur auf Android. Beides ist eine Plattform-Grenze, nicht abstellbar im Web.
 *
 * Stummschalten (App-intern) per localStorage-Flag `pokedex.scan.sound` = 'off'.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Innerhalb einer User-Geste aufrufen (erster Tap) — entsperrt den AudioContext
 *  auf iOS, damit spätere (auch geste-lose Auto-Scan-)Töne abspielen dürfen. */
export function unlockScanSound(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

export function scanSoundEnabled(): boolean {
  try { return localStorage.getItem('pokedex.scan.sound') !== 'off'; } catch { return true; }
}

export function setScanSoundEnabled(on: boolean): void {
  try { localStorage.setItem('pokedex.scan.sound', on ? 'on' : 'off'); } catch { /* ignore */ }
}

/** Ein Ton mit Frequenz-Glide + weicher Hüllkurve (kein Knacken). */
function tone(
  c: AudioContext,
  { start, freqFrom, freqTo, dur, type = 'sine', gain = 0.25 }:
  { start: number; freqFrom: number; freqTo: number; dur: number; type?: OscillatorType; gain?: number },
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqFrom, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Kurzer, perkussiver Rausch-„Klick" (für den mechanischen Kamera-Auslöser). */
function click(
  c: AudioContext,
  { start, dur, gain, highpass }: { start: number; dur: number; gain: number; highpass: number },
): void {
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n); // abklingendes Rauschen
  const src = c.createBufferSource();
  src.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = highpass;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(hp).connect(g).connect(c.destination);
  src.start(start);
  src.stop(start + dur + 0.02);
}

/** Kamera-Auslöser-Klick SOFORT beim Auslösen — nachempfunden einem mechanischen
 *  Spiegelreflex-Verschluss: heller Anschlag (Spiegel hoch) + tiefer „Thunk"
 *  (mechanisches Gewicht) und kurz darauf der dumpfere „Klack" (Verschluss zu). */
export function playScanCaptureSound(): void {
  if (!scanSoundEnabled()) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') { c.resume().catch(() => {}); }
  try {
    const now = c.currentTime + 0.004;
    // Phase 1 — „Klick" (Spiegel hoch): sehr kurzer, heller Anschlag …
    click(c, { start: now,         dur: 0.012, gain: 0.6,  highpass: 2600 });
    // … mit tiefem, kurzem „Thunk" darunter (mechanisches Gewicht).
    tone(c,  { start: now,         freqFrom: 190, freqTo: 85, dur: 0.05,  type: 'sine', gain: 0.34 });
    // Phase 2 — „Klack" (Verschluss zu): etwas später, tiefer, minimal länger.
    click(c, { start: now + 0.062, dur: 0.03,  gain: 0.5,  highpass: 1100 });
    tone(c,  { start: now + 0.062, freqFrom: 150, freqTo: 70, dur: 0.045, type: 'sine', gain: 0.26 });
  } catch { /* ignore */ }
}

/** Erfolg-/Fehler-Ton nach der Erkennung. */
export function playScanSound(success: boolean): void {
  if (!scanSoundEnabled()) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') { c.resume().catch(() => {}); }
  try {
    const now = c.currentTime + 0.01;
    if (success) {
      // „Bing": zwei klare, aufsteigende Noten (A5 → E6).
      tone(c, { start: now,        freqFrom: 880,  freqTo: 900,  dur: 0.10, type: 'sine', gain: 0.28 });
      tone(c, { start: now + 0.10, freqFrom: 1318, freqTo: 1340, dur: 0.16, type: 'sine', gain: 0.30 });
    } else {
      // Dumpfer, absteigender Buzz (rau + tief).
      tone(c, { start: now,        freqFrom: 300,  freqTo: 130,  dur: 0.30, type: 'sawtooth', gain: 0.26 });
    }
  } catch { /* ignore */ }
}

/** Haptisches Feedback (nur wo unterstützt). Android hat `navigator.vibrate`,
 *  iOS-Safari NICHT → dort still no-op. `kind` steuert das Muster. */
export function scanHaptic(kind: 'trigger' | 'success' | 'error'): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (kind === 'trigger') navigator.vibrate(20);
    else if (kind === 'success') navigator.vibrate(35);
    else navigator.vibrate([0, 45, 60, 45]); // Fehler: doppelter Puls
  } catch { /* nicht unterstützt */ }
}
