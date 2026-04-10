#!/usr/bin/env node
/**
 * gitView — 3D git constellation visualizer.
 *
 * Usage:
 *   npx gitview [repo-path...]       # scan + open viewer
 *   npx gitview                      # use current directory
 *   npx gitview /path/to/repo        # use specified repo
 *   npx gitview /repo1 /repo2        # multi-repo galaxy
 *   npx gitview --port 3000          # custom port
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');

// Parse args
const repoPaths = [];
let port = 5175;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[i + 1]); i++; }
  else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
  gitView — 3D git constellation visualizer

  Usage:
    gitview [repo-path...] [--port PORT]

  Examples:
    gitview                         # visualize current directory
    gitview /path/to/repo           # visualize a specific repo
    gitview /repo1 /repo2 /repo3    # multi-repo galaxy
    gitview . --port 3000           # custom port

  The viewer opens at http://localhost:PORT
`);
    process.exit(0);
  }
  else if (!args[i].startsWith('-')) { repoPaths.push(args[i]); }
}

// Default to current directory if no paths given
if (repoPaths.length === 0) repoPaths.push('.');

function isGitRepo(dir) {
  try {
    execFileSync('git', ['-C', dir, 'rev-parse', '--git-dir'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

/** Find git repos in immediate subdirectories (1 level deep). */
function findReposIn(dir) {
  const found = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch { continue; }
      if (isGitRepo(full)) found.push(full);
    }
  } catch { /* unreadable dir */ }
  return found;
}

// Resolve and validate each path — if not a repo, scan subdirs for repos
const resolvedPaths = [];
for (const rp of repoPaths) {
  const abs = resolve(rp);
  if (isGitRepo(abs)) {
    resolvedPaths.push(abs);
  } else {
    const found = findReposIn(abs);
    if (found.length > 0) {
      console.log(`  📂 ${abs} → found ${found.length} repo(s): ${found.map(p => basename(p)).join(', ')}`);
      resolvedPaths.push(...found);
    } else {
      console.error(`❌ ${abs} is not a git repository and contains no repos in subdirectories.`);
      process.exit(1);
    }
  }
}

if (resolvedPaths.length === 0) {
  console.error('❌ No git repositories found.');
  process.exit(1);
}

console.log(`\n  🌌 gitView — 3D Git Constellation\n`);
if (resolvedPaths.length === 1) {
  console.log(`  Repo:   ${resolvedPaths[0]}`);
} else {
  console.log(`  Repos:  ${resolvedPaths.length} repositories`);
  for (const p of resolvedPaths) {
    console.log(`          · ${basename(p)} (${p})`);
  }
}

// Step 1: Scan
const scanScript = join(ROOT, 'src/cli/scan-repo.mjs');
const dataDir = join(ROOT, 'public/data');
const dataFile = join(dataDir, 'repo.json');
mkdirSync(dataDir, { recursive: true });

console.log(`  Scan:   analyzing git history...\n`);
try {
  execFileSync('node', [scanScript, ...resolvedPaths, dataFile], { stdio: 'inherit' });
} catch (err) {
  console.error('❌ Scan failed.');
  process.exit(1);
}

// Step 2: Start Vite dev server
console.log(`\n  🚀 Starting viewer on http://localhost:${port}\n`);

const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
});

// Open browser after a short delay
setTimeout(() => {
  const url = `http://localhost:${port}`;
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(openCmd, [url], { stdio: 'ignore', shell: true });
  } catch { /* ignore if can't open browser */ }
}, 2000);

vite.on('close', (code) => {
  process.exit(code ?? 0);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  vite.kill();
  process.exit(0);
});
