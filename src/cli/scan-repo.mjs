#!/usr/bin/env node
// gitView CLI — scans a git repo and outputs a JSON tree.
//
// Usage:
//   node src/cli/scan-repo.mjs <repo-path> [output-path]
//
// Reads only TRACKED files (respects .gitignore via `git ls-files`).
// Output shape: { meta: {...}, tree: DirNode } — see src/viewer/data/types.ts

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname, join, basename, extname } from 'node:path';

// Extensions known to be binary — skip line counting outright.
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.ico',
  '.svg', // svg is text technically, but counting lines is meaningless
  '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.otf', '.fnt',
  '.zip', '.gz', '.tar', '.bz2', '.7z', '.rar', '.xz',
  '.exe', '.dll', '.so', '.dylib', '.a', '.o', '.bin', '.dat',
  '.db', '.sqlite', '.sqlite3',
  '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav', '.flac', '.ogg', '.webm', '.m4a',
  '.psd', '.ai', '.eps', '.sketch', '.fig',
  '.class', '.jar', '.war', '.pyc',
]);

const LINE_COUNT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function countLines(absPath, sizeBytes) {
  if (sizeBytes === 0) return 0;
  if (sizeBytes > LINE_COUNT_MAX_BYTES) return 0;
  const ext = extname(absPath).toLowerCase();
  if (BINARY_EXTS.has(ext)) return 0;
  try {
    const buf = readFileSync(absPath);
    // Binary detection: null byte in first 8KB
    const sampleLen = Math.min(buf.length, 8192);
    for (let i = 0; i < sampleLen; i++) {
      if (buf[i] === 0) return 0;
    }
    // Count newlines (0x0A)
    let lines = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 10) lines++;
    }
    // Final partial line if file doesn't end with newline
    if (buf[buf.length - 1] !== 10) lines++;
    return lines;
  } catch {
    return 0;
  }
}

const repoArg = process.argv[2];
if (!repoArg) {
  console.error('Usage: node src/cli/scan-repo.mjs <repo-path> [output-path]');
  process.exit(1);
}

const out = process.argv[3] || 'public/data/repo.json';
const absRepo = resolve(repoArg);

console.error(`[gitview] scanning ${absRepo}`);

let lsOut;
try {
  lsOut = execFileSync('git', ['-C', absRepo, 'ls-files'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
} catch (err) {
  console.error(`[gitview] failed to run git ls-files in ${absRepo}`);
  console.error(err.message);
  process.exit(1);
}

const files = lsOut.split('\n').filter(Boolean);
console.error(`[gitview] ${files.length} tracked files`);

// Build hierarchical tree
const root = { name: basename(absRepo) || '/', type: 'dir', children: [] };

function ensureDir(parts) {
  let node = root;
  for (const part of parts) {
    let child = node.children.find((c) => c.name === part && c.type === 'dir');
    if (!child) {
      child = { name: part, type: 'dir', children: [] };
      node.children.push(child);
    }
    node = child;
  }
  return node;
}

let totalSize = 0;
let totalLines = 0;
let missingStat = 0;
const startMs = Date.now();
for (const file of files) {
  const parts = file.split('/');
  const filename = parts.pop();
  const dir = ensureDir(parts);
  const absPath = join(absRepo, file);
  let size = 0;
  try {
    size = statSync(absPath).size;
  } catch {
    missingStat++;
  }
  const lines = countLines(absPath, size);
  totalSize += size;
  totalLines += lines;
  dir.children.push({ name: filename, type: 'file', size, lines, _path: file });
}

if (missingStat > 0) {
  console.error(`[gitview] warning: ${missingStat} files could not be stat'd`);
}
console.error(`[gitview] line counting: ${totalLines} lines in ${Date.now() - startMs}ms`);

// ----- Walk git log to extract per-file timeline -----
console.error(`[gitview] reading git history…`);
const histStart = Date.now();

const trackedSet = new Set(files);
// Map: path → { bornAt, modifiedAt }
const fileTimeline = new Map();
const commits = [];

let logOut;
try {
  logOut = execFileSync(
    'git',
    [
      '-C', absRepo,
      'log',
      '--reverse',
      '--name-status',
      '--no-renames',
      '--pretty=format:__C__%H%x01%aI%x01%an%x01%s',
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 },
  );
} catch (err) {
  console.error('[gitview] git log failed:', err.message);
  process.exit(1);
}

let currentCommit = null;
let commitIdx = 0;
const logLines = logOut.split('\n');
for (const line of logLines) {
  if (line.startsWith('__C__')) {
    if (currentCommit) {
      commits.push(currentCommit);
      commitIdx++;
    }
    const rest = line.slice(5);
    const parts = rest.split('\x01');
    currentCommit = {
      hash: parts[0] || '',
      date: parts[1] || '',
      author: parts[2] || '',
      message: parts[3] || '',
      added: [],
      modified: [],
    };
  } else if (line.length > 0 && currentCommit) {
    // Status\tPath
    const tabIdx = line.indexOf('\t');
    if (tabIdx === -1) continue;
    const status = line[0];
    const path = line.slice(tabIdx + 1);
    if (!trackedSet.has(path)) continue; // skip non-current files

    if (status === 'A' || status === 'C') {
      if (!fileTimeline.has(path)) {
        fileTimeline.set(path, { bornAt: commitIdx, modifiedAt: [], deletedAt: [] });
        currentCommit.added.push(path);
      } else {
        fileTimeline.get(path).modifiedAt.push(commitIdx);
        currentCommit.modified.push(path);
      }
    } else if (status === 'M') {
      if (!fileTimeline.has(path)) {
        // First M without seeing A — initial commit edge case
        fileTimeline.set(path, { bornAt: commitIdx, modifiedAt: [], deletedAt: [] });
        currentCommit.added.push(path);
      } else {
        fileTimeline.get(path).modifiedAt.push(commitIdx);
        currentCommit.modified.push(path);
      }
    } else if (status === 'D') {
      // Track delete events per file + per commit
      if (trackedSet.has(path)) {
        currentCommit.deleted = currentCommit.deleted || [];
        currentCommit.deleted.push(path);
        if (fileTimeline.has(path)) {
          fileTimeline.get(path).deletedAt.push(commitIdx);
        }
      }
    }
    // R (renamed) still skipped
  }
}
if (currentCommit) commits.push(currentCommit);

// Default for files we never saw an event for (orphans — defensive)
for (const path of files) {
  if (!fileTimeline.has(path)) {
    fileTimeline.set(path, { bornAt: 0, modifiedAt: [], deletedAt: [] });
  }
}

console.error(`[gitview] git log: ${commits.length} commits in ${Date.now() - histStart}ms`);

// Sort each directory's children for stable layouts (dirs first, then files, alphabetical)
function sortTree(node) {
  if (node.type !== 'dir') return;
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) sortTree(c);
}
sortTree(root);

// Attach bornAt / modifiedAt to each file node from the timeline map
function attachTimeline(node) {
  if (node.type === 'file') {
    const t = fileTimeline.get(node._path);
    node.bornAt = t ? t.bornAt : 0;
    node.modifiedAt = t ? t.modifiedAt : [];
    node.deletedAt = t ? t.deletedAt : [];
    delete node._path;
    return;
  }
  for (const c of node.children) attachTimeline(c);
}
attachTimeline(root);

const result = {
  meta: {
    repo: basename(absRepo) || '/',
    path: absRepo,
    fileCount: files.length,
    totalSize,
    totalLines,
    commitCount: commits.length,
    scannedAt: new Date().toISOString(),
  },
  tree: root,
  commits,
};

const outPath = resolve(out);
mkdirSync(dirname(outPath), { recursive: true });
const json = JSON.stringify(result);
writeFileSync(outPath, json);
console.error(`[gitview] wrote ${out} (${(json.length / 1024).toFixed(0)} KB)`);
