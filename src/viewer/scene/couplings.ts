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
  /** Shared buffer: [x0,y0,z0, x1,y1,z1, ...] gravity offsets per file index. */
  offsetBuffer: Float32Array;
};

const GRAVITY_STRENGTH = 25.0;  // very strong pull
const DAMPING = 0.985;          // very slow decay — offsets accumulate more
const MAX_OFFSET = 150;         // allow large drift for cross-dir couplings

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
    return { update() {}, setEnabled() {}, offsetBuffer: new Float32Array(0) };
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

  // Shared buffer for gravity offsets (read by instances.animate)
  const offsetBuffer = new Float32Array(files.length * 3);
  // Internal working offsets
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
        } else {
          offsets[i].set(0, 0, 0);
        }
        const base = i * 3;
        offsetBuffer[base] = offsets[i].x;
        offsetBuffer[base + 1] = offsets[i].y;
        offsetBuffer[base + 2] = offsets[i].z;
      }
      return;
    }

    // 1. Decay all offsets (damping)
    for (let i = 0; i < files.length; i++) {
      offsets[i].multiplyScalar(DAMPING);
    }

    // 2. Apply gravitational attraction — CONSTANT force (no distance falloff)
    for (const c of resolved) {
      const a = files[c.idxA];
      const b = files[c.idxB];
      tmpDir.subVectors(b.currentPosition, a.currentPosition);
      const dist = tmpDir.length();
      if (dist < 1) continue;
      tmpDir.divideScalar(dist);
      // sqrt(strength) so weaker cross-dir couplings still produce visible pull
      const force = GRAVITY_STRENGTH * Math.sqrt(c.strength);
      tmpDir.multiplyScalar(force);
      offsets[c.idxA].add(tmpDir);
      offsets[c.idxB].sub(tmpDir);
    }

    // 3. Cap offsets
    for (let i = 0; i < files.length; i++) {
      const len = offsets[i].length();
      if (len > MAX_OFFSET) offsets[i].multiplyScalar(MAX_OFFSET / len);
    }

    // 4. Write to shared buffer (read by instances.animate via raw float indices)
    for (let i = 0; i < files.length; i++) {
      const base = i * 3;
      offsetBuffer[base] = offsets[i].x;
      offsetBuffer[base + 1] = offsets[i].y;
      offsetBuffer[base + 2] = offsets[i].z;
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
    offsetBuffer,
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
