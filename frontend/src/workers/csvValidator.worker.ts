/// <reference lib="webworker" />

/**
 * CSV validation worker — validates rows in a background thread so the UI
 * never freezes, even for 10,000 rows.
 *
 * Input:  { rows: CsvRow[], requiredFields: string[], validProgramCodes: string[] }
 * Output: { validated: ValidatedRow[], stats: {...} }
 */

import type { CsvRow } from "../lib/csv";

interface ValidatedRow extends CsvRow {
  _row_number: number;
  _valid: boolean;
  _errors: string[];
}

interface WorkerIn {
  rows: CsvRow[];
  requiredFields: string[];
  validProgramCodes: string[];
}

const ctx: DedicatedWorkerGlobalScope = self as any;

const APAAR_RE = /^\d{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateRow(row: CsvRow, idx: number, required: string[], programCodes: string[]): ValidatedRow {
  const errors: string[] = [];

  // Required fields present
  for (const f of required) {
    if (!row[f] || row[f].length === 0) errors.push(`Missing ${f}`);
  }

  // APAAR: optional. If present, must be 12 digits.
  if (row.apaar_id && row.apaar_id.trim().length > 0) {
    if (!APAAR_RE.test(row.apaar_id.trim())) {
      errors.push("APAAR must be exactly 12 digits");
    }
  }

  // Admission date format
  if (row.admission_date && !DATE_RE.test(row.admission_date.trim())) {
    errors.push("admission_date must be YYYY-MM-DD");
  }

  // Program code membership
  if (row.program_code && programCodes.length > 0 && !programCodes.includes(row.program_code)) {
    errors.push(`Unknown program_code: ${row.program_code}`);
  }

  return { ...row, _row_number: idx + 1, _valid: errors.length === 0, _errors: errors };
}

ctx.onmessage = (e: MessageEvent<WorkerIn>) => {
  const { rows, requiredFields, validProgramCodes } = e.data;
  const validated: ValidatedRow[] = [];
  const validSet = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const v = validateRow(rows[i], i, requiredFields, validProgramCodes);

    // In-batch duplicate detection (only among valid APAARs)
    if (v._valid && v.apaar_id && v.apaar_id.trim().length > 0) {
      const a = v.apaar_id.trim();
      if (validSet.has(a)) {
        v._valid = false;
        v._errors.push("Duplicate APAAR within file");
      } else {
        validSet.add(a);
      }
    }
    validated.push(v);
  }

  const stats = {
    total: validated.length,
    valid: validated.filter((r) => r._valid).length,
    invalid: validated.filter((r) => !r._valid).length,
    missingApaar: validated.filter((r) => r._valid && !r.apaar_id).length,
  };

  ctx.postMessage({ validated, stats });
};

export {};
