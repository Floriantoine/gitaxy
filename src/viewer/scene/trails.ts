import {
  BufferGeometry,
  BufferAttribute,
  LineSegments,
  LineBasicMaterial,
  Color,
  AdditiveBlending,
  type Scene,
  type Vector3,
} from 'three';

/**
 * Anything that can leave a trail: needs a live `position` reference and a color.
 * Files pass `{ position: f.currentPosition, color: f.color }`,
 * dirs pass `{ position: d.position, color: d.color }`.
 */
export type TrailableItem = {
  position: Vector3;
  color: number;
  /** Commit index at which this item was born (for timeline gating). */
  bornAt: number;
};

/**
 * Trails behind moving items.
 *
 * One LineSegments for the whole batch: N items × (TRAIL_LENGTH-1) segments × 2 vertices.
 * Each item owns a ring buffer of recent positions; we shift it each frame and emit
 * segment pairs newest→oldest. Per-vertex color fades from base color (head) to dark (tail).
 */
const TRAIL_LENGTH = 12;

export type Trails = {
  /** Advance trail ring buffers. Items not yet born (bornAt > commitIdx) are skipped. */
  update(commitIdx: number): void;
  setEnabled(enabled: boolean): void;
  /** Reset every ring buffer to the current item position (no smear on toggle). */
  reset(): void;
};

export function createTrails(scene: Scene, items: TrailableItem[]): Trails {
  const n = items.length;
  const segPerItem = TRAIL_LENGTH - 1;
  const totalSegs = n * segPerItem;
  const positions = new Float32Array(totalSegs * 2 * 3);
  const colors = new Float32Array(totalSegs * 2 * 3);

  // Per-item ring buffer of past positions
  const rings: Float32Array[] = new Array(n);
  const ringHeads: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    rings[i] = new Float32Array(TRAIL_LENGTH * 3);
    const p = items[i].position;
    for (let k = 0; k < TRAIL_LENGTH; k++) {
      rings[i][k * 3] = p.x;
      rings[i][k * 3 + 1] = p.y;
      rings[i][k * 3 + 2] = p.z;
    }
  }

  // Pre-fill colors (won't change)
  const tmp = new Color();
  for (let i = 0; i < n; i++) {
    tmp.setHex(items[i].color);
    for (let s = 0; s < segPerItem; s++) {
      const segBase = (i * segPerItem + s) * 6;
      const aFrac = 1 - s / segPerItem;
      const bFrac = 1 - (s + 1) / segPerItem;
      colors[segBase + 0] = tmp.r * aFrac;
      colors[segBase + 1] = tmp.g * aFrac;
      colors[segBase + 2] = tmp.b * aFrac;
      colors[segBase + 3] = tmp.r * bFrac;
      colors[segBase + 4] = tmp.g * bFrac;
      colors[segBase + 5] = tmp.b * bFrac;
    }
  }

  const geo = new BufferGeometry();
  const posAttr = new BufferAttribute(positions, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  const mat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const lines = new LineSegments(geo, mat);
  scene.add(lines);

  const TELEPORT_THRESHOLD_SQ = 400; // 20 units — normal movement is < 2u/frame

  let enabled = true;

  function update(commitIdx: number) {
    if (!enabled) return;
    for (let i = 0; i < n; i++) {
      // Skip items not yet born — collapse their segments
      if (items[i].bornAt > commitIdx) {
        const p = items[i].position;
        for (let s = 0; s < segPerItem; s++) {
          const segBase = (i * segPerItem + s) * 6;
          positions[segBase] = positions[segBase + 3] = p.x;
          positions[segBase + 1] = positions[segBase + 4] = p.y;
          positions[segBase + 2] = positions[segBase + 5] = p.z;
        }
        continue;
      }
      const ring = rings[i];
      const head = ringHeads[i];
      const p = items[i].position;

      // Teleportation detection: if item jumped too far, reset its ring buffer
      // (catches spawn flights, scrub jumps, redistribution jumps)
      const lastIdx = (head - 1 + TRAIL_LENGTH) % TRAIL_LENGTH;
      const dx = p.x - ring[lastIdx * 3];
      const dy = p.y - ring[lastIdx * 3 + 1];
      const dz = p.z - ring[lastIdx * 3 + 2];
      if (dx * dx + dy * dy + dz * dz > TELEPORT_THRESHOLD_SQ) {
        for (let k = 0; k < TRAIL_LENGTH; k++) {
          ring[k * 3] = p.x;
          ring[k * 3 + 1] = p.y;
          ring[k * 3 + 2] = p.z;
        }
      }
      ring[head * 3] = p.x;
      ring[head * 3 + 1] = p.y;
      ring[head * 3 + 2] = p.z;
      ringHeads[i] = (head + 1) % TRAIL_LENGTH;

      for (let s = 0; s < segPerItem; s++) {
        const aIdx = (head - s + TRAIL_LENGTH * 2) % TRAIL_LENGTH;
        const bIdx = (head - s - 1 + TRAIL_LENGTH * 2) % TRAIL_LENGTH;
        const segBase = (i * segPerItem + s) * 6;
        positions[segBase + 0] = ring[aIdx * 3];
        positions[segBase + 1] = ring[aIdx * 3 + 1];
        positions[segBase + 2] = ring[aIdx * 3 + 2];
        positions[segBase + 3] = ring[bIdx * 3];
        positions[segBase + 4] = ring[bIdx * 3 + 1];
        positions[segBase + 5] = ring[bIdx * 3 + 2];
      }
    }
    posAttr.needsUpdate = true;
  }

  function reset() {
    for (let i = 0; i < n; i++) {
      const p = items[i].position;
      const ring = rings[i];
      for (let k = 0; k < TRAIL_LENGTH; k++) {
        ring[k * 3] = p.x;
        ring[k * 3 + 1] = p.y;
        ring[k * 3 + 2] = p.z;
      }
      ringHeads[i] = 0;
    }
  }

  return {
    update,
    setEnabled(b: boolean) {
      enabled = b;
      lines.visible = b;
    },
    reset,
  };
}
