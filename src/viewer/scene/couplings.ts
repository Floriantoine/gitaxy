import {
  Scene,
  BufferGeometry,
  BufferAttribute,
  LineSegments,
  LineBasicMaterial,
  AdditiveBlending,
  Color,
  Vector3,
} from 'three';
import type { FileCoupling } from '../data/types';
import type { FileNodeData } from './layout';

export type Couplings = {
  /** Apply gravitational attraction + update line positions. Call each frame. */
  update(): void;
  setEnabled(enabled: boolean): void;
};

const GRAVITY_STRENGTH = 6.0;   // strong constant pull (no distance scaling)
const DAMPING = 0.97;           // slow decay — offsets persist
const MAX_OFFSET = 60;          // cap: files can't drift more than 60 units from base

/**
 * File couplings: gravitational attraction between files often modified together.
 *
 * Each coupled pair pulls toward each other with force proportional to
 * coupling strength. Files accumulate a `gravityOffset` that shifts their
 * rendered position. The offset decays each frame (damping) so files
 * spring back when coupling is disabled.
 *
 * Also draws subtle connection lines between coupled files.
 */
export function createCouplings(
  scene: Scene,
  couplingData: FileCoupling[],
  files: FileNodeData[],
): Couplings {
  if (couplingData.length === 0) {
    return { update() {}, setEnabled() {} };
  }

  // Build path → file index map
  const fileByPath = new Map<string, number>();
  for (let i = 0; i < files.length; i++) {
    const p = files[i].fullPath.startsWith('/') ? files[i].fullPath.slice(1) : files[i].fullPath;
    fileByPath.set(p, i);
  }

  // Resolve couplings
  type Resolved = { idxA: number; idxB: number; strength: number };
  const resolved: Resolved[] = [];
  const maxCount = couplingData[0]?.count ?? 1;
  for (const c of couplingData) {
    const a = fileByPath.get(c.a);
    const b = fileByPath.get(c.b);
    if (a === undefined || b === undefined) continue;
    resolved.push({ idxA: a, idxB: b, strength: c.count / maxCount });
  }

  // Per-file gravity offset (accumulated each frame, decayed)
  const offsets: Vector3[] = new Array(files.length);
  for (let i = 0; i < files.length; i++) offsets[i] = new Vector3();

  // Connection lines
  const n = resolved.length;
  const positions = new Float32Array(n * 6);
  const colors = new Float32Array(n * 6);
  const tmpColor = new Color();

  for (let i = 0; i < n; i++) {
    const s = resolved[i].strength;
    tmpColor.setHSL(0.08, 0.9, 0.3 + s * 0.4);
    const b = 0.2 + s * 0.6;
    const base = i * 6;
    colors[base] = colors[base + 3] = tmpColor.r * b;
    colors[base + 1] = colors[base + 4] = tmpColor.g * b;
    colors[base + 2] = colors[base + 5] = tmpColor.b * b;
  }

  const geo = new BufferGeometry();
  const posAttr = new BufferAttribute(positions, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  const linesMesh = new LineSegments(geo, new LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.5,
    blending: AdditiveBlending, depthWrite: false,
  }));
  linesMesh.renderOrder = 998;
  scene.add(linesMesh);

  let enabled = false;
  const tmpDir = new Vector3();

  function update() {
    if (!enabled) {
      // Decay offsets back to zero when disabled
      for (let i = 0; i < files.length; i++) {
        if (offsets[i].lengthSq() > 0.001) {
          offsets[i].multiplyScalar(0.9);
          files[i].currentPosition.add(offsets[i]);
        }
      }
      return;
    }

    // 1. Decay all offsets (damping)
    for (let i = 0; i < files.length; i++) {
      offsets[i].multiplyScalar(DAMPING);
    }

    // 2. Apply gravitational attraction — CONSTANT force (no distance falloff)
    //    so even files across the constellation visibly attract
    for (const c of resolved) {
      const a = files[c.idxA];
      const b = files[c.idxB];
      tmpDir.subVectors(b.currentPosition, a.currentPosition);
      const dist = tmpDir.length();
      if (dist < 1) continue; // same position, skip
      tmpDir.divideScalar(dist); // normalize
      const force = GRAVITY_STRENGTH * c.strength;
      tmpDir.multiplyScalar(force);
      offsets[c.idxA].add(tmpDir);
      offsets[c.idxB].sub(tmpDir);
    }

    // 3. Cap offsets to prevent files from flying too far from base position
    for (let i = 0; i < files.length; i++) {
      const len = offsets[i].length();
      if (len > MAX_OFFSET) offsets[i].multiplyScalar(MAX_OFFSET / len);
    }

    // 4. Apply offsets to file positions
    for (let i = 0; i < files.length; i++) {
      if (offsets[i].lengthSq() > 0.01) {
        files[i].currentPosition.add(offsets[i]);
      }
    }

    // 4. Update connection lines
    for (let i = 0; i < n; i++) {
      const a = files[resolved[i].idxA].currentPosition;
      const b = files[resolved[i].idxB].currentPosition;
      const base = i * 6;
      positions[base] = a.x; positions[base + 1] = a.y; positions[base + 2] = a.z;
      positions[base + 3] = b.x; positions[base + 4] = b.y; positions[base + 5] = b.z;
    }
    posAttr.needsUpdate = true;
  }

  return {
    update,
    setEnabled(b) {
      enabled = b;
      linesMesh.visible = b;
      if (!b) {
        // Reset offsets gradually (damping will handle it)
        for (const o of offsets) o.multiplyScalar(0.5);
      }
    },
  };
}
