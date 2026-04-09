import { EXT_COLORS } from '../scene/colors';

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

export function setupLegend(): void {
  const legend = document.getElementById('legend');
  if (!legend) return;
  for (const [ext, label] of LEGEND_ITEMS) {
    const color = EXT_COLORS[ext];
    if (color === undefined) continue;
    const hex = '#' + color.toString(16).padStart(6, '0');
    const row = document.createElement('div');
    row.className = 'item';

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = hex;
    swatch.style.boxShadow = '0 0 6px ' + hex;

    const text = document.createElement('span');
    text.textContent = '.' + ext + ' — ' + label;

    row.appendChild(swatch);
    row.appendChild(text);
    legend.appendChild(row);
  }
}
