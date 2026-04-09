import { Vector3, Quaternion, Euler } from 'three';
import type { DirNode, FileNode, TreeNode } from '../data/types';
import { DIR_PALETTE, ROOT_COLOR, colorForFile, radiusFromFile } from './colors';

export type DirNodeData = {
  name: string;
  fullPath: string;
  position: Vector3;
  depth: number;
  color: number;
  fileCount: number; // recursive count
  parent: DirNodeData | null;
  // Orbit parameters (used when "Orbites dossiers" is enabled).
  // For root, these are zero/identity placeholders (root doesn't orbit).
  orbitRadius: number;
  orbitU: Vector3; // initial radial direction (unit) — orbit position at angle 0 = parent + r*u
  orbitV: Vector3; // perpendicular tangent (unit) — orbit position at angle π/2 = parent + r*v
  phase: number;
  /** Min commit index at which any descendant first appeared (for timeline visibility). */
  bornAt: number;
  /** Runtime flag: whether this dir is "expanded" (children spread wider). */
  _expanded?: boolean;
};

export type FileNodeData = {
  name: string;
  fullPath: string;
  size: number;
  color: number;
  radius: number;
  parent: DirNodeData;
  /** Distance from parent center on the orbit sphere. */
  orbitRadius: number;
  /** Commit index where this file first appeared. */
  bornAt: number;
  /** Sorted commit indices where this file was modified. */
  modifiedAt: number[];
  /** Commit indices where this file was deleted. */
  deletedAt: number[];
  // ----- Dynamic distribution (managed by distribution.ts) -----
  /** Index among siblings of same parent, sorted by bornAt. Set by distribution. */
  siblingIndex: number;
  /** Unit direction = current Fibonacci slot. Updated by distribution when N_visible changes. */
  targetDirection: Vector3;
  /** Smoothly lerps toward targetDirection each frame. */
  currentDirection: Vector3;
  /** World position = parent + currentDirection * orbitRadius. Updated each frame. */
  currentPosition: Vector3;
};

export type DirLink = { parent: DirNodeData; child: DirNodeData };

export type Layout = {
  dirs: DirNodeData[];
  files: FileNodeData[];
  /** Parent → child references for dir-dir lines (positions read live from data nodes). */
  dirLinks: DirLink[];
  /** Children index for fast subtree traversal during drag. */
  childrenMap: Map<DirNodeData, DirNodeData[]>;
  /** BFS order (parents before children) for the dir-orbit update pass. */
  dirOrder: DirNodeData[];
  /** Bounding radius of the whole layout (for camera fit). */
  boundsRadius: number;
};

/** Recursive count of files under a tree node. */
function countFiles(node: TreeNode): number {
  if (node.type === 'file') return 1;
  let n = 0;
  for (const c of node.children) n += countFiles(c);
  return n;
}

/** Place N points on a sphere (Fibonacci spiral). */
function fibonacciSphere(n: number, radius: number): Vector3[] {
  const points: Vector3[] = [];
  if (n === 0) return points;
  if (n === 1) {
    points.push(new Vector3(radius, 0, 0));
    return points;
  }
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    points.push(new Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius));
  }
  return points;
}

/**
 * Build a 3D layout from a directory tree.
 *
 * Sizing is **top-down** with depth-based formulas. Bottom-up tight packing was
 * tried earlier but explodes exponentially with depth (per-level multiplier ~3-5×
 * → bounds in the 100k+ range for normal repos). Top-down stays bounded.
 *
 * Layout rules:
 * - depth-based child radius (top-level dirs spread the most, deeper levels less)
 * - file orbit shell scales with sibling count (a dir with 500 files spreads more)
 * - per-depth tuning aims to keep sibling bubbles non-overlapping for typical repos
 */
export function buildLayout(tree: DirNode): Layout {
  const dirs: DirNodeData[] = [];
  const files: FileNodeData[] = [];
  const dirLinks: DirLink[] = [];
  const childrenMap = new Map<DirNodeData, DirNodeData[]>();

  // Mulberry32 — deterministic so the layout is stable across reloads.
  let seedState = 1;
  const rand = (): number => {
    seedState |= 0;
    seedState = (seedState + 0x6d2b79f5) | 0;
    let t = seedState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ----- Placement -----
  const root: DirNodeData = {
    name: tree.name || '/',
    fullPath: '/',
    position: new Vector3(0, 0, 0),
    depth: 0,
    color: ROOT_COLOR,
    fileCount: countFiles(tree),
    parent: null,
    orbitRadius: 0,
    orbitU: new Vector3(),
    orbitV: new Vector3(),
    phase: 0,
    bornAt: Number.POSITIVE_INFINITY, // computed below
  };
  dirs.push(root);

  /**
   * Depth-based child placement radius (top-down, bounded).
   * Bumped to accommodate the new dramatic dir sizes (cbrt scaling) and prevent
   * sibling halos from overlapping at any depth.
   */
  function childRadiusFor(parentDepth: number, parentRecursiveFileCount: number): number {
    const sqfc = Math.sqrt(parentRecursiveFileCount);
    if (parentDepth === 0) return 320 + sqfc * 4.5; // top-level galaxies
    if (parentDepth === 1) return 110 + sqfc * 2.6; // sub-dirs of top-level
    if (parentDepth === 2) return 58 + sqfc * 1.7;
    if (parentDepth === 3) return 34 + sqfc * 1.05;
    return 22 + sqfc * 0.7;
  }

  function place(node: DirNode, parent: DirNodeData, parentColor: number, parentPath: string) {
    const dirChildren = node.children.filter((c): c is DirNode => c.type === 'dir');
    const fileChildren = node.children.filter((c): c is FileNode => c.type === 'file');

    const childRadius = childRadiusFor(parent.depth, parent.fileCount);
    const positions = fibonacciSphere(dirChildren.length, childRadius);

    // Slight orientation jitter so subtrees aren't axis-aligned
    const orient = new Quaternion().setFromEuler(
      new Euler((rand() - 0.5) * 0.8, (rand() - 0.5) * 0.8, (rand() - 0.5) * 0.8),
    );
    positions.forEach((p) => p.applyQuaternion(orient));

    const childArr: DirNodeData[] = [];
    dirChildren.forEach((child, i) => {
      const localPos = positions[i];
      const worldPos = parent.position.clone().add(localPos);
      const color = parent.depth === 0 ? DIR_PALETTE[i % DIR_PALETTE.length] : parentColor;
      const childPath = parentPath === '/' ? '/' + child.name : parentPath + '/' + child.name;

      // Orbit basis: u = initial radial direction, v = perpendicular tangent
      // (random rotation in the plane perpendicular to u for visual variety).
      const orbitRadius = localPos.length();
      const u = localPos.clone().normalize();
      const tangentSeed = Math.abs(u.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
      const v0 = new Vector3().crossVectors(u, tangentSeed).normalize();
      const w0 = new Vector3().crossVectors(u, v0).normalize();
      const planeAngle = rand() * Math.PI * 2;
      const orbitV = v0.multiplyScalar(Math.cos(planeAngle)).addScaledVector(w0, Math.sin(planeAngle)).normalize();

      const dirNode: DirNodeData = {
        name: child.name,
        fullPath: childPath,
        position: worldPos,
        depth: parent.depth + 1,
        color,
        fileCount: countFiles(child),
        parent,
        orbitRadius,
        orbitU: u,
        orbitV,
        phase: 0,
        bornAt: Number.POSITIVE_INFINITY, // computed in post-order pass below
      };
      dirs.push(dirNode);
      childArr.push(dirNode);
      dirLinks.push({ parent, child: dirNode });
      place(child, dirNode, color, childPath);
    });
    if (childArr.length > 0) childrenMap.set(parent, childArr);

    // Files orbit their parent dir on MULTIPLE SHELLS (2-4 concentric layers).
    // Ensure files orbit OUTSIDE the dir's visual sphere (not inside it).
    const sibCount = fileChildren.length;
    const dirVisualRadius = 0.7 + Math.cbrt(Math.max(1, parent.fileCount)) * 1.2; // matches dirRadius()
    const fileOrbitBase = Math.max(dirVisualRadius + 3, 4 + Math.sqrt(sibCount) * 0.85);
    const shellCount = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(sibCount / 3))));

    fileChildren.forEach((file) => {
      const shell = Math.floor(rand() * shellCount);
      const shellFrac = shellCount <= 1 ? 0.5 : shell / (shellCount - 1);
      // Wider shell separation for visible concentric rings
      const shellRadius = fileOrbitBase * (0.35 + shellFrac * 1.3);
      const orbitRadius = shellRadius + (rand() - 0.5) * fileOrbitBase * 0.08;
      files.push({
        name: file.name,
        fullPath: parentPath === '/' ? '/' + file.name : parentPath + '/' + file.name,
        size: file.size,
        color: colorForFile(file.name),
        radius: radiusFromFile(file),
        parent,
        orbitRadius,
        bornAt: file.bornAt,
        modifiedAt: file.modifiedAt,
        deletedAt: file.deletedAt || [],
        // Populated by distribution.ts
        siblingIndex: 0,
        targetDirection: new Vector3(1, 0, 0),
        currentDirection: new Vector3(1, 0, 0),
        currentPosition: parent.position.clone(),
      });
    });
  }

  place(tree, root, ROOT_COLOR, '/');

  // ----- Compute dir bornAt as min of all descendants' bornAt -----
  // Walk dirs in REVERSE order (children before parents — since we appended
  // in pre-order DFS, reverse iteration is post-order-ish enough)
  // For each file, propagate bornAt up to its parent dir.
  for (const f of files) {
    if (f.bornAt < f.parent.bornAt) f.parent.bornAt = f.bornAt;
  }
  // For each dir, propagate its bornAt up to its parent.
  // Iterate from deepest to shallowest by sorting on depth descending.
  const dirsByDepthDesc = [...dirs].sort((a, b) => b.depth - a.depth);
  for (const d of dirsByDepthDesc) {
    if (d.parent && d.bornAt < d.parent.bornAt) {
      d.parent.bornAt = d.bornAt;
    }
  }
  // Edge case: leaf dir with no files → bornAt stays Infinity. Reset to 0.
  for (const d of dirs) {
    if (!Number.isFinite(d.bornAt)) d.bornAt = 0;
  }

  // ----- Bounds (max distance from origin to any dir, plus some padding) -----
  let boundsRadius = 0;
  for (const d of dirs) {
    const r = d.position.length();
    if (r > boundsRadius) boundsRadius = r;
  }
  boundsRadius += 30; // padding for files orbiting at the edge

  // ----- BFS order (parents before children) for the dir-orbit update pass -----
  const dirOrder: DirNodeData[] = [];
  {
    const queue: DirNodeData[] = [root];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      dirOrder.push(cur);
      const kids = childrenMap.get(cur);
      if (kids) queue.push(...kids);
    }
  }

  return { dirs, files, dirLinks, childrenMap, dirOrder, boundsRadius };
}
