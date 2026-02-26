import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface EvalRow {
  task_id: string;
  task_label: string;
  baseline_runtime_sec: string;
  planner_runtime_sec: string;
  runtime_reduction_pct: string;
  baseline_passed: string;
  planner_passed: string;
  known_failure_tests: string;
  selected_tests: string;
  escalated: string;
  escalation_reason: string;
  notes: string;
}

function parseCsv(content: string): EvalRow[] {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return [];
  }

  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        quoted = !quoted;
        continue;
      }
      if (ch === ',' && !quoted) {
        cells.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    cells.push(current);

    const row = {} as Record<string, string>;
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = cells[i] ?? '';
    }
    return row as EvalRow;
  });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

describe('impact-aware test sequence evaluation artifacts (issue #838)', () => {
  it('captures >=15 representative tasks with >=30% median runtime reduction and safety constraints', () => {
    const csvPath = path.join(
      process.cwd(),
      'docs',
      'librarian',
      'evals',
      'test_sequence',
      'impact_aware_baseline_vs_planner.csv',
    );
    expect(fs.existsSync(csvPath)).toBe(true);
    const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    expect(rows.length).toBeGreaterThan(0);

    const taskRows = rows.filter((row) => row.task_id !== 'AGGREGATE');
    expect(taskRows.length).toBeGreaterThanOrEqual(15);

    const reductions = taskRows.map((row) => Number(row.runtime_reduction_pct));
    expect(reductions.every((value) => Number.isFinite(value))).toBe(true);
    expect(median(reductions)).toBeGreaterThanOrEqual(30);

    expect(taskRows.every((row) => row.baseline_passed === 'true')).toBe(true);
    expect(taskRows.every((row) => row.planner_passed === 'true')).toBe(true);

    const underSelectEscalation = taskRows.find((row) =>
      row.escalated === 'true'
      && row.notes.toLowerCase().includes('under-select')
    );
    expect(underSelectEscalation).toBeDefined();
  });
});
