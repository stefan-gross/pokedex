export type BinderSize = 4 | 9 | 12 | 16 | 18;

export const BINDER_SIZES: { value: BinderSize; label: string; cols: number; rows: number }[] = [
  { value: 4,  label: '2×2', cols: 2, rows: 2 },
  { value: 9,  label: '3×3', cols: 3, rows: 3 },
  { value: 12, label: '3×4', cols: 3, rows: 4 },
  { value: 16, label: '4×4', cols: 4, rows: 4 },
  { value: 18, label: '3×6', cols: 3, rows: 6 },
];

export function binderSizeLabel(size: BinderSize | undefined): string {
  if (!size) return '';
  return BINDER_SIZES.find(s => s.value === size)?.label ?? `${size}er`;
}

export function binderSizeCols(size: BinderSize | undefined): number {
  if (!size) return 3;
  return BINDER_SIZES.find(s => s.value === size)?.cols ?? 3;
}
