'use client';

import { Document, Page, View, Text, Image, StyleSheet, pdf } from '@react-pdf/renderer';

/** Eine fertig aufgelöste Zeile — der Aufrufer liefert bereits deutsche
 *  Namen/Set-Namen + formatierten Preis, plus den Besitz-Status. */
export interface CollectionPdfRow {
  name: string;
  number: string;
  setName: string;
  price: string;
  owned: boolean;
}

export interface CollectionPdfData {
  title: string;
  dateStr: string;
  /** 'missing' = nur Fehlende (leere Checkbox), 'owned' = nur Besessene (Haken),
   *  'both' = alle mit Status-Spalte (Haken/Checkbox). */
  variant: 'missing' | 'owned' | 'both';
  /** Set-Logo als data:-URL (optional). */
  logoDataUrl?: string;
  /** Set-Spalte anzeigen? Bei reinen Ein-Set-Listen überflüssig. */
  showSet?: boolean;
  rows: CollectionPdfRow[];
}

const styles = StyleSheet.create({
  page: { paddingVertical: 40, paddingHorizontal: 36, fontSize: 10, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  logo: { width: 96, height: 96, objectFit: 'contain' },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  date: { fontSize: 10, color: '#666' },
  sub: { fontSize: 10, color: '#666', marginBottom: 14 },
  table: { borderTopWidth: 1, borderColor: '#999' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#ddd', minHeight: 22, alignItems: 'center' },
  headerRow: { borderBottomWidth: 1, borderColor: '#999' },
  headerCell: { fontFamily: 'Helvetica-Bold' },
  cell: { paddingVertical: 5, paddingHorizontal: 4 },
  colName: { flex: 3 },
  colNum: { flex: 1 },
  colSet: { flex: 2 },
  colPrice: { width: 60, textAlign: 'right' },
  colStatus: { width: 42, alignItems: 'center' },
  checkbox: { width: 12, height: 12, borderWidth: 1, borderColor: '#666', borderRadius: 2 },
  check: { fontFamily: 'Helvetica-Bold', color: '#2f855a' },
});

function statusLabel(variant: CollectionPdfData['variant']): string {
  return variant === 'owned' ? 'Besitz' : variant === 'missing' ? 'Haben' : 'Status';
}

function CollectionPdfDocument({ title, dateStr, variant, logoDataUrl, showSet = true, rows }: CollectionPdfData) {
  const ownedCount = rows.filter(r => r.owned).length;
  const sub = variant === 'both'
    ? `${ownedCount} von ${rows.length} — ${rows.length - ownedCount} fehlen`
    : `${rows.length} ${variant === 'missing' ? 'fehlende' : 'besessene'} Karten`;
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
        <Text style={styles.sub}>{sub}</Text>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.cell, styles.colName, styles.headerCell]}>Name</Text>
            <Text style={[styles.cell, styles.colNum, styles.headerCell]}>Nummer</Text>
            {showSet && <Text style={[styles.cell, styles.colSet, styles.headerCell]}>Set</Text>}
            <Text style={[styles.cell, styles.colPrice, styles.headerCell]}>Preis</Text>
            <Text style={[styles.cell, styles.colStatus, styles.headerCell]}>{statusLabel(variant)}</Text>
          </View>
          {rows.map((r, i) => (
            <View key={i} style={styles.row} wrap={false}>
              <Text style={[styles.cell, styles.colName]}>{r.name}</Text>
              <Text style={[styles.cell, styles.colNum]}>{r.number}</Text>
              {showSet && <Text style={[styles.cell, styles.colSet]}>{r.setName}</Text>}
              <Text style={[styles.cell, styles.colPrice]}>{r.price}</Text>
              <View style={[styles.cell, styles.colStatus]}>
                {r.owned ? <Text style={styles.check}>✓</Text> : <View style={styles.checkbox} />}
              </View>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

/** Erzeugt das Listen-PDF client-seitig + stößt den Download an. Nur per
 *  dynamischem Import beim Klick laden (großes @react-pdf-Bundle). */
export async function downloadCollectionPdf(data: CollectionPdfData): Promise<void> {
  const blob = await pdf(<CollectionPdfDocument {...data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.title.replace(/[^\w\s.-]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
