'use client';

import { Button } from '@/components/ui/button';

/**
 * Einheitlicher Fehler-/Retry-Zustand für fehlgeschlagene Daten-Reads. Ersetzt
 * das bisherige „stille Leere / Dauerspinner bei Fehler"-Muster: ein Ladefehler
 * ist so klar von „wirklich leer" unterscheidbar und der Nutzer kann erneut
 * laden, statt festzuhängen.
 */
export function ErrorRetry({ onRetry, message = 'Daten konnten nicht geladen werden.' }: {
  onRetry: () => void;
  message?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center">
      <p className="text-role-body text-glass-muted max-w-xs">{message}</p>
      <Button variant="secondary" onClick={onRetry}>Erneut versuchen</Button>
    </div>
  );
}
