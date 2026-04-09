import type { DirNodeData, FileNodeData } from '../scene/layout';
import type { CommitInfo } from '../data/types';

export type Inspector = {
  showDir(dir: DirNodeData): void;
  showFile(file: FileNodeData): void;
  hide(): void;
};

function fmt(n: number): string {
  return n.toLocaleString('fr-FR');
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso.slice(0, 10); }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export function createInspector(commits: CommitInfo[]): Inspector {
  const elRaw = document.getElementById('inspector');
  if (!elRaw) return { showDir() {}, showFile() {}, hide() {} };
  const el: HTMLElement = elRaw;

  function clear() {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function addType(text: string) {
    const d = document.createElement('div');
    d.className = 'insp-type';
    d.textContent = text;
    el.appendChild(d);
  }

  function addTitle(text: string) {
    const d = document.createElement('div');
    d.className = 'insp-title';
    d.textContent = text;
    el.appendChild(d);
  }

  function addRow(label: string, value: string) {
    const row = document.createElement('div');
    row.className = 'insp-row';
    const l = document.createElement('span');
    l.className = 'insp-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'insp-value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    el.appendChild(row);
  }

  function addPath(path: string) {
    const d = document.createElement('div');
    d.className = 'insp-path';
    d.textContent = path;
    el.appendChild(d);
  }

  function countDescendants(dir: DirNodeData, layout: { dirs: DirNodeData[] }): { dirs: number; files: number } {
    // fileCount is already recursive, for dirs we estimate
    return { dirs: 0, files: dir.fileCount };
  }

  function showDir(dir: DirNodeData) {
    clear();
    addType('dossier');
    addTitle(dir.name);
    addRow('Fichiers (récursif)', fmt(dir.fileCount));
    addRow('Profondeur', String(dir.depth));

    // Birth commit info
    if (dir.bornAt >= 0 && dir.bornAt < commits.length) {
      const bc = commits[dir.bornAt];
      addRow('Créé au commit', `#${dir.bornAt + 1}`);
      addRow('Date création', formatDate(bc.date));
      addRow('Auteur', bc.author);
    }

    addPath(dir.fullPath);
    el.style.display = 'block';
  }

  function showFile(file: FileNodeData) {
    clear();
    addType('fichier');
    addTitle(file.name);
    addRow('Taille', formatSize(file.size));

    // Get lines from the modifiedAt array or from other data
    // We can compute extension from name
    const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '—';
    addRow('Extension', ext);
    addRow('Rayon visuel', file.radius.toFixed(2));

    // Birth commit info
    if (file.bornAt >= 0 && file.bornAt < commits.length) {
      const bc = commits[file.bornAt];
      addRow('Créé au commit', `#${file.bornAt + 1}`);
      addRow('Date création', formatDate(bc.date));
      addRow('Auteur', bc.author);
    }

    // Modification count
    addRow('Modifications', fmt(file.modifiedAt.length));

    // Last modification
    if (file.modifiedAt.length > 0) {
      const lastModIdx = file.modifiedAt[file.modifiedAt.length - 1];
      if (lastModIdx < commits.length) {
        const lm = commits[lastModIdx];
        addRow('Dernière modif', formatDate(lm.date));
      }
    }

    addPath(file.fullPath);
    el.style.display = 'block';
  }

  function hide() {
    el.style.display = 'none';
  }

  return { showDir, showFile, hide };
}
