import type { DirNodeData } from '../scene/layout';

export type ContextMenuAction = 'focus' | 'expand' | 'collapse';

export type ContextMenu = {
  show(dir: DirNodeData, screenX: number, screenY: number): void;
  hide(): void;
  onAction(cb: (action: ContextMenuAction, dir: DirNodeData) => void): void;
};

export function createContextMenu(): ContextMenu {
  const el = document.createElement('div');
  el.id = 'ctx-menu';
  el.style.cssText =
    'display:none;position:fixed;z-index:200;background:rgba(12,12,24,0.92);border:1px solid #333;border-radius:6px;padding:4px 0;backdrop-filter:blur(8px);min-width:150px;font-size:12px;font-family:-apple-system,system-ui,sans-serif;';
  document.body.appendChild(el);

  const actions: Array<{ id: ContextMenuAction; label: string; icon: string }> = [
    { id: 'expand', label: 'Expand', icon: '⊕' },
    { id: 'collapse', label: 'Collapse', icon: '⊖' },
    { id: 'focus', label: 'Focus', icon: '⊙' },
  ];

  const buttons: HTMLButtonElement[] = [];
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.dataset.action = a.id;
    btn.textContent = a.icon + '  ' + a.label;
    btn.style.cssText =
      'display:block;width:100%;text-align:left;background:none;border:none;color:#ddd;padding:7px 14px;cursor:pointer;font-size:12px;font-family:inherit;';
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,238,170,0.12)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; });
    btn.addEventListener('click', () => {
      if (currentDir) {
        for (const cb of subscribers) cb(a.id, currentDir);
      }
      hide();
    });
    el.appendChild(btn);
    buttons.push(btn);
  }

  let currentDir: DirNodeData | null = null;
  const subscribers: Array<(action: ContextMenuAction, dir: DirNodeData) => void> = [];

  function show(dir: DirNodeData, screenX: number, screenY: number) {
    currentDir = dir;
    el.style.display = 'block';
    // Position near click, keep on screen
    const menuW = 160;
    const menuH = actions.length * 34;
    const x = Math.min(screenX, window.innerWidth - menuW - 8);
    const y = Math.min(screenY, window.innerHeight - menuH - 8);
    el.style.left = x + 'px';
    el.style.top = y + 'px';

    // Show/hide collapse based on whether dir is expanded
    const collapseBtn = buttons.find((b) => b.dataset.action === 'collapse');
    if (collapseBtn) collapseBtn.style.display = dir._expanded ? 'block' : 'none';
  }

  function hide() {
    el.style.display = 'none';
    currentDir = null;
  }

  // Hide on click outside
  window.addEventListener('pointerdown', (e) => {
    if (el.style.display === 'block' && !el.contains(e.target as Node)) {
      hide();
    }
  });

  return {
    show,
    hide,
    onAction(cb) { subscribers.push(cb); },
  };
}
