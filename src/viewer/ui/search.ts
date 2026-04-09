import type { FileNodeData, DirNodeData } from '../scene/layout';
import type { FileInstances } from '../scene/instances';

export type Search = {
  show(): void;
  hide(): void;
  toggle(): void;
};

export function createSearch(
  files: FileNodeData[],
  dirs: DirNodeData[],
  fileInstances: FileInstances,
  onFocusDir: (dir: DirNodeData) => void,
): Search {
  // Build the search bar
  const container = document.createElement('div');
  container.id = 'search-bar';
  container.style.display = 'none';
  document.body.appendChild(container);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Rechercher fichier ou dossier…';
  input.className = 'search-input';
  container.appendChild(input);

  const results = document.createElement('div');
  results.className = 'search-results';
  container.appendChild(results);

  const countEl = document.createElement('span');
  countEl.className = 'search-count';
  container.appendChild(countEl);

  let visible = false;
  let lastQuery = '';
  let matchedFileIndices: number[] = [];

  function doSearch(query: string) {
    lastQuery = query;
    results.textContent = '';
    matchedFileIndices = [];

    if (query.length < 2) {
      countEl.textContent = '';
      // Clear any previous highlights
      clearHighlights();
      return;
    }

    const lower = query.toLowerCase();

    // Search files
    const fileMatches: Array<{ idx: number; f: FileNodeData }> = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].fullPath.toLowerCase().includes(lower) || files[i].name.toLowerCase().includes(lower)) {
        fileMatches.push({ idx: i, f: files[i] });
      }
    }

    // Search dirs
    const dirMatches: DirNodeData[] = [];
    for (const d of dirs) {
      if (d.fullPath.toLowerCase().includes(lower) || d.name.toLowerCase().includes(lower)) {
        dirMatches.push(d);
      }
    }

    countEl.textContent = `${fileMatches.length} fichiers · ${dirMatches.length} dossiers`;

    // Pulse matched files
    matchedFileIndices = fileMatches.map(m => m.idx);
    const now = performance.now();
    for (const idx of matchedFileIndices) {
      fileInstances.pulse(idx, now);
    }

    // Show results (max 15)
    const allResults: Array<{ type: 'file' | 'dir'; name: string; path: string; data: FileNodeData | DirNodeData; idx?: number }> = [];
    for (const m of fileMatches.slice(0, 10)) {
      allResults.push({ type: 'file', name: m.f.name, path: m.f.fullPath, data: m.f, idx: m.idx });
    }
    for (const d of dirMatches.slice(0, 5)) {
      allResults.push({ type: 'dir', name: d.name, path: d.fullPath, data: d });
    }

    for (const r of allResults) {
      const row = document.createElement('div');
      row.className = 'search-result-row';
      const icon = document.createElement('span');
      icon.className = 'search-result-icon';
      icon.textContent = r.type === 'dir' ? '📁' : '📄';
      const path = document.createElement('span');
      path.className = 'search-result-path';
      // Highlight match in path
      const lowerPath = r.path.toLowerCase();
      const matchStart = lowerPath.indexOf(lower);
      if (matchStart >= 0) {
        path.appendChild(document.createTextNode(r.path.slice(0, matchStart)));
        const mark = document.createElement('mark');
        mark.textContent = r.path.slice(matchStart, matchStart + query.length);
        path.appendChild(mark);
        path.appendChild(document.createTextNode(r.path.slice(matchStart + query.length)));
      } else {
        path.textContent = r.path;
      }
      row.appendChild(icon);
      row.appendChild(path);
      row.addEventListener('click', () => {
        if (r.type === 'dir') {
          onFocusDir(r.data as DirNodeData);
        } else {
          // Focus the file's parent dir
          onFocusDir((r.data as FileNodeData).parent);
          // Pulse the file
          fileInstances.pulse(r.idx!, performance.now());
        }
      });
      results.appendChild(row);
    }
  }

  function clearHighlights() {
    matchedFileIndices = [];
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  input.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doSearch(input.value.trim()), 150);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });

  function show() {
    container.style.display = 'flex';
    visible = true;
    input.value = '';
    results.textContent = '';
    countEl.textContent = '';
    setTimeout(() => input.focus(), 50);
  }

  function hide() {
    container.style.display = 'none';
    visible = false;
    clearHighlights();
  }

  function toggle() { visible ? hide() : show(); }

  // Ctrl+F / Cmd+F
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      toggle();
    }
  });

  return { show, hide, toggle };
}
