'use client';

import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer';
import type { WishlistDoc } from '@/types';

// Bewusst KEINE eigene Schriftart geladen — die eingebaute Helvetica deckt
// Latein-1 inkl. Umlauten (ä/ö/ü) ab, was für Karten-/Set-Namen reicht.
const styles = StyleSheet.create({
  page: { paddingVertical: 40, paddingHorizontal: 36, fontSize: 10, fontFamily: 'Helvetica' },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginBottom: 16 },
  table: { borderTopWidth: 1, borderColor: '#999' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#ddd', minHeight: 22, alignItems: 'center' },
  headerRow: { borderBottomWidth: 1, borderColor: '#999' },
  headerCell: { fontFamily: 'Helvetica-Bold' },
  cell: { paddingVertical: 5, paddingHorizontal: 4 },
  colName: { flex: 3 },
  colNum: { flex: 1 },
  colSet: { flex: 2 },
  colCheck: { width: 42, alignItems: 'center' },
  checkbox: { width: 12, height: 12, borderWidth: 1, borderColor: '#666', borderRadius: 2 },
});

function WishlistPdfDocument({ list }: { list: WishlistDoc }) {
  return (
    <Document title={list.name}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{list.name}</Text>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.cell, styles.colName, styles.headerCell]}>Name</Text>
            <Text style={[styles.cell, styles.colNum, styles.headerCell]}>Nummer</Text>
            <Text style={[styles.cell, styles.colSet, styles.headerCell]}>Set</Text>
            <Text style={[styles.cell, styles.colCheck, styles.headerCell]}>Haben</Text>
          </View>
          {list.items.map(item => (
            <View key={item.id} style={styles.row} wrap={false}>
              <Text style={[styles.cell, styles.colName]}>{item.name}</Text>
              <Text style={[styles.cell, styles.colNum]}>{item.number ?? ''}</Text>
              <Text style={[styles.cell, styles.colSet]}>{item.setName ?? ''}</Text>
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
export async function downloadWishlistPdf(list: WishlistDoc): Promise<void> {
  const blob = await pdf(<WishlistPdfDocument list={list} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Dateiname-untaugliche Zeichen ersetzen (z.B. "/" im Namen).
  a.download = `${list.name.replace(/[^\w\s.-]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
