/**
 * Zeigt bei Karten mit deutscher Übersetzung zuerst den englischen Namen,
 * danach klein/gedimmt den deutschen in Klammern — z.B. "Clefairy (Piepi)".
 * Ohne deutsche Übersetzung (nameEn nicht gesetzt) einfach nur `name`.
 */
export function CardNameLabel({
  card,
  secondaryClassName = 'text-[0.78em] font-normal text-muted-foreground',
}: {
  card: { name: string; nameEn?: string };
  secondaryClassName?: string;
}) {
  if (!card.nameEn) return <>{card.name}</>;
  return (
    <>
      {card.nameEn} <span className={secondaryClassName}>({card.name})</span>
    </>
  );
}
