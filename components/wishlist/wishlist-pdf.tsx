'use client';

import { Document, Page, View, Text, Image, StyleSheet, pdf } from '@react-pdf/renderer';

/** Eine fertig aufgelöste Zeile — der Aufrufer (Wunschlisten-Seite) liefert
 *  bereits deutsche Namen/Set-Namen + formatierten Preis, damit dieses Modul
 *  keine Firestore-/Preis-Logik kennen muss. */
export interface WishlistPdfRow {
  name: string;
  number: string;
  setName: string;
  price: string;
}

export interface WishlistPdfData {
  title: string;
  dateStr: string;
  /** Logo/Symbol der zugehörigen Sammlung als data:-URL (nur Vorlagen-Listen
   *  mit Set-Icon; sonst weggelassen). Bewusst data:-URL statt Remote-URL —
   *  @react-pdf lädt data:-URLs zuverlässig, Remote-Bilder können an CORS
   *  scheitern und den ganzen Export werfen. */
  logoDataUrl?: string;
  /** Set-Spalte anzeigen? Bei Set-Wunschlisten (alle Karten aus einem Set)
   *  überflüssig — dann weglassen. */
  showSet?: boolean;
  rows: WishlistPdfRow[];
}

// Eingebaute Helvetica deckt Latein-1 inkl. Umlauten ab — keine eigene Font.
const styles = StyleSheet.create({
  page: { paddingVertical: 40, paddingHorizontal: 36, fontSize: 10, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  logo: { width: 96, height: 96, objectFit: 'contain' },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  date: { fontSize: 10, color: '#666' },
  table: { borderTopWidth: 1, borderColor: '#999' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#ddd', minHeight: 22, alignItems: 'center' },
  headerRow: { borderBottomWidth: 1, borderColor: '#999' },
  headerCell: { fontFamily: 'Helvetica-Bold' },
  cell: { paddingVertical: 5, paddingHorizontal: 4 },
  colName: { flex: 3 },
  colNum: { flex: 1 },
  colSet: { flex: 2 },
  colPrice: { width: 60, textAlign: 'right' },
  colCheck: { width: 42, alignItems: 'center' },
  checkbox: { width: 12, height: 12, borderWidth: 1, borderColor: '#666', borderRadius: 2 },
});

function WishlistPdfDocument({ title, dateStr, logoDataUrl, showSet = true, rows }: WishlistPdfData) {
  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {logoDataUrl && <Image src={logoDataUrl} style={styles.logo} />}
            <Text style={styles.title}>{title}</Text>
          </View>
          <Text style={styles.date}>{dateStr}</Text>
        </View>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.cell, styles.colName, styles.headerCell]}>Name</Text>
            <Text style={[styles.cell, styles.colNum, styles.headerCell]}>Nummer</Text>
            {showSet && <Text style={[styles.cell, styles.colSet, styles.headerCell]}>Set</Text>}
            <Text style={[styles.cell, styles.colPrice, styles.headerCell]}>Preis</Text>
            <Text style={[styles.cell, styles.colCheck, styles.headerCell]}>Haben</Text>
          </View>
          {rows.map((r, i) => (
            <View key={i} style={styles.row} wrap={false}>
              <Text style={[styles.cell, styles.colName]}>{r.name}</Text>
              <Text style={[styles.cell, styles.colNum]}>{r.number}</Text>
              {showSet && <Text style={[styles.cell, styles.colSet]}>{r.setName}</Text>}
              <Text style={[styles.cell, styles.colPrice]}>{r.price}</Text>
              <View style={[styles.cell, styles.colCheck]}>
                <View style={styles.checkbox} />
              </View>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

/** Erzeugt das PDF client-seitig und stößt den Download an. Wird bewusst nur
 *  per dynamischem Import beim Klick geladen, damit `@react-pdf/renderer`
 *  (recht groß) nicht ins initiale Bundle der Wunschlisten-Seite wandert. */
export async function downloadWishlistPdf(data: WishlistPdfData): Promise<void> {
  const blob = await pdf(<WishlistPdfDocument {...data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.title.replace(/[^\w\s.-]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
