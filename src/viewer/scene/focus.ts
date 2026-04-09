import { Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { DirNodeData } from './layout';

export type FocusController = {
  /** Animate the camera toward a directory and start tracking it. */
  focusOn(dir: DirNodeData, distMultiplier?: number): void;
  /** Stop following the current target (called on background click / Escape). */
  clearTracking(): void;
  /** Call each frame to advance the animation and the follow logic. */
  tick(): void;
  isAnimating(): boolean;
  isTracking(): boolean;
  getTrackedDir(): DirNodeData | null;
};

const DURATION_MS = 700;

/**
 * Smooth camera focus animation toward a directory + persistent follow mode.
 *
 * After the focus animation lands, the controller keeps `controls.target` glued
 * to the dir's current position each frame, and slides `camera.position` by the
 * same delta so the relative offset stays constant. The user can rotate freely
 * around the (moving) target with OrbitControls.
 *
 * Pan is disabled while tracking (it would conflict with the follow update).
 * Tracking is released by `clearTracking()` (background click or Escape).
 */
export function createFocusController(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  layoutBoundsRadius: number,
): FocusController {
  type Anim = {
    fromPos: Vector3;
    toPos: Vector3;
    fromTarget: Vector3;
    toTarget: Vector3;
    startTime: number;
  };
  let anim: Anim | null = null;

  let tracked: DirNodeData | null = null;
  const lastTrackedPos = new Vector3();
  let justStartedTracking = false;

  function distanceFor(dir: DirNodeData): number {
    if (dir.depth === 0) return Math.max(400, layoutBoundsRadius * 1.4);
    if (dir.depth === 1) return 220 + Math.sqrt(Math.max(1, dir.fileCount)) * 6;
    if (dir.depth === 2) return 90 + Math.sqrt(Math.max(1, dir.fileCount)) * 4;
    return 50 + Math.sqrt(Math.max(1, dir.fileCount)) * 3;
  }

  function focusOn(dir: DirNodeData, distMultiplier = 1) {
    const dist = Math.max(40, distanceFor(dir) * distMultiplier);
    const dir2cam = camera.position.clone().sub(controls.target);
    if (dir2cam.lengthSq() < 1e-6) dir2cam.set(1, 0.6, 1);
    dir2cam.normalize().multiplyScalar(dist);
    const newCamPos = dir.position.clone().add(dir2cam);

    anim = {
      fromPos: camera.position.clone(),
      toPos: newCamPos,
      fromTarget: controls.target.clone(),
      toTarget: dir.position.clone(),
      startTime: performance.now(),
    };

    tracked = dir;
    justStartedTracking = true;
    controls.enablePan = false; // pan would fight the follow update
  }

  function clearTracking() {
    tracked = null;
    justStartedTracking = false;
    controls.enablePan = true;
  }

  function tick() {
    if (anim) {
      const elapsed = performance.now() - anim.startTime;
      const t = Math.min(1, elapsed / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      camera.position.lerpVectors(anim.fromPos, anim.toPos, eased);
      controls.target.lerpVectors(anim.fromTarget, anim.toTarget, eased);
      if (t >= 1) anim = null;
      return;
    }

    // No animation in progress — handle tracking (camera follows the moving dir)
    if (tracked) {
      if (justStartedTracking) {
        lastTrackedPos.copy(tracked.position);
        justStartedTracking = false;
        return;
      }
      const dx = tracked.position.x - lastTrackedPos.x;
      const dy = tracked.position.y - lastTrackedPos.y;
      const dz = tracked.position.z - lastTrackedPos.z;
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        camera.position.x += dx;
        camera.position.y += dy;
        camera.position.z += dz;
        controls.target.x += dx;
        controls.target.y += dy;
        controls.target.z += dz;
        lastTrackedPos.copy(tracked.position);
      }
    }
  }

  return {
    focusOn,
    clearTracking,
    tick,
    isAnimating: () => anim !== null,
    isTracking: () => tracked !== null,
    getTrackedDir: () => tracked,
  };
}
