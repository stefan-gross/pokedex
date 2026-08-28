'use client';

import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer';

/** Eine fertig aufgelöste Deckzeile — der Aufrufer liefert Namen/Set/Preis
 *  bereits formatiert, damit dieses Modul keine Firestore-/Preis-Logik kennt. */
export interface DeckPdfRow {
  count: number;
  name: string;
  setName: string;
  number: string;
  owned: string;   // z.B. "2/2" oder "Basis-Energie"
  price: string;
}

export interface DeckPdfSection {
  title: string;   // "Pokémon · 12"
  rows: DeckPdfRow[];
}

export interface DeckPdfData {
  title: string;
  subtitle: string;   // z.B. "Standard · 60/60 · 933 €"
  dateStr: string;
  sections: DeckPdfSection[];
}

const styles = StyleSheet.create({
  page: { paddingVertical: 40, paddingHorizontal: 36, fontSize: 10, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  date: { fontSize: 10, color: '#666' },
  subtitle: { fontSize: 11, color: '#444', marginBottom: 16 },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 4, borderBottomWidth: 1, borderColor: '#999', paddingBottom: 2 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#eee', minHeight: 20, alignItems: 'center' },
  cell: { paddingVertical: 4, paddingHorizontal: 4 },
  colCount: { width: 26, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  colName: { flex: 3 },
  colSet: { flex: 2, color: '#555' },
  colNum: { width: 54, color: '#555' },
  colOwned: { width: 74, color: '#555' },
  colPrice: { width: 56, textAlign: 'right' },
});

function DeckPdfDocument({ title, subtitle, dateStr, sections }: DeckPdfData) {
  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.date}>{dateStr}</Text>
        </View>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {sections.map((sec, si) => (
          <View key={si} style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>{sec.title}</Text>
            {sec.rows.map((r, i) => (
              <View key={i} style={styles.row} wrap={false}>
                <Text style={[styles.cell, styles.colCount]}>{r.count}×</Text>
                <Text style={[styles.cell, styles.colName]}>{r.name}</Text>
                <Text style={[styles.cell, styles.colSet]}>{r.setName}</Text>
                <Text style={[styles.cell, styles.colNum]}>{r.number}</Text>
                <Text style={[styles.cell, styles.colOwned]}>{r.owned}</Text>
                <Text style={[styles.cell, styles.colPrice]}>{r.price}</Text>
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

/** Erzeugt das Deck-PDF client-seitig und stößt den Download an. Nur per
 *  dynamischem Import laden (react-pdf ist groß). */
export async function downloadDeckPdf(data: DeckPdfData): Promise<void> {
  const blob = await pdf(<DeckPdfDocument {...data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.title.replace(/[^\w\s.-]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
