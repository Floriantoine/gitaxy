import type { Layout, DirNodeData } from './layout';
import type { DirNodeRender } from './nodes';

export type DirOrbits = {
  /** Recompute dir positions from orbit parameters. Call each frame. */
  update(t: number): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
};

/**
 * Angular speed scales with **depth** so deep dirs spin visibly faster than
 * top-level dirs (which is what you'd intuitively expect — leaves are dynamic,
 * top-level galaxies drift slowly).
 *
 * angular_speed(depth) = BASE × depth
 *  - depth 1 (top-level) → 0.04 rad/s (~157 sec per orbit)
 *  - depth 5 (deep)      → 0.20 rad/s (~31 sec per orbit, 5× faster)
 */
const BASE_ANGULAR_SPEED = 0.04;

/**
 * Recursive solar-system orbits for directories.
 *
 * Each non-root dir orbits its parent in a fixed plane (defined at layout time
 * by `orbitU` / `orbitV`) with a constant angular speed. The update walks dirs
 * in BFS order so each child uses its parent's already-updated position →
 * nested solar systems work correctly.
 *
 * Files automatically follow because their position is computed from
 * `parent.position` each frame in `instances.animate()`.
 */
export function createDirOrbits(layout: Layout, dirRenders: DirNodeRender[]): DirOrbits {
  const order = layout.dirOrder;
  const renderByData = new Map<DirNodeData, DirNodeRender>();
  for (const r of dirRenders) renderByData.set(r.data, r);

  let enabled = false;

  return {
    update(t: number) {
      if (!enabled) return;
      for (const d of order) {
        if (d.parent === null) continue; // root doesn't orbit
        const angle = d.phase + t * BASE_ANGULAR_SPEED * d.depth;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        d.position
          .copy(d.parent.position)
          .addScaledVector(d.orbitU, cos * d.orbitRadius)
          .addScaledVector(d.orbitV, sin * d.orbitRadius);
        const r = renderByData.get(d);
        if (r) r.mesh.position.copy(d.position);
      }
    },
    setEnabled(b: boolean) {
      enabled = b;
    },
    isEnabled() {
      return enabled;
    },
  };
}
