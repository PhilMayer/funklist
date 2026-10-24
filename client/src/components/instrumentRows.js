// Rows for InstrumentsEditor: { key, name, min_count }. Keys keep React rows stable while editing.
let nextKey = 1;
export const newRow = (name = '', minCount = 0) => ({ key: nextKey++, name, min_count: minCount });
export const toRows = (list) => list.map((i) => newRow(i.name, i.min_count ?? 0));

// For saving: trimmed names, numeric minimums, empty rows dropped.
export const cleanRows = (rows) => rows
  .map((r) => ({ name: r.name.trim(), min_count: Number(r.min_count) || 0 }))
  .filter((r) => r.name);
