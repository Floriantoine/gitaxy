import { Vector3, Quaternion, Euler } from 'three';
import type { FileNodeData, DirNodeData, Layout } from './layout';
import type { DirNodeRender } from './nodes';

/**
 * Dynamic multi-ring distribution for dirs AND files.
 *
 * Uses sphereDirections(N) recomputed when N changes. Existing items LERP
 * very slowly toward new positions (LERP_SPEED = 0.03 → ~2 sec for 90%).
 * New items snap to their target position for spawn flight accuracy.
 *
 * The slow lerp means existing items barely shift between each addition.
 * Over many additions they gradually organize but it's smooth — no teleportation.
 */

export type Distribution = {
  update(commitIdx: number): void;
  tick(): void;
  snap(commitIdx: number): void;
  getDirTarget(dir: DirNodeData): Vector3 | undefined;
  /** Expand a dir: its children spread wider (factor auto-computed from child count). */
  expandDir(dir: DirNodeData): void;
  /** Collapse a dir back to normal. */
  collapseDir(dir: DirNodeData): void;
};

const DIR_LERP = 0.04;  // slow: ~1.5 sec for 90%
const FILE_LERP = 0.04;

// ---- Fibonacci spiral distribution ----
// Each item j has a PERMANENT theta (golden angle × j). Only y changes with N.
// When N grows by 1: existing items shift vertically by tiny amounts. Zero lateral movement.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~2.3999 rad

/**
 * Direction for item j out of N total on a Fibonacci spiral sphere.
 * theta = j * golden_angle (permanent, never changes regardless of N)
 * y = evenly distributed from +1 to -1 based on (j, N)
 *
 * Adding one more item (N→N+1) only shifts y values slightly. Items change
 * "ring level" (up/down) but never jump laterally.
 */
/**
 * Direction for item j out of N, with per-dir shape variety.
 * @param flatness 0.2 = flat disc (like Saturn rings), 1.0 = full sphere
 */
/**
 * Direction for item j out of N.
 * - theta: golden angle (permanent per item, micro-wobble with N)
 * - y: quantized into discrete levels → visible concentric rings
 * - flatness: 0.25 = disc, 1.0 = sphere
 *
 * Combined with multi-shell orbit radii from layout.ts, this creates
 * layered structures: multiple horizontal rings at different heights,
 * each with files at different distances. Unique per-dir shape.
 */
/**
 * Direction for item j out of N, with per-dir shape variety.
 *
 * @param flatness  0.25 = flat, 1.0 = sphere
 * @param tiltAxis  unit vector: the "up" axis for this dir's ring stacking.
 *                  (0,1,0) = horizontal rings (default), (1,0,0) = vertical rings, etc.
 *                  Creates visual variety: some dirs have horizontal layers,
 *                  some vertical, some diagonal.
 */
function itemDirection(j: number, N: number, flatness: number, tiltAxis: Vector3): Vector3 {
  const theta = j * GOLDEN_ANGLE + Math.sin(N * 0.12 + j * 0.7) * 0.1;

  const levelCount = Math.max(1, Math.ceil(Math.sqrt(N / 8)));
  const level = j % levelCount;
  // Avoid poles: y stays in [-0.65, 0.65] so rings always have decent radius
  const levelY = levelCount <= 1 ? 0 : (level / (levelCount - 1)) * 1.3 - 0.65;
  const effectiveFlatness = Math.max(0.4, flatness);
  const spread = levelY * effectiveFlatness;

  // Build direction in tilt-local space, then rotate to world
  // "spread" is along tiltAxis, theta is around it
  const r = Math.sqrt(Math.max(0, 1 - spread * spread));

  // Build two perpendicular axes to tiltAxis
  const tangent = Math.abs(tiltAxis.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const u = new Vector3().crossVectors(tiltAxis, tangent).normalize();
  const v = new Vector3().crossVectors(tiltAxis, u).normalize();

  // Direction = spread * tiltAxis + r * (cos(theta) * u + sin(theta) * v)
  return new Vector3()
    .addScaledVector(tiltAxis, spread)
    .addScaledVector(u, Math.cos(theta) * r)
    .addScaledVector(v, Math.sin(theta) * r);
}

function hashFloat(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return ((h >>> 0) % 10000) / 10000;
}
function makeOrientation(): Quaternion {
  return new Quaternion().setFromEuler(new Euler(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
  ));
}

// ---- Types ----

type DirChildGroup = {
  parent: DirNodeData;
  children: DirNodeData[];
  radii: number[];
  orientation: Quaternion;
  flatness: number;
  tiltAxis: Vector3;        // ring stacking axis — varies per dir for shape diversity
  lastNVisible: number;
  currentDirs: Vector3[];
  targetDirs: Vector3[];
};

type FileGroup = {
  dir: DirNodeData;
  files: FileNodeData[];
  orientation: Quaternion;
  flatness: number;
  tiltAxis: Vector3;
  lastNVisible: number;
  _lastParentX: number;
  _lastParentY: number;
  _lastParentZ: number;
};

// ---- Main ----

export function createDistribution(layout: Layout, dirRenders: DirNodeRender[]): Distribution {
  const dirRenderMap = new Map<DirNodeData, DirNodeRender>();
  for (const r of dirRenders) dirRenderMap.set(r.data, r);
  const dirTargetPos = new Map<DirNodeData, Vector3>();

  // -- Dir child groups --
  const dirGroups: DirChildGroup[] = [];
  for (const parent of layout.dirOrder) {
    const children = layout.childrenMap.get(parent);
    if (!children || children.length === 0) continue;
    const sorted = [...children].sort((a, b) => a.bornAt - b.bornAt || a.name.localeCompare(b.name));
    const radii: number[] = [];
    const currentDirs: Vector3[] = [];
    const targetDirs: Vector3[] = [];
    for (const c of sorted) {
      const offset = new Vector3().subVectors(c.position, parent.position);
      const r = offset.length();
      radii.push(r);
      const dir = r > 0 ? offset.normalize() : new Vector3(1, 0, 0);
      currentDirs.push(dir.clone());
      targetDirs.push(dir.clone());
      dirTargetPos.set(c, c.position.clone());
    }
    // Random tilt axis + flatness — changes on each reload for variety
    const dirTilt = new Vector3(
      Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1,
    ).normalize();

    dirGroups.push({
      parent, children: sorted, radii,
      orientation: makeOrientation(),
      flatness: 0.25 + Math.random() * 0.75,
      tiltAxis: dirTilt,
      lastNVisible: -1, currentDirs, targetDirs,
    });
  }

  // -- File groups --
  const fileGroups: FileGroup[] = [];
  const fileBuckets = new Map<DirNodeData, FileNodeData[]>();
  for (const f of layout.files) {
    let arr = fileBuckets.get(f.parent);
    if (!arr) { arr = []; fileBuckets.set(f.parent, arr); }
    arr.push(f);
  }
  for (const [dir, files] of fileBuckets) {
    files.sort((a, b) => a.bornAt - b.bornAt || a.name.localeCompare(b.name));
    for (let i = 0; i < files.length; i++) files[i].siblingIndex = i;
    const fileTilt = new Vector3(
      Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1,
    ).normalize();

    fileGroups.push({
      dir, files,
      orientation: makeOrientation(),
      flatness: 0.25 + Math.random() * 0.75,
      tiltAxis: fileTilt,
      lastNVisible: -1,
      _lastParentX: NaN, _lastParentY: NaN, _lastParentZ: NaN,
    });
  }

  // ---- Dir update ----

  function updateDirs(commitIdx: number) {
    for (const g of dirGroups) {
      let nVis = 0;
      for (const c of g.children) {
        if (c.bornAt <= commitIdx) nVis++;
        else break;
      }
      if (nVis === g.lastNVisible) continue;
      const prevN = Math.max(0, g.lastNVisible);
      g.lastNVisible = nVis;
      for (let j = 0; j < nVis; j++) {
        const dir = itemDirection(j, nVis, g.flatness, g.tiltAxis).applyQuaternion(g.orientation);
        g.targetDirs[j].copy(dir);
        if (j >= prevN) g.currentDirs[j].copy(dir); // snap new dirs
      }
    }
  }

  // ---- File update ----

  function updateFiles(commitIdx: number) {
    for (const g of fileGroups) {
      let nVis = 0;
      for (const f of g.files) {
        if (f.bornAt <= commitIdx) nVis++;
        else break;
      }
      if (nVis === g.lastNVisible) continue;
      const prevN = Math.max(0, g.lastNVisible);
      g.lastNVisible = nVis;
      for (let j = 0; j < nVis; j++) {
        const dir = itemDirection(j, nVis, g.flatness, g.tiltAxis).applyQuaternion(g.orientation);
        g.files[j].targetDirection.copy(dir);
        if (j >= prevN) g.files[j].currentDirection.copy(dir); // snap new files
      }
    }
  }

  // ---- Tick: lerp toward targets + recompute world positions ----

  function tick() {
    tickExpansion(); // smooth lerp of expansion factors
    // Dirs: lerp currentDir toward target, weighted by descendant count
    // Heavy dirs (many sub-elements) barely move; light dirs shift easily
    for (const g of dirGroups) {
      for (let j = 0; j < g.lastNVisible; j++) {
        const child = g.children[j];
        const weight = 1 + Math.log10(Math.max(1, child.fileCount));
        const lerpSpeed = DIR_LERP / weight;
        g.currentDirs[j].lerp(g.targetDirs[j], lerpSpeed);
        const len = g.currentDirs[j].length();
        if (len > 1e-6) g.currentDirs[j].divideScalar(len);
        // World position
        // Apply expansion factor: expanded parent → children spread wider
        const expansion = getExpansion(g.parent);
        child.position.copy(g.parent.position).addScaledVector(g.currentDirs[j], g.radii[j] * expansion);
        const tp = dirTargetPos.get(child)!;
        tp.copy(g.parent.position).addScaledVector(g.targetDirs[j], g.radii[j] * expansion);
        // Mesh
        const r = dirRenderMap.get(child);
        if (r) r.mesh.position.copy(child.position);
      }
    }
    // Files: recompute position from parent.
    // Skip lerp if direction already at target. Skip position update if parent didn't move.
    for (const g of fileGroups) {
      const n = g.lastNVisible;
      if (n === 0) continue;
      const parentMoved = g.dir.position.x !== g._lastParentX || g.dir.position.y !== g._lastParentY || g.dir.position.z !== g._lastParentZ;
      (g as any)._lastParentX = g.dir.position.x;
      (g as any)._lastParentY = g.dir.position.y;
      (g as any)._lastParentZ = g.dir.position.z;
      const fileExpansion = getExpansion(g.dir);
      for (let j = 0; j < n; j++) {
        const f = g.files[j];
        const dx = f.targetDirection.x - f.currentDirection.x;
        const dy = f.targetDirection.y - f.currentDirection.y;
        const dz = f.targetDirection.z - f.currentDirection.z;
        const needsLerp = dx * dx + dy * dy + dz * dz > 0.0001;
        if (!needsLerp && !parentMoved) continue; // nothing changed → skip
        if (needsLerp) {
          f.currentDirection.lerp(f.targetDirection, FILE_LERP);
          const len = f.currentDirection.length();
          if (len > 1e-6) f.currentDirection.divideScalar(len);
        }
        f.currentPosition.copy(f.parent.position)
          .addScaledVector(f.currentDirection, f.orbitRadius * fileExpansion);
      }
    }
  }

  // ---- Snap ----

  function snap(commitIdx: number) {
    for (const g of dirGroups) {
      let nVis = 0;
      for (const c of g.children) {
        if (c.bornAt <= commitIdx) nVis++;
        else break;
      }
      g.lastNVisible = nVis;
      for (let j = 0; j < nVis; j++) {
        const dir = itemDirection(j, nVis, g.flatness, g.tiltAxis).applyQuaternion(g.orientation);
        g.targetDirs[j].copy(dir);
        g.currentDirs[j].copy(dir);
        const child = g.children[j];
        const snapExpansion = getExpansion(g.parent);
        child.position.copy(g.parent.position).addScaledVector(dir, g.radii[j] * snapExpansion);
        const tp = dirTargetPos.get(child)!;
        tp.copy(child.position);
        const r = dirRenderMap.get(child);
        if (r) r.mesh.position.copy(child.position);
      }
    }
    for (const g of fileGroups) {
      let nVis = 0;
      for (const f of g.files) {
        if (f.bornAt <= commitIdx) nVis++;
        else break;
      }
      g.lastNVisible = nVis;
      for (let j = 0; j < nVis; j++) {
        const dir = itemDirection(j, nVis, g.flatness, g.tiltAxis).applyQuaternion(g.orientation);
        g.files[j].targetDirection.copy(dir);
        g.files[j].currentDirection.copy(dir);
        const snapFileExp = getExpansion(g.files[j].parent);
        g.files[j].currentPosition.copy(g.files[j].parent.position)
          .addScaledVector(dir, g.files[j].orbitRadius * snapFileExp);
      }
    }
  }

  // Smooth expansion: target and current lerp independently
  const expandTarget = new Map<DirNodeData, number>();
  const expandCurrent = new Map<DirNodeData, number>();
  const EXPAND_LERP = 0.06;

  function getExpansion(dir: DirNodeData): number {
    return expandCurrent.get(dir) ?? 1;
  }

  /** Expand a dir AND all its descendants recursively. */
  function expandDir(dir: DirNodeData) {
    const queue: DirNodeData[] = [dir];
    while (queue.length > 0) {
      const d = queue.shift()!;
      // Density-based: small radius + many items = very compact = big expand
      // Visual spacing on a ring = 2πR / N. If too small, expand to reach target.
      const fc = Math.max(1, d.fileCount);
      const estimatedRadius = 4 + Math.sqrt(fc) * 0.85;
      const currentSpacing = 2 * Math.PI * estimatedRadius / Math.max(1, fc);
      const TARGET_SPACING = 10; // units between items when expanded
      const factor = Math.max(1.1, Math.min(3.5, TARGET_SPACING / currentSpacing));
      d._expanded = true;
      expandTarget.set(d, factor);
      if (!expandCurrent.has(d)) expandCurrent.set(d, 1);
      // Cascade to child dirs
      const kids = layout.childrenMap.get(d);
      if (kids) queue.push(...kids);
    }
  }

  /** Collapse a dir AND all its descendants recursively. */
  function collapseDir(dir: DirNodeData) {
    const queue: DirNodeData[] = [dir];
    while (queue.length > 0) {
      const d = queue.shift()!;
      d._expanded = false;
      expandTarget.set(d, 1);
      const kids = layout.childrenMap.get(d);
      if (kids) queue.push(...kids);
    }
  }

  function tickExpansion() {
    for (const [dir, target] of expandTarget) {
      const current = expandCurrent.get(dir) ?? 1;
      if (Math.abs(current - target) < 0.01) {
        expandCurrent.set(dir, target);
        if (target === 1) { expandTarget.delete(dir); expandCurrent.delete(dir); }
      } else {
        expandCurrent.set(dir, current + (target - current) * EXPAND_LERP);
      }
    }
  }

  snap(Infinity);

  return {
    update(commitIdx) { updateDirs(commitIdx); updateFiles(commitIdx); },
    tick,
    snap,
    getDirTarget(dir) { return dirTargetPos.get(dir); },
    expandDir,
    collapseDir,
  };
}
