import { Pin } from 'lucide-react';
import { CardBadge } from '@/components/card/CardBadge';
import { COVER_TL_RADIUS } from '@/components/binder/BinderCover';
import { DEFAULT_CARD_VISUAL_THEME } from '@/lib/ui/card-theme';
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

/** Radius der abgerundeten (rechten unteren) Ecke der KARTEN-Badges — Grid-
 *  Karten laufen mit `size="md"` → Karten-/Badge-Radius 10 (card-theme.ts). Die
 *  Sammlungs-Badges übernehmen genau diesen Wert für ihre rechte untere Ecke. */
const CARD_BADGE_BR_RADIUS = DEFAULT_CARD_VISUAL_THEME.cornerRadius.md;

/** Wie {@link CollectionTypeBadge}, aber in der „Karten-Ecke"-Form: ein
 *  `CardBadge`, das BÜNDIG (ohne Abstand) in die obere linke Ecke von Ordner
 *  bzw. Box eingenistet ist — analog zu den Badges auf den Karten-Kacheln.
 *  Eckenrundung:
 *   - oben links = Radius der jeweiligen Kachelecke (`COVER_TL_RADIUS`, Ordner/
 *     Box), damit die Außenkurve konzentrisch in der Kachelecke liegt,
 *   - unten rechts = Radius der Karten-Badges (`CARD_BADGE_BR_RADIUS`),
 *   - oben rechts / unten links = keine Rundung.
 *  Positioniert sich selbst (`absolute`), gehört in einen `relative`-Wrapper. */
export function CollectionTypeCornerBadge({
  binder, shape = 'folder', size = 28,
}: { binder: BinderDoc; shape?: 'folder' | 'box'; size?: number }) {
  const common = {
    corner: 'tl' as const,
    size,
    style: {
      top: 0, left: 0,
      borderTopLeftRadius: COVER_TL_RADIUS[shape],
      borderBottomRightRadius: CARD_BADGE_BR_RADIUS,
      borderTopRightRadius: 0,
      borderBottomLeftRadius: 0,
    },
  };
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
