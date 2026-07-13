import type { BinderDoc } from '@/types';
import type { CatalogCard } from '@/lib/firestore/catalog';

/** Günstige In-Memory-Prüfung (kein Firestore-Query): welche Vorlagen-
 *  Binder würden eine gerade hinzugefügte Katalog-Karte akzeptieren? Wird
 *  zweifach genutzt: (1) als Hinweis-UI direkt nach dem Hinzufügen
 *  ("Passt auch in: …"), (2) um `syncTemplateBinders({ binderIds })` an
 *  den Mutations-Aufrufstellen auf die potenziell betroffenen Binder
 *  einzugrenzen, statt bei jeder einzelnen Karten-Aktion alle Vorlagen-
 *  Binder neu zu berechnen. */
export function matchTemplateBinders(
  catalogCard: Pick<CatalogCard, 'artist' | 'nationalDexNumber' | 'setId'>,
  templateBinders: BinderDoc[],
): BinderDoc[] {
  return templateBinders.filter(b => {
    const t = b.template;
    if (!t) return false;
    switch (t.type) {
      case 'artist':          return catalogCard.artist === t.artist;
      case 'pokedex':          return catalogCard.nationalDexNumber != null;
      case 'evolutionFamily':  return catalogCard.nationalDexNumber != null
        && t.familyDexNumbers.includes(catalogCard.nationalDexNumber);
      case 'masterSet':        return catalogCard.setId === t.setId;
      default:                 return false;
    }
  });
}
