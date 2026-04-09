import type { Timeline } from '../scene/timeline';
import type { CommitInfo } from '../data/types';

const SPEEDS = [1, 5, 20, 100];

/**
 * Timeline UI: bottom panel with play/pause, speed selector, scrub bar, and
 * current commit info (date, author, message).
 */
export function setupTimelineUI(timeline: Timeline, commits: CommitInfo[]): void {
  const root = document.getElementById('timeline');
  if (!root) {
    console.warn('[gitview] #timeline element missing');
    return;
  }

  // Clear any existing content
  while (root.firstChild) root.removeChild(root.firstChild);

  // ----- Top row: controls + commit info -----
  const topRow = document.createElement('div');
  topRow.className = 'tl-top';

  const playBtn = document.createElement('button');
  playBtn.className = 'tl-play';
  playBtn.textContent = '▶';
  playBtn.title = 'Play / Pause (Espace)';
  playBtn.addEventListener('click', () => timeline.togglePlay());
  topRow.appendChild(playBtn);

  const speedWrap = document.createElement('div');
  speedWrap.className = 'tl-speeds';
  const speedButtons: HTMLButtonElement[] = [];
  for (const s of SPEEDS) {
    const b = document.createElement('button');
    b.className = 'tl-speed';
    b.textContent = s + '×';
    b.dataset.speed = String(s);
    b.addEventListener('click', () => timeline.setSpeed(s));
    speedWrap.appendChild(b);
    speedButtons.push(b);
  }
  topRow.appendChild(speedWrap);

  const info = document.createElement('div');
  info.className = 'tl-info';
  const indexEl = document.createElement('span');
  indexEl.className = 'tl-index';
  const dateEl = document.createElement('span');
  dateEl.className = 'tl-date';
  const authorEl = document.createElement('span');
  authorEl.className = 'tl-author';
  const messageEl = document.createElement('span');
  messageEl.className = 'tl-message';
  info.appendChild(indexEl);
  info.appendChild(dateEl);
  info.appendChild(authorEl);
  info.appendChild(messageEl);
  topRow.appendChild(info);

  root.appendChild(topRow);

  // ----- Bottom row: scrub bar -----
  const track = document.createElement('div');
  track.className = 'tl-track';
  const trackFill = document.createElement('div');
  trackFill.className = 'tl-track-fill';
  const trackHandle = document.createElement('div');
  trackHandle.className = 'tl-track-handle';
  track.appendChild(trackFill);
  track.appendChild(trackHandle);
  root.appendChild(track);

  // Scrub interaction
  let scrubbing = false;
  function commitFromClientX(x: number): number {
    const rect = track.getBoundingClientRect();
    const ratio = (x - rect.left) / rect.width;
    return Math.round(Math.max(0, Math.min(1, ratio)) * (timeline.state.totalCommits - 1));
  }
  track.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    timeline.pause();
    timeline.jumpTo(commitFromClientX(e.clientX));
    track.setPointerCapture(e.pointerId);
  });
  track.addEventListener('pointermove', (e) => {
    if (!scrubbing) return;
    timeline.jumpTo(commitFromClientX(e.clientX));
  });
  track.addEventListener('pointerup', (e) => {
    scrubbing = false;
    track.releasePointerCapture(e.pointerId);
  });

  // ----- Sync UI with timeline state -----
  function formatDate(iso: string): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return iso.slice(0, 10);
    }
  }
  function shortHash(h: string): string {
    return h ? h.slice(0, 7) : '';
  }
  function truncate(s: string, n: number): string {
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + '…';
  }

  function refresh() {
    const idx = timeline.state.currentIndex;
    const total = timeline.state.totalCommits;
    const commit = commits[idx];
    const ratio = total > 1 ? idx / (total - 1) : 0;

    trackFill.style.width = ratio * 100 + '%';
    trackHandle.style.left = ratio * 100 + '%';

    indexEl.textContent = `${idx + 1} / ${total}`;
    if (commit) {
      dateEl.textContent = formatDate(commit.date);
      authorEl.textContent = commit.author;
      messageEl.textContent = `${shortHash(commit.hash)} — ${truncate(commit.message, 90)}`;
    } else {
      dateEl.textContent = '';
      authorEl.textContent = '';
      messageEl.textContent = '';
    }

    playBtn.textContent = timeline.state.isPlaying ? '⏸' : '▶';
    for (const b of speedButtons) {
      const s = Number(b.dataset.speed);
      b.classList.toggle('active', s === timeline.state.speed);
    }
  }
  timeline.onChange(refresh);
  refresh();

  // Spacebar = play/pause
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      timeline.togglePlay();
    }
  });
}
