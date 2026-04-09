export type SettingsCallbacks = {
  onBloom(enabled: boolean): void;
  onStarSprites(enabled: boolean): void;
  onTrails(enabled: boolean): void;
  onLinks(enabled: boolean): void;
  onLabels(enabled: boolean): void;
  onDirOrbits(enabled: boolean): void;
  onCouplings(enabled: boolean): void;
  onAutoRotate(enabled: boolean): void;
  onExpand(enabled: boolean): void;
};

export type Preset = 'high' | 'medium' | 'low';

const PRESETS: Record<Preset, Record<string, boolean>> = {
  high:   { bloom: true,    starSprites: true,  trails: true,  links: true,  labels: true,  dirOrbits: false, couplings: false, autoRotate: false, expand: false },
  medium: { bloom: true,   starSprites: true,  trails: false, links: true,  labels: true,  dirOrbits: false, couplings: false, autoRotate: false, expand: false },
  low:    { bloom: false,  starSprites: false, trails: false, links: true,  labels: false, dirOrbits: false, couplings: false, autoRotate: false, expand: false },
};

type Toggle = { id: string; key: keyof SettingsCallbacks; label: string; defaultOn: boolean };

const TOGGLES: Toggle[] = [
  { id: 't-bloom',  key: 'onBloom',       label: 'Bloom',                          defaultOn: true },
  { id: 't-star',   key: 'onStarSprites', label: 'Sprites étoiles + scintillement', defaultOn: true },
  { id: 't-trails', key: 'onTrails',      label: 'Trails (fichiers + dossiers)',   defaultOn: true },
  { id: 't-links',  key: 'onLinks',       label: 'Connexions (dossiers + fichiers)', defaultOn: true },
  { id: 't-labels', key: 'onLabels',      label: 'Labels dossiers',                defaultOn: true },
  { id: 't-orbit',  key: 'onDirOrbits',   label: 'Orbites dossiers (système solaire)', defaultOn: false },
  { id: 't-rot',    key: 'onAutoRotate',  label: 'Auto-rotation caméra',           defaultOn: false },
  { id: 't-coupl',  key: 'onCouplings',   label: 'Couplages fichiers (gravité)',    defaultOn: false },
  { id: 't-expand', key: 'onExpand',      label: 'Expand sélection',               defaultOn: false },
];

export type SettingsHandle = {
  setFps(fps: number): void;
};

export function setupSettings(callbacks: SettingsCallbacks): SettingsHandle {
  const root = document.getElementById('settings');
  if (!root) throw new Error('#settings element missing in index.html');

  // Title
  const title = document.createElement('h2');
  title.textContent = 'Effets';
  root.appendChild(title);

  // Toggles
  const checkboxes = new Map<string, HTMLInputElement>();
  for (const t of TOGGLES) {
    const row = document.createElement('div');
    row.className = 'row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = t.id;
    cb.checked = t.defaultOn;
    cb.addEventListener('change', () => {
      callbacks[t.key](cb.checked);
    });
    const label = document.createElement('label');
    label.htmlFor = t.id;
    label.textContent = t.label;
    row.appendChild(cb);
    row.appendChild(label);
    root.appendChild(row);
    checkboxes.set(t.id, cb);
  }

  // Divider
  const hr1 = document.createElement('div');
  hr1.className = 'hr';
  root.appendChild(hr1);

  // Presets
  const presetLabel = document.createElement('div');
  presetLabel.className = 'label';
  presetLabel.textContent = 'Preset';
  root.appendChild(presetLabel);

  const presetsRow = document.createElement('div');
  presetsRow.className = 'presets';
  (['high', 'medium', 'low'] as Preset[]).forEach((preset) => {
    const btn = document.createElement('button');
    btn.textContent = preset === 'high' ? 'High' : preset === 'medium' ? 'Med' : 'Low';
    btn.dataset.preset = preset;
    btn.addEventListener('click', () => applyPreset(preset));
    presetsRow.appendChild(btn);
  });
  root.appendChild(presetsRow);

  // Divider
  const hr2 = document.createElement('div');
  hr2.className = 'hr';
  root.appendChild(hr2);

  // FPS counter
  const fpsRow = document.createElement('div');
  fpsRow.className = 'row';
  const fpsLabel = document.createElement('span');
  fpsLabel.className = 'label';
  fpsLabel.textContent = 'FPS';
  const fps = document.createElement('span');
  fps.id = 'fps';
  fps.textContent = '--';
  fpsRow.appendChild(fpsLabel);
  fpsRow.appendChild(fps);
  root.appendChild(fpsRow);

  function applyPreset(preset: Preset) {
    const cfg = PRESETS[preset];
    setToggle('t-bloom', cfg.bloom, callbacks.onBloom);
    setToggle('t-star', cfg.starSprites, callbacks.onStarSprites);
    setToggle('t-trails', cfg.trails, callbacks.onTrails);
    setToggle('t-links', cfg.links, callbacks.onLinks);
    setToggle('t-labels', cfg.labels, callbacks.onLabels);
    setToggle('t-orbit', cfg.dirOrbits, callbacks.onDirOrbits);
    setToggle('t-coupl', cfg.couplings, callbacks.onCouplings);
    setToggle('t-rot', cfg.autoRotate, callbacks.onAutoRotate);
    setToggle('t-expand', cfg.expand, callbacks.onExpand);
  }

  function setToggle(id: string, value: boolean, cb: (v: boolean) => void) {
    const checkbox = checkboxes.get(id);
    if (!checkbox) return;
    if (checkbox.checked !== value) {
      checkbox.checked = value;
      cb(value);
    }
  }

  return {
    setFps(value: number) {
      fps.textContent = value.toFixed(0);
      // Color hint
      if (value >= 50) fps.style.color = '#88ff99';
      else if (value >= 30) fps.style.color = '#ffdd66';
      else fps.style.color = '#ff7766';
    },
  };
}
