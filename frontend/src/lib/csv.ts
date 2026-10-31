/** Minimal CSV parser — no external deps. Handles quoted fields + escaped quotes. */
export interface CsvRow { [key: string]: string; }

export function parseCsv(text: string): { headers: string[]; rows: CsvRow[]; error?: string } {
  const lines: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === "\n") { lines.push(cur); cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length > 0) lines.push(cur);

  const cleaned = lines.filter((l) => l.trim().length > 0);
  if (cleaned.length === 0) return { headers: [], rows: [], error: "Empty file" };

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') {
          if (line[i + 1] === '"') { cell += '"'; i++; }
          else q = false;
        } else cell += c;
      } else {
        if (c === '"') q = true;
        else if (c === ",") { cells.push(cell); cell = ""; }
        else cell += c;
      }
    }
    cells.push(cell);
    return cells;
  };

  const headers = splitRow(cleaned[0]).map((h) => h.trim());
  const rows = cleaned.slice(1).map((line) => {
    const cells = splitRow(line);
    const row: CsvRow = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
  return { headers, rows };
}
