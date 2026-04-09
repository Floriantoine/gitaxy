import type { CommitInfo } from '../data/types';
import type { FileNodeData } from '../scene/layout';

export type Stats = {
  show(): void;
  hide(): void;
  toggle(): void;
  /** Update stats to reflect only commits 0..commitIdx. Call periodically. */
  update(commitIdx: number): void;
};

export function createStats(commits: CommitInfo[], files: FileNodeData[]): Stats {
  const panel = document.createElement('div');
  panel.id = 'stats-panel';
  panel.style.display = 'none';
  document.body.appendChild(panel);

  // Pre-build the file path→index map for fast lookup
  const fileByPath = new Map<string, number>();
  for (let i = 0; i < files.length; i++) {
    const p = files[i].fullPath.startsWith('/') ? files[i].fullPath.slice(1) : files[i].fullPath;
    fileByPath.set(p, i);
  }

  let lastUpdatedIdx = -1;
  let isVisible = false;

  // DOM elements for dynamic content
  let summaryEl: HTMLDivElement;
  let authorsEl: HTMLDivElement;
  let filesEl: HTMLDivElement;
  let sparklineEl: HTMLDivElement;
  let sparkLabelsEl: HTMLDivElement;

  // Build static DOM structure
  function buildDOM() {
    panel.textContent = '';

    // Header
    const header = document.createElement('div');
    header.className = 'stats-header';
    const title = document.createElement('h2');
    title.textContent = 'Statistiques';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.className = 'stats-close';
    closeBtn.addEventListener('click', hide);
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    summaryEl = document.createElement('div');
    summaryEl.className = 'stats-summary';
    panel.appendChild(summaryEl);

    // Authors section
    const authSection = document.createElement('div');
    authSection.className = 'stats-section';
    const authTitle = document.createElement('h3');
    authTitle.textContent = 'Top contributeurs';
    authSection.appendChild(authTitle);
    authorsEl = document.createElement('div');
    authSection.appendChild(authorsEl);
    panel.appendChild(authSection);

    // Files section
    const filesSection = document.createElement('div');
    filesSection.className = 'stats-section';
    const filesTitle = document.createElement('h3');
    filesTitle.textContent = 'Fichiers les plus modifiés';
    filesSection.appendChild(filesTitle);
    filesEl = document.createElement('div');
    filesSection.appendChild(filesEl);
    panel.appendChild(filesSection);

    // Activity section
    const actSection = document.createElement('div');
    actSection.className = 'stats-section';
    const actTitle = document.createElement('h3');
    actTitle.textContent = 'Activité mensuelle';
    actSection.appendChild(actTitle);
    sparklineEl = document.createElement('div');
    sparklineEl.className = 'stats-sparkline';
    actSection.appendChild(sparklineEl);
    sparkLabelsEl = document.createElement('div');
    sparkLabelsEl.className = 'stats-spark-labels';
    actSection.appendChild(sparkLabelsEl);
    panel.appendChild(actSection);
  }
  buildDOM();

  function addBar(parent: HTMLElement, label: string, value: number, max: number, color: string) {
    const row = document.createElement('div');
    row.className = 'stats-bar-row';
    const lbl = document.createElement('span');
    lbl.className = 'stats-bar-label';
    lbl.textContent = label;
    const barWrap = document.createElement('div');
    barWrap.className = 'stats-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'stats-bar';
    bar.style.width = (value / max * 100) + '%';
    bar.style.background = color;
    const val = document.createElement('span');
    val.className = 'stats-bar-value';
    val.textContent = String(value);
    barWrap.appendChild(bar);
    row.appendChild(lbl);
    row.appendChild(barWrap);
    row.appendChild(val);
    parent.appendChild(row);
  }

  function computeAndRender(commitIdx: number) {
    const endIdx = Math.min(commitIdx, commits.length - 1);
    const activeCommits = commits.slice(0, endIdx + 1);

    // Top contributors
    const authorCommits = new Map<string, number>();
    const fileModCount = new Map<string, number>();
    const monthActivity = new Map<string, number>();
    let totalAdded = 0;
    let totalDeleted = 0;

    for (const c of activeCommits) {
      authorCommits.set(c.author, (authorCommits.get(c.author) ?? 0) + 1);
      totalAdded += c.added.length;
      totalDeleted += (c.deleted?.length ?? 0);
      if (c.date) {
        const key = c.date.slice(0, 7);
        monthActivity.set(key, (monthActivity.get(key) ?? 0) + 1);
      }
      for (const p of c.modified) {
        fileModCount.set(p, (fileModCount.get(p) ?? 0) + 1);
      }
    }

    // Count visible files at this commit
    let visibleFiles = 0;
    for (const f of files) {
      if (f.bornAt <= endIdx) visibleFiles++;
    }

    // Summary
    const date = activeCommits[endIdx]?.date?.slice(0, 10) ?? '';
    summaryEl.textContent = `${endIdx + 1}/${commits.length} commits · ${visibleFiles} fichiers · ${authorCommits.size} auteurs · ${date}`;

    // Top authors
    const topAuthors = [...authorCommits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxC = topAuthors[0]?.[1] ?? 1;
    authorsEl.textContent = '';
    for (const [name, count] of topAuthors) {
      addBar(authorsEl, name, count, maxC, '#ffaa44');
    }

    // Top modified files
    const topFiles = [...fileModCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxM = topFiles[0]?.[1] ?? 1;
    filesEl.textContent = '';
    for (const [path, count] of topFiles) {
      const short = path.length > 35 ? '…' + path.slice(-33) : path;
      addBar(filesEl, short, count, maxM, '#4488ff');
    }

    // Activity sparkline
    const months = [...monthActivity.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const maxMonth = Math.max(...months.map(m => m[1]), 1);
    sparklineEl.textContent = '';
    for (const [month, count] of months) {
      const bar = document.createElement('div');
      bar.className = 'stats-spark-bar';
      bar.style.height = (count / maxMonth * 100) + '%';
      bar.title = `${month}: ${count} commits`;
      sparklineEl.appendChild(bar);
    }
    sparkLabelsEl.textContent = '';
    if (months.length > 0) {
      const first = document.createElement('span');
      first.textContent = months[0][0];
      const last = document.createElement('span');
      last.textContent = months[months.length - 1][0];
      sparkLabelsEl.appendChild(first);
      sparkLabelsEl.appendChild(last);
    }
  }

  function update(commitIdx: number) {
    if (!isVisible) return;
    // Throttle: only update if commitIdx changed significantly
    if (Math.abs(commitIdx - lastUpdatedIdx) < 5 && commitIdx !== commits.length - 1) return;
    lastUpdatedIdx = commitIdx;
    computeAndRender(commitIdx);
  }

  function show() { panel.style.display = 'block'; isVisible = true; update(lastUpdatedIdx >= 0 ? lastUpdatedIdx : commits.length - 1); }
  function hide() { panel.style.display = 'none'; isVisible = false; }
  function toggle() { isVisible ? hide() : show(); }

  return { show, hide, toggle, update };
}
