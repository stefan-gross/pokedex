'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { Sheet } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

/** Cardmarket-Wants-Übersicht (deutschsprachige Oberfläche). Von hier wählt der
 *  Nutzer seine Liste und öffnet dort „Deck-Liste hinzufügen", um den kopierten
 *  Text einzufügen. Eine direkte Verlinkung auf die Deck-Listen-Seite ist nicht
 *  möglich, da sie die (uns unbekannte) Cardmarket-Listen-ID enthält. */
const CARDMARKET_WANTS_URL = 'https://www.cardmarket.com/de/Pokemon/Wants';

/**
 * Export einer Wunschliste als Cardmarket-„Deck-Liste".
 *
 * Cardmarket bietet (auch für Pokémon) unter Wants → eigene Liste →
 * „Deck-Liste hinzufügen" ein Textarea-Feld: **eine Karte pro Zeile**, optional
 * mit vorangestellter Anzahl. Es gibt KEINEN offiziellen CSV-/Datei-Import und
 * — mangels neuer API-Zugänge — keinen automatischen Weg. Dieser Sheet erzeugt
 * den passenden Text (englische Kartennamen = beste Trefferquote auf
 * Cardmarket), lässt ihn vor dem Kopieren bei Bedarf editieren und verlinkt zur
 * Wants-Übersicht.
 */
export function CardmarketExportSheet({
  open, onClose, initialText, count,
}: {
  open: boolean;
  onClose: () => void;
  initialText: string;
  count: number;
}) {
  const [text, setText] = useState(initialText);
  const [copied, setCopied] = useState(false);

  // NUR beim Öffnen (steigende Flanke) neu befüllen — sonst überschreibt ein
  // spät aufgelöster Katalog-Read (`initialText` ändert sich, weil Namen von
  // Item-Name auf nameDe wechseln) die manuellen Edits, während das Sheet offen
  // ist (dokumentierter Use-Case: Zeilen löschen). `initialText` bleibt Dep,
  // die Flanken-Guard verhindert das Re-Seeden.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) { setText(initialText); setCopied(false); }
    wasOpen.current = open;
  }, [open, initialText]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: Clipboard-API nicht verfügbar (z.B. kein HTTPS) — der Nutzer
      // markiert den Text im Feld selbst; hier nichts weiter zu tun.
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Für Cardmarket exportieren">
      <div className="space-y-4">
        <ol className="text-role-body text-glass-muted list-decimal pl-5 space-y-1">
          <li>Text kopieren (unten).</li>
          <li>Cardmarket-Wants öffnen und deine Liste wählen.</li>
          <li>Dort „Deck-Liste hinzufügen" → Text einfügen → hinzufügen.</li>
        </ol>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          spellCheck={false}
          rows={Math.min(14, Math.max(4, count + 1))}
          className="w-full rounded-xl glass-inner-clear p-3 text-role-body font-mono text-[13px] leading-relaxed resize-y outline-none"
          aria-label="Cardmarket Deck-Liste"
        />
        <p className="text-role-label text-glass-muted -mt-2">
          Eine Karte pro Zeile: Anzahl + deutscher Name + Set in Klammern (macht
          die Karte eindeutig). Vor dem Kopieren editierbar — z.B. Zeilen
          entfernen, die du nicht kaufen willst.
        </p>

        <div className="flex gap-2">
          <Button
            variant="primary"
            icon={copied ? <Check /> : <Copy />}
            onClick={copy}
            disabled={!text.trim()}
            className="flex-1"
          >
            {copied ? 'Kopiert' : 'Kopieren'}
          </Button>
          <Button
            variant="secondary"
            icon={<ExternalLink />}
            onClick={() => window.open(CARDMARKET_WANTS_URL, '_blank', 'noopener,noreferrer')}
            className="flex-1"
          >
            Cardmarket Wants
          </Button>
        </div>

        <p className="text-role-label text-glass-muted">
          Hinweis: Cardmarket ordnet über Name + Set zu. Findet es eine Zeile
          nicht, den Namen dort kurz anpassen (Cardmarket-Schreibweise).
        </p>
      </div>
    </Sheet>
  );
}
