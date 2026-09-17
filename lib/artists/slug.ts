/** URL-/Firestore-Doc-ID-sicherer Slug aus einem Illustrator-Namen. Der Klartext-
 *  Name wird zusätzlich im Profil-Doc gespeichert (der Slug ist nicht immer
 *  eindeutig rückübersetzbar). Firestore verbietet in Doc-IDs u.a. `/` und `.`. */
export function artistSlug(name: string): string {
  const s = name.trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[/#?.\\[\]]/g, '_')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 200);
  return s || 'unbekannt';
}
