/**
 * Ton- und Haptik-Rückmeldung beim Scannen (Mehrfach- wie Einzelscan) — jetzt
 * über echte MP3-Dateien (public/sounds/):
 *  - Auslösen (Foto)       → shutter.mp3  (Kamera-Verschluss).
 *  - Erfolg (erkannt)      → success.mp3  (helles, hohes „Bing").
 *  - Fehler (nicht erkannt)→ error.mp3    (tiefer, dumpfer „Buzz").
 *
 * iOS: HTML5-Audio muss EINMAL in einer User-Geste „entsperrt" werden — das macht
 * `unlockScanSound` (beim ersten Tap) durch stummes Anspielen aller Clips, damit
 * auch die späteren (geste-losen) Erfolg-/Fehlertöne abspielen dürfen.
 *
 * WICHTIG (iOS): Bei aktiviertem KLINGEL-/STUMM-Schalter am iPhone gibt iOS AUCH
 * MP3-/Web-Audio NICHT aus — dann hört man trotz allem nichts. Und iOS-Safari hat
 * KEINE Vibrations-API → Haptik nur auf Android. Plattform-Grenzen, nicht im Web
 * abstellbar. App-internes Stummschalten: localStorage `pokedex.scan.sound`='off'.
 */

const FILES = { shutter: '/sounds/shutter.mp3', success: '/sounds/success.mp3', error: '/sounds/error.mp3' } as const;
type Clip = keyof typeof FILES;

const els: Partial<Record<Clip, HTMLAudioElement>> = {};

function el(name: Clip): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!els[name]) {
    try {
      const a = new Audio(FILES[name]);
      a.preload = 'auto';
      els[name] = a;
    } catch { return null; }
  }
  return els[name] ?? null;
}

export function scanSoundEnabled(): boolean {
  try { return localStorage.getItem('pokedex.scan.sound') !== 'off'; } catch { return true; }
}

export function setScanSoundEnabled(on: boolean): void {
  try { localStorage.setItem('pokedex.scan.sound', on ? 'on' : 'off'); } catch { /* ignore */ }
}

/** In einer User-Geste (erster Tap) aufrufen — „entsperrt" die Audio-Clips auf iOS
 *  (stummes Anspielen + zurücksetzen), damit spätere geste-lose Töne spielen. */
export function unlockScanSound(): void {
  (Object.keys(FILES) as Clip[]).forEach(name => {
    const a = el(name);
    if (!a) return;
    try {
      a.muted = true;
      const p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
      } else {
        a.pause(); a.currentTime = 0; a.muted = false;
      }
    } catch { a.muted = false; }
  });
}

function play(name: Clip, volume = 1): void {
  if (!scanSoundEnabled()) return;
  const a = el(name);
  if (!a) return;
  try {
    a.currentTime = 0;
    a.volume = volume;
    a.play().catch(() => { /* iOS: nicht entsperrt / stummgeschaltet */ });
  } catch { /* ignore */ }
}

/** Kamera-Verschluss-Klick SOFORT beim Auslösen. */
export function playScanCaptureSound(): void {
  play('shutter', 1);
}

/** Erfolg-„Bing" / Fehler-„Buzz" nach der Erkennung. */
export function playScanSound(success: boolean): void {
  play(success ? 'success' : 'error', 0.9);
}

/** Haptisches Feedback (nur wo unterstützt). Android hat `navigator.vibrate`,
 *  iOS-Safari NICHT → dort still no-op. */
export function scanHaptic(kind: 'trigger' | 'success' | 'error'): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (kind === 'trigger') navigator.vibrate(20);
    else if (kind === 'success') navigator.vibrate(35);
    else navigator.vibrate([0, 45, 60, 45]);
  } catch { /* nicht unterstützt */ }
}
