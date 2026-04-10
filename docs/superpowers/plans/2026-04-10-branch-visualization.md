# Branch Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add branch visualization to gitView — each branch duplicates the constellation as a ghostly galaxy, connected by a dashed root link, with a spectacular merge animation.

**Architecture:** Incremental approach. Enrich the CLI scanner with branch data, add a `BranchInfo` type, create a `branch-cluster.ts` module that clones the existing layout per branch, and a `merge-fx.ts` for merge effects. Wire into existing timeline and settings.

**Tech Stack:** Three.js, TypeScript, Node.js (CLI), Vite

**Spec:** `docs/superpowers/specs/2026-04-10-branch-visualization-design.md`

---

## File Structure

| File | Role |
|------|------|
| `src/cli/scan-repo.mjs` | **Modify** — add `git branch`, `git log --all --parents`, `git merge-base` to detect branches, forks, merges |
| `src/viewer/data/types.ts` | **Modify** — add `BranchInfo` type, update `RepoData` |
| `src/viewer/data/loader.ts` | **Modify** — no code change needed (JSON auto-parsed) |
| `src/viewer/scene/branch-cluster.ts` | **Create** — orchestrates one branch clone: ghostly nodes, instances, links, nebula, root connection, energy particles |
| `src/viewer/scene/merge-fx.ts` | **Create** — merge animation: flash, shockwaves, spark burst |
| `src/viewer/scene/nodes.ts` | **Modify** — accept optional `GhostlyParams` for transparency |
| `src/viewer/scene/instances.ts` | **Modify** — accept optional `GhostlyParams` for file transparency |
| `src/viewer/scene/links.ts` | **Modify** — accept optional opacity override |
| `src/viewer/ui/timeline-ui.ts` | **Modify** — render branch/merge markers on the track |
| `src/viewer/ui/settings.ts` | **Modify** — add Branches toggle |
| `src/viewer/main.ts` | **Modify** — wire branch clusters, merge FX, settings, timeline events |

---

### Task 1: Add `BranchInfo` type and update `RepoData`

**Files:**
- Modify: `src/viewer/data/types.ts`

- [ ] **Step 1: Add the BranchInfo type**

In `src/viewer/data/types.ts`, add after the `FileCoupling` type:

```ts
export type BranchInfo = {
  /** Branch name (e.g. "feature-auth"). */
  name: string;
  /** Commit index where this branch forked from the main branch. */
  forkCommitIdx: number;
  /** Commit index where this branch was merged back. null = still open. */
  mergeCommitIdx: number | null;
  /** Sorted commit indices that belong to this branch (not on main). */
  commits: number[];
  /** Display color as hex number (e.g. 0xc864ff). */
  color: number;
};
```

- [ ] **Step 2: Update RepoData**

In `src/viewer/data/types.ts`, update the `RepoData` type:

```ts
export type RepoData = {
  meta: RepoMeta;
  tree: DirNode;
  commits: CommitInfo[];
  couplings: FileCoupling[];
  branches: BranchInfo[];
};
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Errors in `loader.ts` or `main.ts` about missing `branches` property — that's fine, we'll fix downstream.

- [ ] **Step 4: Commit**

```bash
git add src/viewer/data/types.ts
git commit -m "feat(types): add BranchInfo type and update RepoData"
```

---

### Task 2: Enrich CLI scanner with branch detection

**Files:**
- Modify: `src/cli/scan-repo.mjs`

- [ ] **Step 1: Add branch detection after the git log parsing**

After the line `if (currentCommit) commits.push(currentCommit);` (line 207), and before the "Default for files" block, add:

```js
// ----- Detect branches -----
console.error('[gitview] detecting branches…');
const branchStart = Date.now();

// Get all branch names
let branchListOut;
try {
  branchListOut = execFileSync('git', ['-C', absRepo, 'branch', '-a', '--format=%(refname:short)'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
} catch {
  branchListOut = '';
}

// Determine the main branch name
const allBranchNames = branchListOut.split('\n').filter(Boolean).filter(b => !b.includes('HEAD'));
// Local branches only (skip origin/ prefixes that duplicate local)
const localBranches = allBranchNames.filter(b => !b.startsWith('origin/'));

// Find the main branch (master or main)
let mainBranch = localBranches.find(b => b === 'main') || localBranches.find(b => b === 'master') || localBranches[0] || 'master';

// Build commit hash → index map
const commitHashToIdx = new Map();
for (let i = 0; i < commits.length; i++) {
  commitHashToIdx.set(commits[i].hash, i);
}

// For each non-main branch, find fork point and merge point
const branches = [];
for (const branchName of localBranches) {
  if (branchName === mainBranch) continue;

  // Find fork point (common ancestor with main)
  let forkHash;
  try {
    forkHash = execFileSync('git', ['-C', absRepo, 'merge-base', mainBranch, branchName], {
      encoding: 'utf8',
    }).trim();
  } catch {
    continue; // skip branches with no common ancestor
  }

  const forkCommitIdx = commitHashToIdx.get(forkHash);
  if (forkCommitIdx === undefined) continue;

  // Get commits on this branch that are NOT on main
  let branchOnlyOut;
  try {
    branchOnlyOut = execFileSync('git', ['-C', absRepo, 'log', '--reverse', '--oneline', '--format=%H', `${mainBranch}..${branchName}`], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    continue;
  }

  const branchCommitHashes = branchOnlyOut.split('\n').filter(Boolean);
  const branchCommitIndices = branchCommitHashes
    .map(h => commitHashToIdx.get(h))
    .filter(idx => idx !== undefined);

  if (branchCommitIndices.length === 0) continue;

  // Check if this branch has been merged into main
  let mergeCommitIdx = null;
  try {
    // A branch is merged if `git branch --merged <main>` contains it
    const mergedOut = execFileSync('git', ['-C', absRepo, 'branch', '--merged', mainBranch, '--format=%(refname:short)'], {
      encoding: 'utf8',
    });
    const mergedBranches = mergedOut.split('\n').filter(Boolean);
    if (mergedBranches.includes(branchName)) {
      // Find the merge commit: look for a commit on main that has 2+ parents, one of which is on the branch
      const branchHashSet = new Set(branchCommitHashes);
      for (let ci = forkCommitIdx + 1; ci < commits.length; ci++) {
        const c = commits[ci];
        // Check if this commit's message looks like a merge of this branch
        // More robust: check parent hashes via git log
        if (c.message && c.message.toLowerCase().includes('merge') && c.message.includes(branchName)) {
          mergeCommitIdx = ci;
          break;
        }
      }
      // Fallback: use the commit right after the last branch commit
      if (mergeCommitIdx === null && branchCommitIndices.length > 0) {
        const lastBranchIdx = Math.max(...branchCommitIndices);
        // Find the next commit on main after the last branch commit
        for (let ci = lastBranchIdx + 1; ci < commits.length; ci++) {
          if (!branchCommitIndices.includes(ci)) {
            mergeCommitIdx = ci;
            break;
          }
        }
      }
    }
  } catch {
    // Not merged
  }

  // Color from name hash (same algorithm as author-comets.ts)
  let h = 0;
  for (let i = 0; i < branchName.length; i++) {
    h = ((h << 5) - h + branchName.charCodeAt(i)) | 0;
  }
  const hue = ((h >>> 0) % 360) / 360;
  // Convert HSL to hex (S=0.85, L=0.6)
  const s = 0.85, l = 0.6;
  const a_ = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + hue * 12) % 12;
    return l - a_ * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);
  const color = (r << 16) | (g << 8) | b;

  branches.push({
    name: branchName,
    forkCommitIdx,
    mergeCommitIdx,
    commits: branchCommitIndices,
    color,
  });
}

console.error(`[gitview] branches: ${branches.length} detected in ${Date.now() - branchStart}ms`);
```

- [ ] **Step 2: Add branches to the output JSON**

Replace the `result` object:

```js
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
  couplings,
  branches,
};
```

- [ ] **Step 3: Test the scanner**

Run against a repo that has branches:

```bash
node src/cli/scan-repo.mjs /path/to/repo-with-branches /tmp/test-repo.json
```

Check the output:
```bash
node -e "const d=require('/tmp/test-repo.json'); console.log('branches:', d.branches.length); d.branches.forEach(b => console.log(b.name, 'fork:', b.forkCommitIdx, 'merge:', b.mergeCommitIdx, 'commits:', b.commits.length))"
```

Expected: branches array with fork/merge indices.

- [ ] **Step 4: Commit**

```bash
git add src/cli/scan-repo.mjs
git commit -m "feat(cli): detect branches, fork points, and merge commits"
```

---

### Task 3: Add ghostly params to `nodes.ts`

**Files:**
- Modify: `src/viewer/scene/nodes.ts`

- [ ] **Step 1: Add GhostlyParams type and update createDirNodes**

Add at the top of `nodes.ts` after the imports:

```ts
export type GhostlyParams = {
  dirOpacity: number;
  haloOpacity: number;
  haloScale: number;
  tintColor: number;
  tintStrength: number;
};
```

Update `createDirNodes` signature to accept optional ghostly:

```ts
export function createDirNodes(scene: Scene, layout: Layout, ghostly?: GhostlyParams): DirNodeRender[] {
```

In the loop, update the material creation:

```ts
    let matColor = d.color;
    if (ghostly) {
      const base = new Color(d.color);
      base.lerp(new Color(ghostly.tintColor), ghostly.tintStrength);
      matColor = base.getHex();
    }

    const mat = new MeshBasicMaterial({
      color: matColor,
      transparent: !!ghostly,
      opacity: ghostly ? ghostly.dirOpacity : 1.0,
    });
    const mesh = new Mesh(dirGeo(radius), mat);
```

Update the halo:

```ts
    const haloMat = new MeshBasicMaterial({
      color: matColor,
      transparent: true,
      opacity: ghostly ? ghostly.haloOpacity : 0.12,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const haloGeoRadius = ghostly ? ghostly.haloScale : 2.0;
    const halo = new Mesh(dirHaloGeo(radius * haloGeoRadius / 2.0), haloMat);
```

Note: `dirHaloGeo` uses a cache keyed by quantized radius. We need to pass the actual scaled radius. Replace the halo line with:

```ts
    const haloRadius = radius * (ghostly ? ghostly.haloScale : 2.0);
    const halo = new Mesh(new SphereGeometry(quantize(haloRadius), 14, 14), haloMat);
```

Add `Color` to the imports from `three`:

```ts
import {
  Scene,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  AdditiveBlending,
  Color,
} from 'three';
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/viewer/scene/nodes.ts
git commit -m "feat(nodes): support ghostly rendering params for branch clusters"
```

---

### Task 4: Add ghostly params to `instances.ts`

**Files:**
- Modify: `src/viewer/scene/instances.ts`

- [ ] **Step 1: Add ghostly support to createFileInstances**

Add an optional config parameter:

```ts
export type FileGhostlyParams = {
  fileOpacity: number;
  haloOpacity: number;
  haloRadius: number;
  tintColor: number;
  tintStrength: number;
};
```

Update the signature:

```ts
export function createFileInstances(
  scene: Scene,
  files: FileNodeData[],
  spawnParticles: SpawnParticles,
  ghostly?: FileGhostlyParams,
): FileInstances {
```

Update the material creation:

```ts
  const fileMat = new MeshBasicMaterial({
    transparent: !!ghostly,
    opacity: ghostly ? ghostly.fileOpacity : 1.0,
  });
  const haloMat = new MeshBasicMaterial({
    transparent: true,
    opacity: ghostly ? ghostly.haloOpacity : 0.22,
    blending: AdditiveBlending,
    depthWrite: false,
  });
```

Use a custom halo sphere when ghostly:

```ts
  const haloGeo = ghostly
    ? new SphereGeometry(ghostly.haloRadius, 10, 10)
    : HALO_SPHERE;
```

Apply color tinting when setting initial colors:

```ts
  const tintCol = ghostly ? new Color(ghostly.tintColor) : null;
  for (let i = 0; i < n; i++) {
    tmpColor.setHex(files[i].color);
    if (tintCol) tmpColor.lerp(tintCol, ghostly!.tintStrength);
    originalColors[i * 3] = tmpColor.r;
    originalColors[i * 3 + 1] = tmpColor.g;
    originalColors[i * 3 + 2] = tmpColor.b;
    fileMesh.setColorAt(i, tmpColor);
    haloMesh.setColorAt(i, tmpColor);
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/viewer/scene/instances.ts
git commit -m "feat(instances): support ghostly rendering params for branch clusters"
```

---

### Task 5: Add opacity params to `links.ts`

**Files:**
- Modify: `src/viewer/scene/links.ts`

- [ ] **Step 1: Add opacity parameter to createDirLinks**

Update signature:

```ts
export function createDirLinks(scene: Scene, layout: Layout, opacity?: number): DirLinks {
```

Update material:

```ts
  const mat = new LineBasicMaterial({
    color: 0xffeeaa,
    transparent: true,
    opacity: opacity ?? 0.32,
  });
```

- [ ] **Step 2: Add opacity parameter to createFileTethers**

Update signature:

```ts
export function createFileTethers(scene: Scene, files: FileNodeData[], opacity?: number): FileTethers {
```

Update material:

```ts
  const mat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: opacity ?? 0.4,
    blending: AdditiveBlending,
    depthWrite: false,
  });
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/viewer/scene/links.ts
git commit -m "feat(links): support opacity override for branch clusters"
```

---

### Task 6: Create `merge-fx.ts`

**Files:**
- Create: `src/viewer/scene/merge-fx.ts`

- [ ] **Step 1: Write the merge effects module**

```ts
import {
  Scene,
  Mesh,
  SphereGeometry,
  TorusGeometry,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  BufferGeometry,
  BufferAttribute,
  CanvasTexture,
  AdditiveBlending,
  Vector3,
} from 'three';

const MERGE_DURATION_MS = 1200;

function makeGlowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export type MergeFX = {
  /** Trigger merge at a world position with given branch color. */
  trigger(position: Vector3, branchColor: number, nowMs: number): void;
  /** Call each frame. */
  animate(nowMs: number): void;
};

export function createMergeFX(scene: Scene): MergeFX {
  const glowTex = makeGlowTexture();

  // Core flash
  const flashMat = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    blending: AdditiveBlending, depthWrite: false,
  });
  const flash = new Mesh(new SphereGeometry(8, 16, 16), flashMat);
  flash.visible = false;
  scene.add(flash);

  // Shockwave 1 (gold)
  const ring1Mat = new MeshBasicMaterial({
    color: 0xffcc66, transparent: true, opacity: 0,
    blending: AdditiveBlending, depthWrite: false,
  });
  const ring1 = new Mesh(new TorusGeometry(1, 0.6, 8, 64), ring1Mat);
  ring1.rotation.x = Math.PI / 2;
  ring1.visible = false;
  scene.add(ring1);

  // Shockwave 2 (branch color — set on trigger)
  const ring2Mat = new MeshBasicMaterial({
    color: 0xc864ff, transparent: true, opacity: 0,
    blending: AdditiveBlending, depthWrite: false,
  });
  const ring2 = new Mesh(new TorusGeometry(1, 0.4, 8, 64), ring2Mat);
  ring2.rotation.x = Math.PI / 2;
  ring2.visible = false;
  scene.add(ring2);

  // Spark burst (80 particles)
  const SPARK_COUNT = 80;
  const sparkPos = new Float32Array(SPARK_COUNT * 3);
  const sparkCol = new Float32Array(SPARK_COUNT * 3);
  const sparkVelocities: Vector3[] = [];
  for (let i = 0; i < SPARK_COUNT; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const speed = 80 + Math.random() * 160;
    sparkVelocities.push(new Vector3(
      Math.sin(ph) * Math.cos(th) * speed,
      Math.sin(ph) * Math.sin(th) * speed,
      Math.cos(ph) * speed,
    ));
    // Color set on trigger
  }
  const sparkGeo = new BufferGeometry();
  sparkGeo.setAttribute('position', new BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new BufferAttribute(sparkCol, 3));
  const sparkMat = new PointsMaterial({
    size: 2.5, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0, blending: AdditiveBlending,
    depthWrite: false, map: glowTex,
  });
  const sparks = new Points(sparkGeo, sparkMat);
  sparks.visible = false;
  scene.add(sparks);

  // State
  let active = false;
  let startMs = 0;
  let center = new Vector3();

  function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }

  function trigger(position: Vector3, branchColor: number, nowMs: number) {
    active = true;
    startMs = nowMs;
    center = position.clone();
    ring2Mat.color.setHex(branchColor);

    // Randomize spark colors (gold, white, branch color)
    const bc = { r: ((branchColor >> 16) & 0xff) / 255, g: ((branchColor >> 8) & 0xff) / 255, b: (branchColor & 0xff) / 255 };
    for (let i = 0; i < SPARK_COUNT; i++) {
      const mix = Math.random();
      if (mix < 0.4) { sparkCol[i*3]=1; sparkCol[i*3+1]=0.8; sparkCol[i*3+2]=0.3; }
      else if (mix < 0.7) { sparkCol[i*3]=1; sparkCol[i*3+1]=1; sparkCol[i*3+2]=1; }
      else { sparkCol[i*3]=bc.r; sparkCol[i*3+1]=bc.g; sparkCol[i*3+2]=bc.b; }
    }
    (sparkGeo.attributes.color as BufferAttribute).needsUpdate = true;
  }

  function animate(nowMs: number) {
    if (!active) return;
    const elapsed = nowMs - startMs;
    if (elapsed > MERGE_DURATION_MS) {
      active = false;
      flash.visible = false;
      ring1.visible = false;
      ring2.visible = false;
      sparks.visible = false;
      return;
    }
    const mt = elapsed / MERGE_DURATION_MS;

    // Core flash (100-600ms → mt 0.08-0.5)
    const flashT = Math.max(0, (mt - 0.08) / 0.42);
    if (flashT > 0 && flashT < 1) {
      flash.visible = true;
      flash.position.copy(center);
      const intensity = flashT < 0.3 ? flashT / 0.3 : Math.max(0, 1 - (flashT - 0.3) / 0.7);
      flashMat.opacity = intensity * 0.8;
      flashMat.color.setHex(flashT < 0.15 ? 0xffffff : 0xffcc66);
      flash.scale.setScalar(5 + intensity * 25);
    } else {
      flash.visible = false;
    }

    // Shockwave 1 (200-800ms → mt 0.17-0.67)
    const r1T = Math.max(0, (mt - 0.17) / 0.5);
    if (r1T > 0 && r1T < 1) {
      ring1.visible = true;
      ring1.position.copy(center);
      const s = easeOutCubic(r1T) * 200;
      ring1.scale.set(s, s, s * 0.3);
      ring1Mat.opacity = Math.max(0, (1 - r1T) * 0.35);
    } else {
      ring1.visible = false;
    }

    // Shockwave 2 (350-900ms → mt 0.29-0.75)
    const r2T = Math.max(0, (mt - 0.29) / 0.46);
    if (r2T > 0 && r2T < 1) {
      ring2.visible = true;
      ring2.position.copy(center);
      const s = easeOutCubic(r2T) * 250;
      ring2.scale.set(s, s, s * 0.2);
      ring2Mat.opacity = Math.max(0, (1 - r2T) * 0.25);
    } else {
      ring2.visible = false;
    }

    // Sparks (150-1000ms → mt 0.125-0.83)
    const spT = Math.max(0, (mt - 0.125) / 0.71);
    if (spT > 0 && spT < 1) {
      sparks.visible = true;
      const sec = (elapsed - 150) / 1000;
      const drag = Math.exp(-sec * 1.5);
      for (let i = 0; i < SPARK_COUNT; i++) {
        const v = sparkVelocities[i];
        sparkPos[i*3]   = center.x + v.x * sec * drag;
        sparkPos[i*3+1] = center.y + v.y * sec * drag;
        sparkPos[i*3+2] = center.z + v.z * sec * drag;
      }
      (sparkGeo.attributes.position as BufferAttribute).needsUpdate = true;
      sparkMat.opacity = Math.max(0, (1 - spT * spT) * 0.9);
    } else {
      sparks.visible = false;
    }
  }

  return { trigger, animate };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/viewer/scene/merge-fx.ts
git commit -m "feat: add merge-fx module for spectacular merge animation"
```

---

### Task 7: Create `branch-cluster.ts`

**Files:**
- Create: `src/viewer/scene/branch-cluster.ts`

- [ ] **Step 1: Write the branch cluster module**

```ts
import {
  Scene,
  Group,
  Line,
  LineDashedMaterial,
  BufferGeometry,
  BufferAttribute,
  Points,
  PointsMaterial,
  CanvasTexture,
  AdditiveBlending,
  Vector3,
} from 'three';
import type { BranchInfo } from '../data/types';
import { buildLayout, type Layout } from './layout';
import type { DirNode } from '../data/types';
import { createDirNodes, type GhostlyParams } from './nodes';
import { createFileInstances, type FileGhostlyParams } from './instances';
import { createSpawnParticles } from './spawn-particles';
import { createDirLinks, createFileTethers } from './links';
import { createDistribution } from './distribution';
import type { MergeFX } from './merge-fx';

const ENERGY_COUNT = 20;
const SEPARATION_MS = 500;
const MERGE_CONVERGE_MS = 300;

function makeNebulaTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.2)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

function makeGlowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export type BranchCluster = {
  branch: BranchInfo;
  group: Group;
  /** Update visibility and position based on current commit index. */
  update(commitIdx: number, nowMs: number): void;
  /** Tick animations each frame. */
  tick(nowMs: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
};

export function createBranchCluster(
  parentScene: Scene,
  tree: DirNode,
  branch: BranchInfo,
  branchIndex: number,
  mergeFX: MergeFX,
): BranchCluster {
  const group = new Group();
  group.visible = false;
  parentScene.add(group);

  // Offset: alternate left/right, 500 units apart
  const side = branchIndex % 2 === 0 ? 1 : -1;
  const offsetX = 500 * (Math.floor(branchIndex / 2) + 1) * side;
  const targetOffset = new Vector3(offsetX, 0, 0);

  // Build cloned layout
  const layout = buildLayout(tree);
  const ghostlyDir: GhostlyParams = {
    dirOpacity: 0.35,
    haloOpacity: 0.20,
    haloScale: 2.8,
    tintColor: branch.color,
    tintStrength: 0.35,
  };
  const ghostlyFile: FileGhostlyParams = {
    fileOpacity: 0.45,
    haloOpacity: 0.30,
    haloRadius: 3.5,
    tintColor: branch.color,
    tintStrength: 0.30,
  };

  // Create scene objects inside group
  const dirNodes = createDirNodes(group as unknown as Scene, layout, ghostlyDir);
  const spawnParticles = createSpawnParticles(group as unknown as Scene);
  const fileInstances = createFileInstances(group as unknown as Scene, layout.files, spawnParticles, ghostlyFile);
  const distribution = createDistribution(layout, dirNodes);
  const dirLinks = createDirLinks(group as unknown as Scene, layout, 0.18);
  const tethers = createFileTethers(group as unknown as Scene, layout.files, 0.2);

  // Nebula
  const NEBULA_N = 50;
  const nebPos = new Float32Array(NEBULA_N * 3);
  for (let i = 0; i < NEBULA_N; i++) {
    nebPos[i*3] = (Math.random()-0.5) * 200;
    nebPos[i*3+1] = (Math.random()-0.5) * 160;
    nebPos[i*3+2] = (Math.random()-0.5) * 200;
  }
  const nebGeo = new BufferGeometry();
  nebGeo.setAttribute('position', new BufferAttribute(nebPos, 3));
  const nebMat = new PointsMaterial({
    color: branch.color, size: 70, sizeAttenuation: true,
    transparent: true, opacity: 0.1, blending: AdditiveBlending,
    depthWrite: false, map: makeNebulaTexture(),
  });
  const nebula = new Points(nebGeo, nebMat);
  group.add(nebula);

  // Root-to-root dashed link (in parent scene, not group)
  const dashPos = new Float32Array(6);
  const dashPosAttr = new BufferAttribute(dashPos, 3);
  const dashGeo = new BufferGeometry();
  dashGeo.setAttribute('position', dashPosAttr);
  const dashMat = new LineDashedMaterial({
    color: branch.color, transparent: true, opacity: 0,
    dashSize: 8, gapSize: 5,
  });
  const dashLine = new Line(dashGeo, dashMat);
  parentScene.add(dashLine);

  // Energy particles along the link
  const energyPos = new Float32Array(ENERGY_COUNT * 3);
  const energyPhases: number[] = [];
  for (let i = 0; i < ENERGY_COUNT; i++) energyPhases.push(i / ENERGY_COUNT);
  const energyGeo = new BufferGeometry();
  energyGeo.setAttribute('position', new BufferAttribute(energyPos, 3));
  const energyMat = new PointsMaterial({
    color: branch.color, size: 3, sizeAttenuation: true,
    transparent: true, opacity: 0, blending: AdditiveBlending,
    depthWrite: false, map: makeGlowTexture(),
  });
  const energyPts = new Points(energyGeo, energyMat);
  parentScene.add(energyPts);

  // State
  let currentSplit = 0; // 0 = hidden, 1 = fully separated
  let mergeTriggered = false;
  let wasVisible = false;

  function easeInOut(t: number) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
  function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }

  function update(commitIdx: number, nowMs: number) {
    const shouldShow = commitIdx >= branch.forkCommitIdx &&
      (branch.mergeCommitIdx === null || commitIdx < branch.mergeCommitIdx);

    if (shouldShow && !wasVisible) {
      // Just became visible
      group.visible = true;
      mergeTriggered = false;
    }

    if (!shouldShow && wasVisible && !mergeTriggered) {
      // Merge just happened
      if (branch.mergeCommitIdx !== null && commitIdx >= branch.mergeCommitIdx) {
        mergeFX.trigger(new Vector3(0, 0, 0), branch.color, nowMs);
        mergeTriggered = true;
      }
    }

    wasVisible = shouldShow;

    // Target split
    const targetSplit = shouldShow ? 1 : 0;
    // Smooth transition
    const lerpSpeed = shouldShow ? 0.06 : 0.1;
    currentSplit += (targetSplit - currentSplit) * lerpSpeed;

    if (currentSplit < 0.01) {
      group.visible = false;
      dashLine.visible = false;
      energyPts.visible = false;
      currentSplit = 0;
      return;
    }

    group.visible = true;
    group.position.copy(targetOffset).multiplyScalar(currentSplit);

    // Dashed link
    dashPos[0] = 0; dashPos[1] = 0; dashPos[2] = 0;
    dashPos[3] = group.position.x; dashPos[4] = group.position.y; dashPos[5] = group.position.z;
    dashPosAttr.needsUpdate = true;
    dashLine.computeLineDistances();
    dashMat.opacity = currentSplit * 0.5;
    dashLine.visible = true;

    // Energy particles
    energyMat.opacity = currentSplit * 0.7;
    energyPts.visible = true;
    const mp = new Vector3(0, 0, 0);
    const bp = group.position.clone();
    for (let i = 0; i < ENERGY_COUNT; i++) {
      const t01 = ((nowMs * 0.0004 + energyPhases[i]) % 1);
      const along = mp.clone().lerp(bp, t01);
      const perp = Math.sin(t01 * Math.PI * 4 + nowMs * 0.002) * 3;
      energyPos[i*3] = along.x + perp;
      energyPos[i*3+1] = along.y + Math.cos(t01 * Math.PI * 3 + nowMs * 0.0015) * 3;
      energyPos[i*3+2] = along.z + perp;
    }
    (energyGeo.attributes.position as BufferAttribute).needsUpdate = true;

    // Update internal layout
    distribution.update(commitIdx);
    distribution.tick();
    fileInstances.animate(nowMs);
    spawnParticles.animate(nowMs);
    dirLinks.update(commitIdx);
    tethers.update(commitIdx);
    nebula.rotation.y += 0.0004;
  }

  function tick(nowMs: number) {
    // Called separately if needed for additional per-frame work
  }

  return {
    branch,
    group,
    update,
    tick,
    setVisible(v) {
      if (!v) {
        group.visible = false;
        dashLine.visible = false;
        energyPts.visible = false;
        currentSplit = 0;
      }
    },
    dispose() {
      parentScene.remove(group);
      parentScene.remove(dashLine);
      parentScene.remove(energyPts);
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Note: `createDirNodes` and `createFileInstances` expect a `Scene` but we pass a `Group`. The `as unknown as Scene` cast works because Three.js `Group` has an `.add()` method. If this causes issues, the alternative is to add objects to the group manually after creation.

- [ ] **Step 3: Commit**

```bash
git add src/viewer/scene/branch-cluster.ts
git commit -m "feat: add branch-cluster module for ghostly constellation clones"
```

---

### Task 8: Add branch/merge markers to timeline UI

**Files:**
- Modify: `src/viewer/ui/timeline-ui.ts`

- [ ] **Step 1: Read the current timeline-ui.ts to understand its structure**

Check the file first and identify where markers can be added to the track element.

- [ ] **Step 2: Add a function to render branch markers**

After the `setupTimelineUI` function, export a helper that accepts branches and the track element:

```ts
export function addBranchMarkers(
  trackEl: HTMLElement,
  branches: Array<{ name: string; forkCommitIdx: number; mergeCommitIdx: number | null; color: number }>,
  totalCommits: number,
) {
  for (const branch of branches) {
    // Fork marker
    const forkPct = (branch.forkCommitIdx / Math.max(1, totalCommits - 1)) * 100;
    const forkMarker = document.createElement('div');
    forkMarker.style.cssText = `position:absolute;top:-16px;left:${forkPct}%;transform:translateX(-50%);font-size:9px;pointer-events:none;white-space:nowrap;color:#${branch.color.toString(16).padStart(6,'0')};`;
    forkMarker.textContent = `↓ ${branch.name}`;
    trackEl.appendChild(forkMarker);

    // Merge marker (if merged)
    if (branch.mergeCommitIdx !== null) {
      const mergePct = (branch.mergeCommitIdx / Math.max(1, totalCommits - 1)) * 100;
      const mergeMarker = document.createElement('div');
      mergeMarker.style.cssText = `position:absolute;top:-16px;left:${mergePct}%;transform:translateX(-50%);font-size:9px;pointer-events:none;white-space:nowrap;color:#ffaa44;`;
      mergeMarker.textContent = `↓ merge`;
      trackEl.appendChild(mergeMarker);
    }
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/viewer/ui/timeline-ui.ts
git commit -m "feat(timeline-ui): add branch fork/merge markers on track"
```

---

### Task 9: Add Branches toggle to settings

**Files:**
- Modify: `src/viewer/ui/settings.ts`

- [ ] **Step 1: Add the branches callback and toggle**

Add to `SettingsCallbacks`:

```ts
  onBranches(enabled: boolean): void;
```

Add to `TOGGLES` array (before the last entry):

```ts
  { id: 't-branch', key: 'onBranches', label: 'Branches', defaultOn: true },
```

Add to `PRESETS`:

```ts
  high:   { bloom: true,  starSprites: true,  trails: true,  links: true,  labels: true,  dirOrbits: false, autoRotate: false, expand: false, branches: true },
  medium: { bloom: true,  starSprites: true,  trails: false, links: true,  labels: true,  dirOrbits: false, autoRotate: false, expand: false, branches: true },
  low:    { bloom: false, starSprites: false, trails: false, links: true,  labels: false, dirOrbits: false, autoRotate: false, expand: false, branches: false },
```

Add to `applyPreset`:

```ts
    setToggle('t-branch', cfg.branches, callbacks.onBranches);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/viewer/ui/settings.ts
git commit -m "feat(settings): add Branches toggle"
```

---

### Task 10: Wire everything in `main.ts`

**Files:**
- Modify: `src/viewer/main.ts`

- [ ] **Step 1: Add imports**

```ts
import { createBranchCluster, type BranchCluster } from './scene/branch-cluster';
import { createMergeFX } from './scene/merge-fx';
import { addBranchMarkers } from './ui/timeline-ui';
```

- [ ] **Step 2: Create branch clusters after the main layout setup**

After the timeline setup block and before the `// ----- UI -----` section, add:

```ts
  // ----- Branch clusters -----
  const mergeFX = createMergeFX(scene);
  const branchClusters: BranchCluster[] = [];
  const branches = repo.branches ?? [];
  for (let i = 0; i < branches.length; i++) {
    const cluster = createBranchCluster(scene, repo.tree, branches[i], i, mergeFX);
    branchClusters.push(cluster);
  }

  // Add branch markers to timeline track
  const trackEl = document.querySelector('.tl-track') as HTMLElement | null;
  if (trackEl && branches.length > 0) {
    addBranchMarkers(trackEl, branches, repo.commits.length);
  }
```

- [ ] **Step 3: Update the frame loop**

In the `frame()` function, after `tethers.update(commitIdx);` add:

```ts
    // Branch clusters
    for (const bc of branchClusters) {
      bc.update(commitIdx, now);
    }
    mergeFX.animate(now);
```

- [ ] **Step 4: Wire the Branches toggle in settings**

Update the `setupSettings` call to add:

```ts
    onBranches: (b) => {
      for (const bc of branchClusters) bc.setVisible(b ? undefined as any : false);
      // If toggling back on, clusters will re-appear on next update via commitIdx check
    },
```

Actually, simpler approach — use a boolean flag:

```ts
  let branchesEnabled = true;
```

And in settings:

```ts
    onBranches: (b) => {
      branchesEnabled = b;
      if (!b) {
        for (const bc of branchClusters) bc.setVisible(false);
      }
    },
```

And guard the frame loop update:

```ts
    if (branchesEnabled) {
      for (const bc of branchClusters) {
        bc.update(commitIdx, now);
      }
    }
    mergeFX.animate(now);
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Test end-to-end**

1. Scan a repo with branches:
```bash
node src/cli/scan-repo.mjs /path/to/repo-with-branches public/data/repo.json
```

2. Start the dev server:
```bash
npm run dev
```

3. Open the viewer and verify:
   - Branch galaxies appear at the correct commit on the timeline
   - Ghostly rendering (transparent, tinted)
   - Dashed root-to-root link with energy particles
   - Merge animation fires at merge commits
   - Branches toggle works in settings
   - Branch markers visible on timeline track

- [ ] **Step 7: Commit**

```bash
git add src/viewer/main.ts
git commit -m "feat: wire branch clusters, merge FX, and settings into main loop"
```

---

### Task 11: Handle `branches` fallback in loader

**Files:**
- Modify: `src/viewer/data/loader.ts`

- [ ] **Step 1: Ensure backwards compatibility**

The loader auto-casts JSON, but old `repo.json` files won't have `branches`. Add a fallback:

```ts
export async function loadRepo(url: string): Promise<RepoData> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Impossible de charger ${url} (HTTP ${res.status}). Lance d'abord : npm run scan -- <chemin-du-repo>`,
    );
  }
  const data = await res.json();
  // Backwards compat: old repo.json files don't have branches
  if (!data.branches) data.branches = [];
  return data as RepoData;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/viewer/data/loader.ts
git commit -m "fix(loader): add branches fallback for backwards compatibility"
```
