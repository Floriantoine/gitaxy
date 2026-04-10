import {
  InstancedMesh,
  SphereGeometry,
  MeshBasicMaterial,
  AdditiveBlending,
  Matrix4,
  Vector3,
  Quaternion,
  Color,
  type Scene,
} from 'three';
import type { FileNodeData } from './layout';
import type { SpawnParticles } from './spawn-particles';

// Low-poly for perf on large repos (93K+ files)
const UNIT_SPHERE = new SphereGeometry(1, 6, 6);
const HALO_SPHERE = new SphereGeometry(2.5, 4, 4);
const IDENTITY_QUAT = new Quaternion();

/**
 * Spawn: particles converge (0–20%), file materializes + flies from parent to orbit (20–100%).
 * Kept short (800ms) so it's visible even at 5× playback speed.
 */
export const SPAWN_DURATION_MS = 800;
export const PULSE_DURATION_MS = 800;
export const DELETE_DURATION_MS = 600;
const FLIGHT_START = 0.15; // file starts materializing at 15% of spawn
const FLIGHT_END = 1.0;

export type FileInstances = {
  fileMesh: InstancedMesh;
  haloMesh: InstancedMesh;
  /** Update instance matrices from currentPosition + spawn/pulse modifiers. */
  animate(nowMs: number): void;
  fileByInstance(id: number): FileNodeData | undefined;
  setHaloEnabled(enabled: boolean): void;
  spawn(fileIdx: number, nowMs: number): void;
  pulse(fileIdx: number, nowMs: number): void;
  /** Trigger delete implosion (scale → 0 + red flash). File becomes hidden after. */
  implode(fileIdx: number, nowMs: number): void;
  setHidden(fileIdx: number, hidden: boolean): void;
  snapToCommit(commitIdx: number): void;
};

export function createFileInstances(
  scene: Scene,
  files: FileNodeData[],
  spawnParticles: SpawnParticles,
): FileInstances {
  const n = files.length;

  const fileMat = new MeshBasicMaterial();
  const haloMat = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.22,
    blending: AdditiveBlending,
    depthWrite: false,
  });

  const fileMesh = new InstancedMesh(UNIT_SPHERE, fileMat, n);
  const haloMesh = new InstancedMesh(HALO_SPHERE, haloMat, n);
  fileMesh.frustumCulled = false;
  haloMesh.frustumCulled = false;

  // Per-instance original colors
  const originalColors = new Float32Array(n * 3);
  const tmpColor = new Color();
  for (let i = 0; i < n; i++) {
    tmpColor.setHex(files[i].color);
    originalColors[i * 3] = tmpColor.r;
    originalColors[i * 3 + 1] = tmpColor.g;
    originalColors[i * 3 + 2] = tmpColor.b;
    fileMesh.setColorAt(i, tmpColor);
    haloMesh.setColorAt(i, tmpColor);
  }
  if (fileMesh.instanceColor) fileMesh.instanceColor.needsUpdate = true;
  if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;

  // Per-instance state
  const hidden = new Uint8Array(n);
  const spawnStart = new Float32Array(n).fill(-1);
  const pulseStart = new Float32Array(n).fill(-1);
  const deleteStart = new Float32Array(n).fill(-1);
  const particleTriggered = new Uint8Array(n); // 0 = not yet, 1 = done

  // Initial matrices
  const tmpMat = new Matrix4();
  const tmpScale = new Vector3();
  const zeroScale = new Vector3(0, 0, 0);
  for (let i = 0; i < n; i++) {
    tmpMat.compose(files[i].currentPosition, IDENTITY_QUAT, zeroScale);
    fileMesh.setMatrixAt(i, tmpMat);
    haloMesh.setMatrixAt(i, tmpMat);
  }
  fileMesh.instanceMatrix.needsUpdate = true;
  haloMesh.instanceMatrix.needsUpdate = true;

  scene.add(haloMesh);
  scene.add(fileMesh);

  /**
   * Called each frame AFTER distribution.tick() has updated currentPosition.
   * Applies spawn/pulse modifiers and writes instance matrices.
   */
  function animate(nowMs: number) {
    let colorDirty = false;

    for (let i = 0; i < n; i++) {
      const f = files[i];

      // FAST PATH: skip hidden files entirely (huge perf gain for timeline with many hidden)
      if (hidden[i] === 1 && spawnStart[i] < 0 && deleteStart[i] < 0) {
        // Only write matrix if file was recently hidden (not already zeroed)
        continue;
      }

      let scale = f.radius;
      let vis = true;

      let posX = f.currentPosition.x;
      let posY = f.currentPosition.y;
      let posZ = f.currentPosition.z;

      if (hidden[i] === 1) {
        vis = false;
        scale = 0;
        posX = f.parent.position.x;
        posY = f.parent.position.y;
        posZ = f.parent.position.z;
      }

      // ----- Spawn: Sparkle Converge + flight from parent -----
      if (spawnStart[i] >= 0) {
        const elapsed = nowMs - spawnStart[i];
        if (elapsed < 0) {
          // Waiting for stagger delay — position at parent (zero-length tether)
          scale = 0;
          vis = false;
          posX = f.parent.position.x;
          posY = f.parent.position.y;
          posZ = f.parent.position.z;
        } else if (elapsed < SPAWN_DURATION_MS) {
          vis = true;
          const t01 = elapsed / SPAWN_DURATION_MS;

          // Trigger particles on first active frame
          if (particleTriggered[i] === 0) {
            spawnParticles.trigger(f.currentPosition, f.color, nowMs);
            particleTriggered[i] = 1;
          }

          if (t01 < FLIGHT_START) {
            // File invisible while particles are converging
            scale = 0;
            // Position stays at parent (for tether drawing)
            posX = f.parent.position.x;
            posY = f.parent.position.y;
            posZ = f.parent.position.z;
          } else {
            // File materializes + flies from parent to orbit position
            const flightT = (t01 - FLIGHT_START) / (FLIGHT_END - FLIGHT_START);
            const eased = 1 - Math.pow(1 - flightT, 3); // ease-out cubic

            // Scale: grow with slight overshoot
            const overshoot = flightT < 0.5 ? 1 + flightT * 0.6 : 1.3 - (flightT - 0.5) * 0.6;
            scale = f.radius * eased * overshoot;

            // Position: lerp from parent center to orbit position
            const orbitX = f.currentPosition.x;
            const orbitY = f.currentPosition.y;
            const orbitZ = f.currentPosition.z;
            posX = f.parent.position.x + (orbitX - f.parent.position.x) * eased;
            posY = f.parent.position.y + (orbitY - f.parent.position.y) * eased;
            posZ = f.parent.position.z + (orbitZ - f.parent.position.z) * eased;

            // White flash during appearance
            const colorT = flightT;
            const ci = i * 3;
            tmpColor.setRGB(
              1 - (1 - originalColors[ci]) * colorT,
              1 - (1 - originalColors[ci + 1]) * colorT,
              1 - (1 - originalColors[ci + 2]) * colorT,
            );
            fileMesh.setColorAt(i, tmpColor);
            haloMesh.setColorAt(i, tmpColor);
            colorDirty = true;
          }
        } else {
          // Spawn complete
          spawnStart[i] = -1;
          particleTriggered[i] = 0;
          vis = true;
          scale = f.radius;
          const ci = i * 3;
          tmpColor.setRGB(originalColors[ci], originalColors[ci + 1], originalColors[ci + 2]);
          fileMesh.setColorAt(i, tmpColor);
          haloMesh.setColorAt(i, tmpColor);
          colorDirty = true;
        }
      }

      // ----- Pulse: big wobble + white flash -----
      if (pulseStart[i] >= 0) {
        const elapsed = nowMs - pulseStart[i];
        if (elapsed < PULSE_DURATION_MS) {
          const t01 = elapsed / PULSE_DURATION_MS;
          const wobble = 1 + Math.sin(t01 * Math.PI) * 1.5;
          scale *= wobble;
          const colorFlash = Math.max(0, 1 - t01 * 3);
          if (colorFlash > 0) {
            const ci = i * 3;
            tmpColor.setRGB(
              originalColors[ci] + (1 - originalColors[ci]) * colorFlash,
              originalColors[ci + 1] + (1 - originalColors[ci + 1]) * colorFlash,
              originalColors[ci + 2] + (1 - originalColors[ci + 2]) * colorFlash,
            );
            fileMesh.setColorAt(i, tmpColor);
            haloMesh.setColorAt(i, tmpColor);
            colorDirty = true;
          }
        } else {
          pulseStart[i] = -1;
          const ci = i * 3;
          tmpColor.setRGB(originalColors[ci], originalColors[ci + 1], originalColors[ci + 2]);
          fileMesh.setColorAt(i, tmpColor);
          haloMesh.setColorAt(i, tmpColor);
          colorDirty = true;
        }
      }

      // ----- Delete implosion: shrink to 0 + red flash -----
      if (deleteStart[i] >= 0) {
        const elapsed = nowMs - deleteStart[i];
        if (elapsed < DELETE_DURATION_MS) {
          const t01 = elapsed / DELETE_DURATION_MS;
          // Scale shrinks with acceleration (ease-in)
          scale *= Math.max(0, 1 - t01 * t01);
          // Red flash
          const ci = i * 3;
          tmpColor.setRGB(
            1,
            originalColors[ci + 1] * (1 - t01),
            originalColors[ci + 2] * (1 - t01),
          );
          fileMesh.setColorAt(i, tmpColor);
          haloMesh.setColorAt(i, tmpColor);
          colorDirty = true;
        } else {
          // Done — hide the file
          deleteStart[i] = -1;
          hidden[i] = 1;
          scale = 0;
          const ci = i * 3;
          tmpColor.setRGB(originalColors[ci], originalColors[ci + 1], originalColors[ci + 2]);
          fileMesh.setColorAt(i, tmpColor);
          haloMesh.setColorAt(i, tmpColor);
          colorDirty = true;
        }
      }

      if (!vis) scale = 0;

      // Write-back position so tethers/trails follow the flight, not the orbit target
      f.currentPosition.set(posX, posY, posZ);

      tmpScale.set(scale, scale, scale);
      tmpMat.makeTranslation(posX, posY, posZ);
      tmpMat.scale(tmpScale);
      fileMesh.setMatrixAt(i, tmpMat);
      haloMesh.setMatrixAt(i, tmpMat);
    }

    fileMesh.instanceMatrix.needsUpdate = true;
    haloMesh.instanceMatrix.needsUpdate = true;
    if (colorDirty) {
      if (fileMesh.instanceColor) fileMesh.instanceColor.needsUpdate = true;
      if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;
    }
  }

  /** Check if a file is visible at a given commit. Fast path for files without deletes. */
  function isVisibleAt(f: FileNodeData, commitIdx: number): boolean {
    if (f.bornAt > commitIdx) return false;
    // Fast path: no delete events (vast majority of files)
    if (f.deletedAt.length === 0) return true;
    // Find the last event type before commitIdx
    let alive = true;
    // Walk deletedAt and modifiedAt in order (both are sorted)
    let di = 0, mi = 0;
    while (di < f.deletedAt.length || mi < f.modifiedAt.length) {
      const nextDel = di < f.deletedAt.length ? f.deletedAt[di] : Infinity;
      const nextMod = mi < f.modifiedAt.length ? f.modifiedAt[mi] : Infinity;
      const next = Math.min(nextDel, nextMod);
      if (next > commitIdx) break;
      alive = next !== nextDel; // true if mod, false if del
      if (next === nextDel) di++;
      if (next === nextMod) mi++;
    }
    return alive;
  }

  function snapToCommit(commitIdx: number) {
    for (let i = 0; i < n; i++) {
      hidden[i] = isVisibleAt(files[i], commitIdx) ? 0 : 1;
      spawnStart[i] = -1;
      pulseStart[i] = -1;
      deleteStart[i] = -1;
      particleTriggered[i] = 0;
      const ci = i * 3;
      tmpColor.setRGB(originalColors[ci], originalColors[ci + 1], originalColors[ci + 2]);
      fileMesh.setColorAt(i, tmpColor);
      haloMesh.setColorAt(i, tmpColor);
    }
    if (fileMesh.instanceColor) fileMesh.instanceColor.needsUpdate = true;
    if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;
  }

  return {
    fileMesh,
    haloMesh,
    animate,
    fileByInstance: (id: number) => files[id],
    setHaloEnabled(enabled: boolean) { haloMesh.visible = enabled; },
    spawn(fileIdx: number, nowMs: number) {
      hidden[fileIdx] = 0;
      spawnStart[fileIdx] = nowMs;
      particleTriggered[fileIdx] = 0;
    },
    pulse(fileIdx: number, nowMs: number) {
      // If file was deleted (hidden), treat pulse as re-creation (spawn)
      if (hidden[fileIdx] === 1) {
        hidden[fileIdx] = 0;
        spawnStart[fileIdx] = nowMs;
        spawnParticles.trigger(files[fileIdx].currentPosition, files[fileIdx].color, nowMs);
        return;
      }
      pulseStart[fileIdx] = nowMs;
    },
    implode(fileIdx: number, nowMs: number) {
      deleteStart[fileIdx] = nowMs;
      spawnStart[fileIdx] = -1;    // cancel any pending spawn
      pulseStart[fileIdx] = -1;    // cancel any pending pulse
      particleTriggered[fileIdx] = 0;
      const f = files[fileIdx];
      spawnParticles.explode(f.currentPosition, f.color, nowMs + 150, f.radius);
      spawnParticles.explode(f.currentPosition, f.color, nowMs + 300, f.radius * 0.7);
    },
    setHidden(fileIdx: number, isHidden: boolean) { hidden[fileIdx] = isHidden ? 1 : 0; },
    snapToCommit,
  };
}
