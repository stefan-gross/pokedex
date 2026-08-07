'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { cardInfoToAddInput, type CardInfo } from '@/lib/card-info';
import type { CardCondition, CardLanguage, CardVariant, CardDoc, BinderDoc } from '@/types';
import { addCard, getCardsByTcgId } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, ensureDefaultBinder } from '@/lib/firestore/binders';
import { LANGUAGES, CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';
import { CardPrice } from '@/components/card/CardPrice';
import { BinderIcon } from '@/lib/binder-icons';
import { useSetMeta } from '@/lib/hooks/use-set-meta';
import { CardNameLabel } from '@/components/card/CardNameLabel';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/modal';
import { CustomSelect } from '@/components/ui/select';

const CONDITION_COLOR: Record<string, string> = {
  NM: '#48bb78', LP: '#facc15', MP: '#fb923c', HP: '#f87171', Poor: '#9ca3af',
};

interface Props {
  card: CardInfo;
  preVariant?: CardVariant;
  preCondition?: CardCondition;
  preLanguage?: CardLanguage;
  /** Scanner liegt immer über dem Kamerabild — Drawer dort unabhängig vom
   *  App-Theme immer dunkel darstellen (via erzwungener `.dark`-Klasse). */
  fromScanner?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Ein Hinzufügen-Drawer für die ganze App (Scanner, Suche, Kartendetail) —
 *  Liquid-Glass-Design, folgt dem App-Theme; im Scanner per erzwungener
 *  `.dark`-Klasse immer dunkel (siehe Handoff design_handoff_add_drawer).
 *
 *  Karten-Fluss-Modell: jede neu hinzugefügte Karte landet IMMER in
 *  „Unsortiert" (dem dauerhaften Hub). Es gibt hier bewusst KEINE Sammlungs-
 *  Auswahl — zugeordnet wird danach (Kartendetail: Vorschläge/„Verschieben nach";
 *  manuelle Sammlungen über die Seitenansicht). Automatische Sammlungen greifen
 *  NICHT von selbst zu — sie schlagen nur vor. */
export function AddToCollectionModal({
  card, preVariant, preCondition, preLanguage,
  fromScanner = false,
  onClose, onSaved,
}: Props) {
  const [variant, setVariant] = useState<CardVariant>(preVariant ?? (card.variants?.[0] as CardVariant) ?? 'standard');
  const variantOptions: CardVariant[] = (card.variants && card.variants.length > 0 ? card.variants : ['standard']) as CardVariant[];
  const [condition, setCondition] = useState<CardCondition>(preCondition ?? 'NM');
  const [language, setLanguage] = useState<CardLanguage>(preLanguage ?? 'de');

  // Variante/Sprache kommen aus dem Aufruf-Kontext bereits feststehend (z.B.
  // der "+"-Button einer bestimmten Variantenzeile im Kartendetail, oder
  // erkannt/bestätigt im Scan) — dann nur noch als Pill anzeigen statt als
  // änderbares Dropdown. Ohne `pre*`-Wert (z.B. genereller Suche-Treffer ohne
  // Variantenkontext) bleibt das Feld ein editierbares Dropdown wie bisher.
  const variantKnown = preVariant != null;
  const languageKnown = preLanguage != null;

  // DE-Setname + gedruckte Nummer/Gesamtzahl (z.B. "052/172") — exakt wie bei
  // der gescannten Karte (RecognizedCardLarge), statt der rohen Katalog-Felder.
  const setMeta = useSetMeta(card.setId, undefined, card.setName);
  const cardNumBase = card.number.split('/')[0].padStart(3, '0');
  const cardNumTotal = setMeta?.printedTotal ? String(setMeta.printedTotal).padStart(3, '0') : null;
  const cardNumDisplay = cardNumTotal ? `${cardNumBase}/${cardNumTotal}` : card.number;

  const [allBinders, setAllBinders] = useState<BinderDoc[]>([]);
  const [ownedCopies, setOwnedCopies] = useState<CardDoc[]>([]);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getBinders().then(setAllBinders).catch(() => {});
    getCardsByTcgId(card.id).then(setOwnedCopies).catch(() => {});
  }, [card.id]);

  const save = async () => {
    setSaving(true);
    try {
      // „Prüfen" nur für Scanner-Ergebnisse (KI-Erkennung, kann falsch liegen).
      // Manuelles Hinzufügen aus Suche/Kartendetail ist bewusst gewählt → kein
      // Review-Status. Vorläufige Karten (pendingCatalog) behandelt der Helper.
      const cardId = await addCard(
        cardInfoToAddInput(card, { variant, condition, language, needsReview: fromScanner }),
      );
      // Immer nach „Unsortiert" — von dort ordnet der Nutzer weiter zu (siehe
      // Fluss-Modell im Klassen-Kommentar).
      const unsortedId = await ensureDefaultBinder();
      await addCardToBinder(unsortedId, cardId);
      onSaved();
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dragToClose
      forceDark={fromScanner}
      lockScroll={!fromScanner}
      elevated
      footer={
        <Button
          onClick={save}
          disabled={saving}
          variant="primary"
          accentColor="#2f855a"
          size="lg"
          icon={saving ? undefined : <Plus strokeWidth={2.5} />}
          className="w-full"
        >
          {saving ? 'Wird gespeichert…' : 'Zu Unsortiert'}
        </Button>
      }
    >
          {/* Karten-Zeile */}
          <div className="flex items-center gap-3 pb-[14px] mb-4 border-b border-[rgba(46,46,50,0.1)] dark:border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.imgSmallDe || card.imgSmall}
              alt={card.name}
              className="w-10 h-14 rounded-[3px] object-cover shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold truncate"><CardNameLabel card={card} /></div>
              <div className="text-xs text-muted-foreground truncate">{setMeta?.nameDe ?? card.setName} · {cardNumDisplay}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {variantKnown && <InfoPill>{VARIANT_LABELS[variant]}</InfoPill>}
              {languageKnown && <InfoPill>{LANGUAGES.find(l => l.value === language)?.label ?? language.toUpperCase()}</InfoPill>}
              <CardPrice tcgId={card.id} plain fontSize={15} className="font-extrabold shrink-0" />
            </div>
          </div>

          {/* Zustand (+ Sprache, sofern nicht schon bekannt — siehe Pill oben) */}
          <div className={languageKnown ? 'mb-2.5' : 'grid grid-cols-2 gap-2.5 mb-2.5'}>
            <SelectField label="Zustand">
              <CustomSelect fullWidth aria-label="Zustand" value={condition} onChange={v => setCondition(v as CardCondition)}
                options={CONDITIONS.map(c => ({ value: c.value, label: c.label }))} />
            </SelectField>
            {!languageKnown && (
              <SelectField label="Sprache">
                <CustomSelect fullWidth aria-label="Sprache" value={language} onChange={v => setLanguage(v as CardLanguage)}
                  options={LANGUAGES.map(l => ({ value: l.value, label: l.label }))} />
              </SelectField>
            )}
          </div>

          {/* Variante — nur editierbar, wenn nicht schon bekannt (sonst Pill oben) */}
          {!variantKnown && (
            <div className="mb-4">
              <SelectField label="Variante">
                <CustomSelect fullWidth aria-label="Variante" value={variant} onChange={v => setVariant(v as CardVariant)}
                  options={variantOptions.map(v => ({ value: v, label: VARIANT_LABELS[v] }))} />
              </SelectField>
            </div>
          )}

          {/* Bereits vorhanden — nur im Scanner-Kontext (`fromScanner`): dort
              liegt kein Kartendetail dahinter, das die eigenen Exemplare schon
              zeigt. Aus dem Kartendetail heraus wäre diese Liste redundant
              (die „Karten & Preise"-Sektion listet sie bereits). */}
          {fromScanner && ownedCopies.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-4">
              {ownedCopies.map(copy => {
                const binder = allBinders.find(b => b.cardIds.includes(copy.id));
                const binderName = binder?.name ?? 'Unsortiert';
                const binderColor = binder?.color ?? 'var(--muted-foreground)';
                const condColor = CONDITION_COLOR[copy.condition] ?? 'var(--muted-foreground)';
                return (
                  <div
                    key={copy.id}
                    className="glass-inner flex items-center gap-2.5 rounded-xl px-3 py-2"
                    style={{ background: `color-mix(in srgb, ${binderColor} 16%, transparent)` }}
                  >
                    <div
                      className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
                      style={{ background: `color-mix(in srgb, ${binderColor} 20%, transparent)` }}
                    >
                      <BinderIcon name={binder?.icon ?? 'folder'} size={18} style={{ color: binderColor }} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold truncate">{binderName}</div>
                      <div className="text-[12px] text-muted-foreground truncate">
                        <span style={{ color: condColor, fontWeight: 600 }}>{CONDITIONS.find(c => c.value === copy.condition)?.label ?? copy.condition}</span>
                        {' · '}{copy.language.toUpperCase()}{' · '}{VARIANT_LABELS[copy.variant]}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
    </Sheet>
  );
}

/** Kleines schreibgeschütztes Badge für bereits feststehende Werte (Variante/
 *  Sprache) — sitzt in der Karten-Kopfzeile links neben dem Preis, statt ein
 *  eigenes (dann nutzloses, da nicht wirklich änderbares) Dropdown zu zeigen. */
function InfoPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="glass-inner text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 whitespace-nowrap">
      {children}
    </span>
  );
}

/** Label über einem Feld (Zustand/Sprache/Variante) — das eigentliche Dropdown
 *  ist jetzt das zentrale `CustomSelect`. */
function SelectField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-[7px]">
      <span className="text-[12px] font-semibold text-glass-muted">{label}</span>
      {children}
    </label>
  );
}
