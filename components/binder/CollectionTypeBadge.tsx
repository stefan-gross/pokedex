import { Pin } from 'lucide-react';
import { CardBadge } from '@/components/card/CardBadge';
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

/** Pin-Badge für die feste System-Sammlung „Unsortiert". */
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
 *  für automatische Vorlagen-Sammlungen (`template` gesetzt), Pin für die feste
 *  System-Sammlung „Unsortiert" (`isDefault`). Normale, manuell gepflegte
 *  Sammlungen bekommen kein Badge — das ist der unauffällige Standardfall. */
export function CollectionTypeBadge({ binder, size = 'md' }: { binder: BinderDoc; size?: 'sm' | 'md' }) {
  if (binder.template) return <AutomaticBadge size={size} />;
  if (binder.isDefault) return <SystemBadge size={size} />;
  return null;
}

/** Wie {@link CollectionTypeBadge}, aber in der „Karten-Ecke"-Form: ein
 *  `CardBadge` mit `corner="tl"`, das oben links flach in die Sammlungs-Kachel
 *  eingenistet ist — gleiche Position/Form wie die Badges auf den
 *  Karten-Kacheln (statt eines aus der Ecke ragenden Kreises). Positioniert
 *  sich selbst (`absolute` via `top`/`left`), gehört in einen `relative`-Wrapper. */
export function CollectionTypeCornerBadge({
  binder, size = 28, cornerRadius = 5, offset = 3,
}: { binder: BinderDoc; size?: number; cornerRadius?: number; offset?: number }) {
  const common = { corner: 'tl' as const, cornerRadius, size, style: { top: offset, left: offset } };
  if (binder.template) {
    return (
      <CardBadge {...common} color="var(--pokedex-blue)" ariaLabel="Automatische Sammlung" title="Automatische Sammlung">
        A
      </CardBadge>
    );
  }
  if (binder.isDefault) {
    return (
      <CardBadge {...common} color="rgba(0,0,0,.55)" ariaLabel="Feste Sammlung" title="Feste Sammlung">
        <Pin size={size * 0.5} strokeWidth={2.5} />
      </CardBadge>
    );
  }
  return null;
}
