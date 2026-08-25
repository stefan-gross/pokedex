'use client';

import { useState, useEffect } from 'react';
import { Plus, ChevronDown } from 'lucide-react';
import { cardInfoToAddInput, type CardInfo } from '@/lib/card-info';
import { CardImage } from '@/components/card/CardImage';
import type { CardCondition, CardLanguage, CardVariant, CardDoc, BinderDoc } from '@/types';
import { addCard, getCardsByTcgId } from '@/lib/firestore/cards';
import { getBinders, addCardToBinder, ensureDefaultBinder } from '@/lib/firestore/binders';
import { matchTemplateBinders } from '@/lib/template-binders/match-hint';
import { syncTemplateBinders } from '@/lib/template-binders/sync';
import { LANGUAGES, CONDITIONS, VARIANT_LABELS } from '@/lib/card-constants';
import { CardPrice } from '@/components/card/CardPrice';
import { BinderIcon } from '@/lib/binder-icons';
import { useSetMeta } from '@/lib/hooks/use-set-meta';
import { CardNameLabel } from '@/components/card/CardNameLabel';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/modal';
import { CustomSelect } from '@/components/ui/select';
import { CollectionPickerSheet } from '@/components/collection/CollectionPickerSheet';

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
 *  Ziel-Sammlung: standardmäßig die zur Karte PASSENDE automatische Sammlung
 *  (Vorlage matcht per Set/Pokémon/Illustrator), sonst „Unsortiert". Über den
 *  Sammlungs-Picker frei änderbar (Empfohlen + alle manuellen Sammlungen).
 *  Vorlagen-Binder werden nicht direkt bebucht, sondern per Template-Sync
 *  befüllt (Karte landet in „Unsortiert", die Vorlage holt sie sich). */
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
  const [targetId, setTargetId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getBinders().then(list => {
      setAllBinders(list);
      // Vorauswahl: die zur Karte PASSENDE automatische Sammlung (Vorlage matcht
      // per Set/Pokémon/Illustrator), sonst „Unsortiert" (isDefault).
      const matched = matchTemplateBinders(card, list.filter(b => b.template));
      const def = matched[0]
        ?? list.find(b => b.isDefault && !b.template)
        ?? list.find(b => !b.template);
      if (def) setTargetId(def.id);
    }).catch(() => {});
    getCardsByTcgId(card.id).then(setOwnedCopies).catch(() => {});
  }, [card.id]);

  // Auswählbare Ziele im Picker: manuelle Sammlungen (inkl. „Unsortiert"), KEINE
  // Vorlagen (die füllen sich automatisch). Empfohlen = passende Vorlagen.
  const recommended = matchTemplateBinders(card, allBinders.filter(b => b.template));
  const selectable  = allBinders.filter(b => !b.template).sort((a, b) => a.sortOrder - b.sortOrder);
  const targetBinder = allBinders.find(b => b.id === targetId) ?? null;
  const targetName = targetBinder?.name ?? 'Unsortiert';
  const targetIsRecommended = recommended.some(b => b.id === targetId);

  const save = async () => {
    setSaving(true);
    try {
      // „Prüfen" nur für Scanner-Ergebnisse (KI-Erkennung, kann falsch liegen).
      // Manuelles Hinzufügen aus Suche/Kartendetail ist bewusst gewählt → kein
      // Review-Status. Vorläufige Karten (pendingCatalog) behandelt der Helper.
      const cardId = await addCard(
        // Einzeln, manuell bestätigtes Hinzufügen (Grid-„+", Erkennen-FAB,
        // Kartendetail, Suche) — der Nutzer prüft die Karte selbst → kein
        // Prüfen-Badge. Der bleibt „Alle hinzufügen" (Bulk) + Auto-Save beim
        // Verlassen vorbehalten, wo NICHT einzeln geprüft wird.
        cardInfoToAddInput(card, { variant, condition, language, needsReview: false }),
      );
      const chosen = allBinders.find(b => b.id === targetId);
      if (chosen?.template) {
        // Vorlagen-Sammlungen: Karte IN die Vorlage legen und dann syncen — der
        // Sync sortiert sie in ihren Slot ein. (Der Sync übernimmt KEINE Karten
        // von selbst, er arrangiert nur die bereits enthaltenen; deshalb muss die
        // Karte vorher rein. Passt sie nicht zur Vorlage, wandert sie beim Sync
        // nach „Unsortiert".)
        await addCardToBinder(chosen.id, cardId);
        await syncTemplateBinders({ binderIds: [chosen.id] });
      } else {
        await addCardToBinder(targetId ?? await ensureDefaultBinder(), cardId);
      }
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
          {saving ? 'Wird gespeichert…' : `Zu ${targetName}`}
        </Button>
      }
    >
          {/* Karten-Zeile */}
          <div className="flex items-center gap-3 pb-[14px] mb-4 border-b border-[rgba(46,46,50,0.1)] dark:border-white/10">
            <CardImage
              card={card}
              size="small"
              alt={card.name}
              width={40}
              height={56}
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
            <div className="mb-2.5">
              <SelectField label="Variante">
                <CustomSelect fullWidth aria-label="Variante" value={variant} onChange={v => setVariant(v as CardVariant)}
                  options={variantOptions.map(v => ({ value: v, label: VARIANT_LABELS[v] }))} />
              </SelectField>
            </div>
          )}

          {/* Ziel-Sammlung — Vorauswahl passende Vorlage bzw. „Unsortiert",
              änderbar über den geteilten CollectionPickerSheet. */}
          <div className="mb-4">
            <SelectField label="Sammlung">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="w-full flex items-center gap-2.5 h-11 px-3 rounded-2xl glass-inner border border-[var(--border)]"
                aria-label="Sammlung wählen"
              >
                <BinderIcon
                  name={targetBinder?.icon ?? 'cards'} size={16}
                  className="shrink-0" style={{ color: targetBinder?.color ?? 'var(--muted-foreground)' }}
                />
                <span className="flex-1 min-w-0 truncate text-left text-sm font-bold">{targetName}</span>
                {targetIsRecommended && (
                  <span className="text-[11px] font-semibold shrink-0" style={{ color: 'var(--action-add)' }}>Empfohlen</span>
                )}
                <ChevronDown size={16} className="text-muted-foreground shrink-0" />
              </button>
            </SelectField>
          </div>

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

          {/* Zielsammlungs-Picker (geteilt mit Kartendetail/Scanner): Empfohlen
              (passende Vorlagen) zuerst, dann alle manuellen Sammlungen. */}
          <CollectionPickerSheet
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            title="Sammlung wählen"
            fromScanner={fromScanner}
            onPick={(id) => { if (id) setTargetId(id); }}
            groups={[
              {
                label: 'Empfohlen',
                items: recommended.map(b => ({ id: b.id, icon: b.icon ?? 'cards', name: b.name, hint: 'Empfohlen', color: b.color })),
              },
              {
                label: 'Sammlungen',
                items: selectable.map(b => ({ id: b.id, icon: b.icon ?? 'folder', name: b.name, color: b.color })),
              },
            ]}
          />
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
