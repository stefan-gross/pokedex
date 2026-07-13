import { Pin } from 'lucide-react';
import type { BinderDoc } from '@/types';

/** „A"-Badge für automatische Vorlagen-Sammlungen — als eigener Baustein
 *  exportiert, damit Stellen ohne vollständiges `BinderDoc` (z.B. eine
 *  Karten-Vorschauzeile im Mehrfachscan) ihn ohne Fake-Objekt verwenden
 *  können. */
export function AutomaticBadge({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 18 : 24;
  return (
    <span
      aria-label="Automatische Sammlung"
      title="Automatische Sammlung"
      className="inline-flex items-center justify-center rounded-full font-bold text-white shrink-0"
      style={{ width: dim, height: dim, fontSize: dim * 0.6, background: 'var(--pokedex-blue)' }}
    >
      A
    </span>
  );
}

/** Pin-Badge für feste System-Sammlungen (Eingang/Meine Sammlung). */
export function SystemBadge({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 18 : 24;
  return (
    <span
      aria-label="Feste Sammlung"
      title="Feste Sammlung"
      className="inline-flex items-center justify-center rounded-full text-white shrink-0"
      style={{ width: dim, height: dim, background: 'rgba(0,0,0,.45)' }}
    >
      <Pin size={dim * 0.6} strokeWidth={2.5} />
    </span>
  );
}

/** Kleines Badge, das den Sammlungstyp eines konkreten Binders anzeigt: „A"
 *  für automatische Vorlagen-Sammlungen (`template` gesetzt), Pin für feste
 *  System-Sammlungen (`isInbox`/`isDefault`). Normale, manuell gepflegte
 *  Sammlungen bekommen kein Badge — das ist der unauffällige Standardfall. */
export function CollectionTypeBadge({ binder, size = 'md' }: { binder: BinderDoc; size?: 'sm' | 'md' }) {
  if (binder.template) return <AutomaticBadge size={size} />;
  if (binder.isDefault || binder.isInbox) return <SystemBadge size={size} />;
  return null;
}
