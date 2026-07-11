import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Negativer animation-delay (0 bis -0.24s) aus einem stabilen Schlüssel
 *  (Binder-ID, Sheet-/Slot-Key, …) abgeleitet — damit gleichzeitig wackelnde
 *  Kacheln (`binder-wiggle`-Keyframe) nicht synchron takten, sondern wie am
 *  iOS-Homescreen leicht phasenversetzt wirken. App-weit dieselbe Formel,
 *  damit das Wackeln überall gleich aussieht (Sammlungsübersicht,
 *  Sammlungsdetail-Blätter/-Karten, …). */
export function wiggleDelay(key: string): number {
  const sum = Array.from(key).reduce((s, ch) => s + ch.charCodeAt(0), 0);
  return -((sum % 25) / 100);
}
