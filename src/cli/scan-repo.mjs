#!/usr/bin/env node
// gitView CLI — scans one or more git repos and outputs a merged JSON tree.
//
// Usage:
//   node src/cli/scan-repo.mjs <repo-path> [repo-path2 ...] [output-path]
//
// If the last argument is not a git repo, it's treated as the output path.
// Reads only TRACKED files (respects .gitignore via `git ls-files`).
// Output shape: { meta: {...}, tree: DirNode, commits, couplings }

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
    const sampleLen = Math.min(buf.length, 8192);
    for (let i = 0; i < sampleLen; i++) {
      if (buf[i] === 0) return 0;
    }
    let lines = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 10) lines++;
    }
    if (buf[buf.length - 1] !== 10) lines++;
    return lines;
  } catch {
    return 0;
  }
}

function isGitRepo(path) {
  try {
    execFileSync('git', ['-C', path, 'rev-parse', '--git-dir'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ---- Parse CLI args ----
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node src/cli/scan-repo.mjs <repo-path> [repo-path2 ...] [output-path]');
  process.exit(1);
}

// Separate repo paths from output path
// Last arg is output if it's not a git repo, or if it ends in .json
const repoPaths = [];
let out = 'public/data/repo.json';

for (const arg of args) {
  const abs = resolve(arg);
  if (arg.endsWith('.json')) {
    out = arg;
  } else if (isGitRepo(abs)) {
    repoPaths.push(abs);
  } else {
    // Could be output path
    out = arg;
  }
}

if (repoPaths.length === 0) {
  console.error('Error: no valid git repositories provided.');
  process.exit(1);
}

const isMultiRepo = repoPaths.length > 1;

// Deduplicate repo basenames (append -2, -3, etc. if collision)
const usedNames = new Map();
function uniqueRepoName(absRepo) {
  let name = basename(absRepo) || 'repo';
  const count = usedNames.get(name) ?? 0;
  usedNames.set(name, count + 1);
  if (count > 0) name = name + '-' + (count + 1);
  return name;
}

console.error(`[gitview] scanning ${repoPaths.length} repo(s): ${repoPaths.map(p => basename(p)).join(', ')}`);

// ---- Scan a single repo ----
function scanRepo(absRepo, prefixPaths) {
  const repoName = uniqueRepoName(absRepo);
  console.error(`\n[gitview] ── ${repoName} ──`);

  // 1. List tracked files
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

  // 2. Build hierarchical tree
  const root = { name: repoName, type: 'dir', children: [] };

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
    // In multi-repo: prefix with repo name for global uniqueness
    const _path = prefixPaths ? repoName + '/' + file : file;
    dir.children.push({ name: filename, type: 'file', size, lines, _path });
  }

  if (missingStat > 0) {
    console.error(`[gitview] warning: ${missingStat} files could not be stat'd`);
  }
  console.error(`[gitview] line counting: ${totalLines} lines in ${Date.now() - startMs}ms`);

  // 3. Git log
  console.error(`[gitview] reading git history…`);
  const histStart = Date.now();

  const trackedSet = new Set(files);
  const fileTimeline = new Map(); // repoName/path → { bornAt, modifiedAt, deletedAt }
  const rawCommits = []; // commits with ISO dates

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
  const logLines = logOut.split('\n');
  for (const line of logLines) {
    if (line.startsWith('__C__')) {
      if (currentCommit) rawCommits.push(currentCommit);
      const rest = line.slice(5);
      const parts = rest.split('\x01');
      currentCommit = {
        hash: parts[0] || '',
        date: parts[1] || '',
        author: parts[2] || '',
        message: parts[3] || '',
        repo: repoName,
        added: [],
        modified: [],
      };
    } else if (line.length > 0 && currentCommit) {
      const tabIdx = line.indexOf('\t');
      if (tabIdx === -1) continue;
      const status = line[0];
      const path = line.slice(tabIdx + 1);
      if (!trackedSet.has(path)) continue;

      const globalPath = prefixPaths ? repoName + '/' + path : path;

      if (status === 'A' || status === 'C') {
        if (!fileTimeline.has(globalPath)) {
          fileTimeline.set(globalPath, { bornAt: -1, modifiedAt: [], deletedAt: [] });
          currentCommit.added.push(globalPath);
        } else {
          fileTimeline.get(globalPath).modifiedAt.push(-1); // placeholder, reindexed later
          currentCommit.modified.push(globalPath);
        }
      } else if (status === 'M') {
        if (!fileTimeline.has(globalPath)) {
          fileTimeline.set(globalPath, { bornAt: -1, modifiedAt: [], deletedAt: [] });
          currentCommit.added.push(globalPath);
        } else {
          fileTimeline.get(globalPath).modifiedAt.push(-1);
          currentCommit.modified.push(globalPath);
        }
      } else if (status === 'D') {
        if (trackedSet.has(path)) {
          currentCommit.deleted = currentCommit.deleted || [];
          currentCommit.deleted.push(globalPath);
          if (fileTimeline.has(globalPath)) {
            fileTimeline.get(globalPath).deletedAt.push(-1);
          }
        }
      }
    }
  }
  if (currentCommit) rawCommits.push(currentCommit);

  // Default for files we never saw an event for
  for (const path of files) {
    const globalPath = prefixPaths ? repoName + '/' + path : path;
    if (!fileTimeline.has(globalPath)) {
      fileTimeline.set(globalPath, { bornAt: -1, modifiedAt: [], deletedAt: [] });
    }
  }

  console.error(`[gitview] git log: ${rawCommits.length} commits in ${Date.now() - histStart}ms`);

  // 4. Couplings (intra-repo only)
  console.error('[gitview] computing file couplings…');
  const couplingStart = Date.now();
  const pairCount = new Map();
  for (const c of rawCommits) {
    const paths = [...(c.added || []), ...(c.modified || [])];
    if (paths.length > 80) continue;
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const key = paths[i] < paths[j] ? paths[i] + '|' + paths[j] : paths[j] + '|' + paths[i];
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
      }
    }
  }
  const couplings = [...pairCount.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 150)
    .map(([key, count]) => {
      const [a, b] = key.split('|');
      return { a, b, count };
    });
  console.error(`[gitview] couplings: ${couplings.length} pairs in ${Date.now() - couplingStart}ms`);

  // Sort tree
  function sortTree(node) {
    if (node.type !== 'dir') return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of node.children) sortTree(c);
  }
  sortTree(root);

  return {
    repoName,
    absRepo,
    root,
    rawCommits,
    fileTimeline,
    couplings,
    fileCount: files.length,
    totalSize,
    totalLines,
  };
}

// ---- Scan all repos ----
const scans = repoPaths.map(p => scanRepo(p, isMultiRepo));

// ---- Merge commits by date (chronological) ----
console.error('\n[gitview] merging timelines…');

// Collect all commits from all repos, sort by date
const allCommits = [];
for (const scan of scans) {
  for (const c of scan.rawCommits) {
    allCommits.push(c);
  }
}
allCommits.sort((a, b) => {
  // Sort by date string (ISO 8601 sorts lexicographically)
  if (a.date < b.date) return -1;
  if (a.date > b.date) return 1;
  return 0;
});

// Assign global commit indices
// Build a map: (repoName, localCommitHash) → globalIndex
// We need to re-index bornAt/modifiedAt/deletedAt in each file's timeline
const commitHashToGlobalIdx = new Map();
for (let i = 0; i < allCommits.length; i++) {
  const c = allCommits[i];
  commitHashToGlobalIdx.set(c.repo + ':' + c.hash, i);
}

// Re-index file timelines using global commit order
// For each repo, walk its commits in local order and assign global indices
for (const scan of scans) {
  // Build local→global index mapping for this repo
  const localToGlobal = [];
  for (const c of scan.rawCommits) {
    const gIdx = commitHashToGlobalIdx.get(c.repo + ':' + c.hash);
    localToGlobal.push(gIdx);
  }

  // Walk commits again to assign bornAt/modifiedAt/deletedAt with global indices
  // Reset all timelines first
  for (const [, tl] of scan.fileTimeline) {
    tl.bornAt = -1;
    tl.modifiedAt = [];
    tl.deletedAt = [];
  }

  for (let localIdx = 0; localIdx < scan.rawCommits.length; localIdx++) {
    const commit = scan.rawCommits[localIdx];
    const globalIdx = localToGlobal[localIdx];

    for (const path of commit.added) {
      const tl = scan.fileTimeline.get(path);
      if (tl && tl.bornAt === -1) {
        tl.bornAt = globalIdx;
      } else if (tl) {
        tl.modifiedAt.push(globalIdx);
      }
    }
    for (const path of commit.modified) {
      const tl = scan.fileTimeline.get(path);
      if (tl && tl.bornAt === -1) {
        tl.bornAt = globalIdx;
      } else if (tl) {
        tl.modifiedAt.push(globalIdx);
      }
    }
    for (const path of (commit.deleted || [])) {
      const tl = scan.fileTimeline.get(path);
      if (tl) tl.deletedAt.push(globalIdx);
    }
  }

  // Default bornAt for files never seen in log
  for (const [, tl] of scan.fileTimeline) {
    if (tl.bornAt === -1) tl.bornAt = 0;
  }
}

// ---- Build merged tree ----
// Attach timeline data to file nodes
function attachTimeline(node, fileTimeline) {
  if (node.type === 'file') {
    const t = fileTimeline.get(node._path);
    node.bornAt = t ? t.bornAt : 0;
    node.modifiedAt = t ? t.modifiedAt : [];
    node.deletedAt = t ? t.deletedAt : [];
    delete node._path;
    return;
  }
  for (const c of node.children) attachTimeline(c, fileTimeline);
}

let mergedTree;
if (isMultiRepo) {
  // Virtual root with children = each repo
  mergedTree = { name: '/', type: 'dir', children: [] };
  for (const scan of scans) {
    attachTimeline(scan.root, scan.fileTimeline);
    mergedTree.children.push(scan.root);
  }
} else {
  // Single repo — no virtual root, same as before
  const scan = scans[0];
  attachTimeline(scan.root, scan.fileTimeline);
  mergedTree = scan.root;
}

// Merge couplings
const allCouplings = [];
for (const scan of scans) {
  allCouplings.push(...scan.couplings);
}

// ---- Build meta ----
let meta;
if (isMultiRepo) {
  meta = {
    repos: scans.map(s => ({
      repo: s.repoName,
      path: s.absRepo,
      fileCount: s.fileCount,
      totalSize: s.totalSize,
      totalLines: s.totalLines,
      commitCount: s.rawCommits.length,
      scannedAt: new Date().toISOString(),
    })),
    scannedAt: new Date().toISOString(),
  };
} else {
  const s = scans[0];
  meta = {
    repo: s.repoName,
    path: s.absRepo,
    fileCount: s.fileCount,
    totalSize: s.totalSize,
    totalLines: s.totalLines,
    commitCount: s.rawCommits.length,
    scannedAt: new Date().toISOString(),
  };
}

const result = {
  meta,
  tree: mergedTree,
  commits: allCommits,
  couplings: allCouplings,
};

const outPath = resolve(out);
mkdirSync(dirname(outPath), { recursive: true });
const json = JSON.stringify(result);
writeFileSync(outPath, json);
const totalFiles = scans.reduce((sum, s) => sum + s.fileCount, 0);
const totalCommits = allCommits.length;
console.error(`\n[gitview] wrote ${out} (${(json.length / 1024).toFixed(0)} KB) — ${totalFiles} files, ${totalCommits} commits across ${scans.length} repo(s)`);
