/**
 * Zeigt immer zuerst den deutschen Namen (`name` — bereits DE-first befüllt).
 * Der englische Name in Klammern wird nur ergänzt, wenn er sich vom
 * deutschen unterscheidet UND kein deutsches Kartenbild existiert — dann
 * hilft er, den (englisch angezeigten) Bild-Text zuzuordnen, z.B.
 * "Simsala (Alakazam)". Gibt es ein deutsches Bild, reicht der deutsche
 * Name allein. Ohne Übersetzung oder bei gleichem Namen: nur `name`.
 */
export function CardNameLabel({
  card,
  secondaryClassName = 'text-[0.78em] font-normal text-muted-foreground',
}: {
  card: { name: string; nameEn?: string; imgSmallDe?: string };
  secondaryClassName?: string;
}) {
  const showEnglish = !!card.nameEn && card.nameEn !== card.name && !card.imgSmallDe;
  if (!showEnglish) return <>{card.name}</>;
  return (
    <>
      {card.name} <span className={secondaryClassName}>({card.nameEn})</span>
    </>
  );
}
