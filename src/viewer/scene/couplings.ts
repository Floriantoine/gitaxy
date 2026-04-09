import {
  Scene,
  BufferGeometry,
  BufferAttribute,
  LineSegments,
  LineBasicMaterial,
  AdditiveBlending,
  Color,
} from 'three';
import type { FileCoupling } from '../data/types';
import type { FileNodeData } from './layout';

export type Couplings = {
  /** Update line positions from live file positions. Call each frame. */
  update(): void;
  setEnabled(enabled: boolean): void;
};

/**
 * Coupling lines: glowing connections between files that are often modified together.
 * Brighter/thicker = stronger coupling. Uses additive blending for a "force field" look.
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

  // Resolve couplings to file index pairs + strength
  type ResolvedCoupling = { idxA: number; idxB: number; strength: number };
  const resolved: ResolvedCoupling[] = [];
  const maxCount = couplingData[0]?.count ?? 1;

  for (const c of couplingData) {
    const a = fileByPath.get(c.a);
    const b = fileByPath.get(c.b);
    if (a === undefined || b === undefined) continue;
    resolved.push({ idxA: a, idxB: b, strength: c.count / maxCount });
  }

  const n = resolved.length;
  const positions = new Float32Array(n * 6);
  const colors = new Float32Array(n * 6);

  // Pre-compute colors based on strength (warm gradient)
  const tmpColor = new Color();
  for (let i = 0; i < n; i++) {
    const s = resolved[i].strength;
    // Warm gradient: weak = faint purple, strong = bright gold
    tmpColor.setHSL(0.08 + (1 - s) * 0.15, 0.9, 0.3 + s * 0.4);
    const base = i * 6;
    colors[base] = tmpColor.r * s;
    colors[base + 1] = tmpColor.g * s;
    colors[base + 2] = tmpColor.b * s;
    colors[base + 3] = tmpColor.r * s;
    colors[base + 4] = tmpColor.g * s;
    colors[base + 5] = tmpColor.b * s;
  }

  const geo = new BufferGeometry();
  const posAttr = new BufferAttribute(positions, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  const mat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new LineSegments(geo, mat);
  mesh.renderOrder = -1; // render behind other elements
  scene.add(mesh);

  function update() {
    if (!mesh.visible) return;
    for (let i = 0; i < n; i++) {
      const c = resolved[i];
      const a = files[c.idxA].currentPosition;
      const b = files[c.idxB].currentPosition;
      const base = i * 6;
      positions[base] = a.x;
      positions[base + 1] = a.y;
      positions[base + 2] = a.z;
      positions[base + 3] = b.x;
      positions[base + 4] = b.y;
      positions[base + 5] = b.z;
    }
    posAttr.needsUpdate = true;
  }

  return {
    update,
    setEnabled(b) { mesh.visible = b; },
  };
}
