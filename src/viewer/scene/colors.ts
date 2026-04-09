// Color mapping for files (by extension) and directory palette.

export const EXT_COLORS: Record<string, number> = {
  ts: 0x3178c6,
  tsx: 0x61dafb,
  js: 0xf7df1e,
  jsx: 0x61dafb,
  mjs: 0xf7df1e,
  cjs: 0xf7df1e,
  vue: 0x42b883,
  svelte: 0xff3e00,

  css: 0xff79c6,
  scss: 0xff5fae,
  sass: 0xff5fae,
  less: 0xc586c0,
  html: 0xe34f26,

  md: 0x4ade80,
  mdx: 0x4ade80,
  txt: 0xaaaaaa,
  rst: 0x88aa88,

  json: 0xaaaaaa,
  yaml: 0xcc6677,
  yml: 0xcc6677,
  toml: 0x9c4221,
  xml: 0xcc6677,

  svg: 0xffaa44,
  png: 0xffd166,
  jpg: 0xffd166,
  jpeg: 0xffd166,
  webp: 0xffd166,
  gif: 0xffd166,
  ico: 0xffd166,

  py: 0x3776ab,
  rs: 0xdea584,
  go: 0x00add8,
  java: 0xb07219,
  kt: 0xa97bff,
  c: 0x555555,
  cpp: 0x555555,
  h: 0x666666,
  hpp: 0x666666,
  cs: 0x9b4f96,
  rb: 0xcc342d,
  php: 0x4f5b93,
  swift: 0xfa7343,
  sh: 0x4eaa25,
  zsh: 0x4eaa25,
  bash: 0x4eaa25,
  sql: 0xe38c00,
  graphql: 0xe10098,

  lock: 0x666666,
  env: 0x888844,
  gitignore: 0x666666,
  dockerfile: 0x2496ed,
};

export const DEFAULT_FILE_COLOR = 0xbbbbbb;

/** Top-level directory palette — colors cycle for top-level dirs. */
export const DIR_PALETTE: number[] = [
  0xff7755, 0x55aaff, 0x66dd88, 0xffaa66, 0xc88aff, 0x44ddcc, 0xff99cc, 0xaaff66, 0x66bbff,
];

export const ROOT_COLOR = 0xffeeaa;

export function colorForFile(name: string): number {
  // Special-case dotfiles like ".gitignore"
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return EXT_COLORS.dockerfile;
  if (lower === '.gitignore') return EXT_COLORS.gitignore;
  if (lower === '.env' || lower.startsWith('.env.')) return EXT_COLORS.env;
  if (lower.endsWith('.lock') || lower === 'package-lock.json' || lower === 'pnpm-lock.yaml') {
    return EXT_COLORS.lock;
  }
  const m = name.match(/\.([^.]+)$/);
  if (!m) return DEFAULT_FILE_COLOR;
  return EXT_COLORS[m[1].toLowerCase()] ?? DEFAULT_FILE_COLOR;
}

/**
 * Visual radius for a file. Based on **lines of code**, with a smaller fallback
 * for binary files (using bytes).
 *
 *  - 1 line  → 0.20
 *  - 10      → 0.52
 *  - 100     → 0.84
 *  - 1000    → 1.16
 *  - 10000   → 1.48
 *  - 50000   → 1.70
 *
 * Binary files (lines = 0) use a much smaller log-byte fallback so they're
 * visually smaller than the smallest text file.
 */
export function radiusFromFile(file: { size: number; lines: number }): number {
  if (file.lines > 0) {
    const r = 0.2 + Math.log10(file.lines) * 0.32;
    return Math.max(0.2, Math.min(2.0, r));
  }
  // Binary fallback — clamped small range
  const r = 0.18 + Math.log(file.size + 1) * 0.04;
  return Math.max(0.18, Math.min(0.6, r));
}

/**
 * Visual radius for a directory. Based on the **recursive file count**, with
 * cube-root scaling so the difference between a 700-file and 2566-file dir is
 * actually visible (log10 was too compressive).
 *
 *  - 1 file    → 1.90
 *  - 5         → 2.75
 *  - 50        → 5.12
 *  - 500       → 10.23
 *  - 1000      → 12.70
 *  - 2566      → 17.21
 *
 * Big dirs visually dominate; tiny dirs stay small. The root is naturally the
 * biggest because its fileCount is the recursive total of the whole tree.
 */
export function dirRadius(fileCount: number, _isRoot: boolean): number {
  const fc = Math.max(1, fileCount);
  const r = 0.7 + Math.cbrt(fc) * 1.2;
  return Math.max(0.7, Math.min(20, r));
}
