import { EXT_COLORS } from '../scene/colors';
import type { FileNodeData } from '../scene/layout';

const LEGEND_ITEMS: Array<[string, string]> = [
  ['ts', 'TypeScript'],
  ['tsx', 'React TSX'],
  ['js', 'JavaScript'],
  ['vue', 'Vue'],
  ['css', 'CSS'],
  ['scss', 'SCSS'],
  ['html', 'HTML'],
  ['md', 'Markdown'],
  ['json', 'JSON'],
  ['yaml', 'YAML'],
  ['svg', 'SVG'],
  ['py', 'Python'],
  ['rs', 'Rust'],
  ['go', 'Go'],
];

export type Legend = {
  /** Update bars to reflect file counts at the given commit index. */
  update(commitIdx: number): void;
};

export function setupLegend(files: FileNodeData[]): Legend {
  const legend = document.getElementById('legend')!;
  if (!legend) return { update() {} };

  // Pre-sort files by extension for fast counting
  const extToFiles = new Map<string, FileNodeData[]>();
  for (const f of files) {
    const dot = f.name.lastIndexOf('.');
    if (dot < 0) continue;
    const ext = f.name.slice(dot + 1).toLowerCase();
    let arr = extToFiles.get(ext);
    if (!arr) { arr = []; extToFiles.set(ext, arr); }
    arr.push(f);
  }

  // Sort files within each bucket by bornAt for early-exit optimization
  for (const arr of extToFiles.values()) {
    arr.sort((a, b) => a.bornAt - b.bornAt);
  }

  // Known extensions from LEGEND_ITEMS
  const knownExts = new Set(LEGEND_ITEMS.map(([ext]) => ext));

  // Extensions that exist in the repo, with color
  const activeExts = LEGEND_ITEMS.filter(
    ([ext]) => EXT_COLORS[ext] !== undefined && extToFiles.has(ext),
  );

  // Other extensions (not in LEGEND_ITEMS)
  const otherBuckets: FileNodeData[][] = [];
  for (const [ext, arr] of extToFiles) {
    if (!knownExts.has(ext)) otherBuckets.push(arr);
  }

  // Build DOM rows — one per active ext + "other"
  type Row = {
    el: HTMLDivElement;
    fill: HTMLDivElement;
    num: HTMLSpanElement;
    ext: string;
  };
  const rows: Row[] = [];

  for (const [ext] of activeExts) {
    const color = EXT_COLORS[ext];
    const hex = '#' + color.toString(16).padStart(6, '0');
    const row = makeRow(hex, '.' + ext);
    rows.push({ el: row.el, fill: row.fill, num: row.num, ext });
    legend.appendChild(row.el);
  }

  // "other" row
  let otherRow: { fill: HTMLDivElement; num: HTMLSpanElement; el: HTMLDivElement } | null = null;
  if (otherBuckets.length > 0) {
    otherRow = makeRow('#888', 'other');
    legend.appendChild(otherRow.el);
  }

  let lastCommitIdx = -1;

  function update(commitIdx: number) {
    if (commitIdx === lastCommitIdx) return;
    lastCommitIdx = commitIdx;

    let total = 0;
    const counts = new Map<string, number>();

    // Count visible files per extension
    for (const [ext, arr] of extToFiles) {
      let count = 0;
      for (const f of arr) {
        if (f.bornAt > commitIdx) break; // sorted — no more visible
        if (isAlive(f, commitIdx)) count++;
      }
      if (count > 0) counts.set(ext, count);
      total += count;
    }

    // Update rows — reorder by count descending
    const sorted = [...rows].sort(
      (a, b) => (counts.get(b.ext) ?? 0) - (counts.get(a.ext) ?? 0),
    );

    for (const r of sorted) {
      const count = counts.get(r.ext) ?? 0;
      const pct = total > 0 ? (count / total) * 100 : 0;
      r.fill.style.width = pct + '%';
      r.num.textContent = count === 0 ? '' : pct >= 1 ? Math.round(pct) + '%' : '<1%';
      r.el.style.display = count === 0 ? 'none' : '';
      legend.appendChild(r.el); // re-appending moves to end → reorders
    }

    // Other
    if (otherRow) {
      let otherCount = 0;
      for (const bucket of otherBuckets) {
        for (const f of bucket) {
          if (f.bornAt > commitIdx) break;
          if (isAlive(f, commitIdx)) otherCount++;
        }
      }
      const pct = total > 0 ? (otherCount / total) * 100 : 0;
      otherRow.fill.style.width = pct + '%';
      otherRow.num.textContent = otherCount === 0 ? '' : Math.round(pct) + '%';
      otherRow.el.style.display = otherCount === 0 ? 'none' : '';
      legend.appendChild(otherRow.el);
    }
  }

  // Initial render at full history
  update(Infinity);

  return { update };
}

function isAlive(f: FileNodeData, commitIdx: number): boolean {
  if (f.bornAt > commitIdx) return false;
  if (f.deletedAt.length === 0) return true;
  let alive = true;
  let di = 0, mi = 0;
  while (di < f.deletedAt.length || mi < f.modifiedAt.length) {
    const nextDel = di < f.deletedAt.length ? f.deletedAt[di] : Infinity;
    const nextMod = mi < f.modifiedAt.length ? f.modifiedAt[mi] : Infinity;
    const next = Math.min(nextDel, nextMod);
    if (next > commitIdx) break;
    alive = next !== nextDel;
    if (next === nextDel) di++;
    if (next === nextMod) mi++;
  }
  return alive;
}

function makeRow(hex: string, label: string) {
  const el = document.createElement('div');
  el.className = 'item';

  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = hex;
  swatch.style.boxShadow = '0 0 6px ' + hex;

  const text = document.createElement('span');
  text.className = 'ext-label';
  text.textContent = label;

  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('div');
  fill.className = 'bar-fill';
  fill.style.background = hex;
  fill.style.boxShadow = '0 0 4px ' + hex;
  bar.appendChild(fill);

  const num = document.createElement('span');
  num.className = 'bar-num';

  el.appendChild(swatch);
  el.appendChild(text);
  el.appendChild(bar);
  el.appendChild(num);

  return { el, fill, num };
}
