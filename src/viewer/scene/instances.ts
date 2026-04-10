import {
  InstancedMesh,
  SphereGeometry,
  MeshBasicMaterial,
  AdditiveBlending,
  Matrix4,
  Vector3,
  Quaternion,
  Color,
  BufferGeometry,
  BufferAttribute,
  Points,
  PointsMaterial,
  CanvasTexture,
  type Scene,
} from 'three';
import type { FileNodeData } from './layout';
import type { SpawnParticles } from './spawn-particles';

const UNIT_SPHERE = new SphereGeometry(1, 6, 6);
const HALO_SPHERE = new SphereGeometry(2.5, 4, 4);
const IDENTITY_QUAT = new Quaternion();
const LARGE_REPO_THRESHOLD = 8000; // above this, use Points instead of InstancedMesh

/** Create a round dot texture for Points mode */
let _dotTex: CanvasTexture | null = null;
function dotTexture(): CanvasTexture {
  if (_dotTex) return _dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  _dotTex = new CanvasTexture(c);
  return _dotTex;
}

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
  fileMesh: InstancedMesh | Points;
  haloMesh: InstancedMesh | null;
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
  /** Force full position update next frame (e.g. during expansion). */
  markAllDirty(): void;
};

export function createFileInstances(
  scene: Scene,
  files: FileNodeData[],
  spawnParticles: SpawnParticles,
): FileInstances {
  const n = files.length;

  const usePoints = n > LARGE_REPO_THRESHOLD;
  console.log(`[instances] ${n} files → ${usePoints ? 'Points mode (perf)' : 'InstancedMesh mode (quality)'}`);

  // Per-file original colors (shared between both modes)
  const originalColors = new Float32Array(n * 3);
  const tmpColor = new Color();
  for (let i = 0; i < n; i++) {
    tmpColor.setHex(files[i].color);
    originalColors[i * 3] = tmpColor.r;
    originalColors[i * 3 + 1] = tmpColor.g;
    originalColors[i * 3 + 2] = tmpColor.b;
  }

  // --- Points mode: single draw call, minimal GPU cost ---
  let ptPositions: Float32Array | null = null;
  let ptColors: Float32Array | null = null;
  let ptSizes: Float32Array | null = null;
  let ptGeo: BufferGeometry | null = null;
  let ptMesh: Points | null = null;

  // --- InstancedMesh mode: better visual quality ---
  let fileMesh: InstancedMesh | null = null;
  let haloMesh: InstancedMesh | null = null;

  if (usePoints) {
    ptPositions = new Float32Array(n * 3);
    ptColors = new Float32Array(n * 3);
    ptSizes = new Float32Array(n);
    ptColors.set(originalColors);
    ptGeo = new BufferGeometry();
    ptGeo.setAttribute('position', new BufferAttribute(ptPositions, 3));
    ptGeo.setAttribute('color', new BufferAttribute(ptColors, 3));
    ptGeo.setAttribute('size', new BufferAttribute(ptSizes, 1));
    const ptMat = new PointsMaterial({
      vertexColors: true, transparent: true, opacity: 0.95,
      sizeAttenuation: true, size: 3.0, map: dotTexture(),
      depthWrite: false,
    });
    ptMesh = new Points(ptGeo, ptMat);
    ptMesh.frustumCulled = false;
    scene.add(ptMesh);
  } else {
    const fileMat = new MeshBasicMaterial();
    const haloMat = new MeshBasicMaterial({
      transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false,
    });
    fileMesh = new InstancedMesh(UNIT_SPHERE, fileMat, n);
    haloMesh = new InstancedMesh(HALO_SPHERE, haloMat, n);
    fileMesh.frustumCulled = false;
    haloMesh.frustumCulled = false;
    for (let i = 0; i < n; i++) {
      tmpColor.setHex(files[i].color);
      setFileColor(i, tmpColor);
    }
    if (fileMesh.instanceColor) fileMesh.instanceColor.needsUpdate = true;
    if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;
    const tmpMat = new Matrix4();
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
  }

  const raycastTarget = (usePoints ? ptMesh : fileMesh) as any;
  const tmpMat = new Matrix4();
  const tmpScale = new Vector3();

  /** Safe color setter — works for both Points (buffer) and InstancedMesh */
  function setFileColor(i: number, color: Color) {
    if (usePoints && ptColors) {
      ptColors[i * 3] = color.r;
      ptColors[i * 3 + 1] = color.g;
      ptColors[i * 3 + 2] = color.b;
    }
    if (fileMesh && 'setColorAt' in fileMesh) (fileMesh as InstancedMesh).setColorAt(i, color);
    if (haloMesh) (haloMesh as InstancedMesh).setColorAt(i, color);
  }

  // Per-instance state
  const hidden = new Uint8Array(n);
  const spawnStart = new Float32Array(n).fill(-1);
  const pulseStart = new Float32Array(n).fill(-1);
  const deleteStart = new Float32Array(n).fill(-1);
  const particleTriggered = new Uint8Array(n);
  let needsFullUpdate = true;

  // Active set: only files with pending animations are processed per frame.
  // All others keep their last matrix (static rendering via GPU).
  const activeSet = new Set<number>();

  function animate(nowMs: number) {
    let colorDirty = false;

    // Full update: process all visible files (after snap or init)
    if (needsFullUpdate) {
      needsFullUpdate = false;
      for (let i = 0; i < n; i++) {
        writeMatrix(i, files[i], nowMs, false);
      }
      markGPUDirty();
      return;
    }

    // Incremental: only process active files
    if (activeSet.size === 0) return;

    const toRemove: number[] = [];
    for (const i of activeSet) {
      const stillActive = writeMatrix(i, files[i], nowMs, true);
      if (!stillActive) toRemove.push(i);
    }
    for (const i of toRemove) activeSet.delete(i);

    if (activeSet.size > 0 || toRemove.length > 0) markGPUDirty();
    return;
  }

  function markGPUDirty() {
    if (usePoints && ptGeo) {
      (ptGeo.attributes.position as BufferAttribute).needsUpdate = true;
      (ptGeo.attributes.color as BufferAttribute).needsUpdate = true;
      (ptGeo.attributes.size as BufferAttribute).needsUpdate = true;
    }
    if (fileMesh) (fileMesh as InstancedMesh).instanceMatrix.needsUpdate = true;
    if (haloMesh) (haloMesh as InstancedMesh).instanceMatrix.needsUpdate = true;
  }

  /** Write matrix for file i. Returns true if file still needs per-frame updates. */
  function writeMatrix(i: number, f: FileNodeData, nowMs: number, trackColor: boolean): boolean {
    let colorDirty = false;
    let stillActive = false;

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
            setFileColor(i, tmpColor);
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
          setFileColor(i, tmpColor);
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
            setFileColor(i, tmpColor);
            colorDirty = true;
          }
        } else {
          pulseStart[i] = -1;
          const ci = i * 3;
          tmpColor.setRGB(originalColors[ci], originalColors[ci + 1], originalColors[ci + 2]);
          setFileColor(i, tmpColor);
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
          setFileColor(i, tmpColor);
          colorDirty = true;
        } else {
          // Done — hide the file
          deleteStart[i] = -1;
          hidden[i] = 1;
          scale = 0;
          const ci = i * 3;
          tmpColor.setRGB(originalColors[ci], originalColors[ci + 1], originalColors[ci + 2]);
          setFileColor(i, tmpColor);
          colorDirty = true;
        }
      }

      if (!vis) scale = 0;

      f.currentPosition.set(posX, posY, posZ);

      if (usePoints && ptPositions && ptSizes && ptColors) {
        // Points mode: write position + size + color to buffer attributes
        const base = i * 3;
        ptPositions[base] = posX;
        ptPositions[base + 1] = posY;
        ptPositions[base + 2] = posZ;
        ptSizes[i] = vis ? scale * 4 : 0; // point size proportional to file radius
        if (colorDirty) {
          ptColors[base] = tmpColor.r;
          ptColors[base + 1] = tmpColor.g;
          ptColors[base + 2] = tmpColor.b;
        }
      } else if (fileMesh && haloMesh) {
        // InstancedMesh mode: write matrix
        tmpScale.set(scale, scale, scale);
        tmpMat.makeTranslation(posX, posY, posZ);
        tmpMat.scale(tmpScale);
        fileMesh.setMatrixAt(i, tmpMat);
        haloMesh.setMatrixAt(i, tmpMat);
        if (trackColor && colorDirty) {
          if (fileMesh.instanceColor) fileMesh.instanceColor.needsUpdate = true;
          if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;
        }
      }

      if (spawnStart[i] >= 0 || pulseStart[i] >= 0 || deleteStart[i] >= 0) stillActive = true;
      return stillActive;
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
    activeSet.clear();
    needsFullUpdate = true; // force full matrix rebuild
    for (let i = 0; i < n; i++) {
      hidden[i] = isVisibleAt(files[i], commitIdx) ? 0 : 1;
      spawnStart[i] = -1;
      pulseStart[i] = -1;
      deleteStart[i] = -1;
      particleTriggered[i] = 0;
      const ci = i * 3;
      tmpColor.setRGB(originalColors[ci], originalColors[ci + 1], originalColors[ci + 2]);
      setFileColor(i, tmpColor);
    }
    markGPUDirty();
  }

  return {
    fileMesh: raycastTarget as InstancedMesh | Points,
    haloMesh: haloMesh,
    animate,
    fileByInstance: (id: number) => files[id],
    setHaloEnabled(enabled: boolean) { if (haloMesh) haloMesh.visible = enabled; },
    spawn(fileIdx: number, nowMs: number) {
      hidden[fileIdx] = 0;
      spawnStart[fileIdx] = nowMs;
      particleTriggered[fileIdx] = 0;
      activeSet.add(fileIdx);
    },
    pulse(fileIdx: number, nowMs: number) {
      if (hidden[fileIdx] === 1) {
        hidden[fileIdx] = 0;
        spawnStart[fileIdx] = nowMs;
        spawnParticles.trigger(files[fileIdx].currentPosition, files[fileIdx].color, nowMs);
        activeSet.add(fileIdx);
        return;
      }
      pulseStart[fileIdx] = nowMs;
      activeSet.add(fileIdx);
    },
    implode(fileIdx: number, nowMs: number) {
      deleteStart[fileIdx] = nowMs;
      spawnStart[fileIdx] = -1;
      pulseStart[fileIdx] = -1;
      particleTriggered[fileIdx] = 0;
      const f = files[fileIdx];
      spawnParticles.explode(f.currentPosition, f.color, nowMs + 150, f.radius);
      spawnParticles.explode(f.currentPosition, f.color, nowMs + 300, f.radius * 0.7);
      activeSet.add(fileIdx);
    },
    setHidden(fileIdx: number, isHidden: boolean) { hidden[fileIdx] = isHidden ? 1 : 0; },
    snapToCommit,
    markAllDirty() { needsFullUpdate = true; },
  };
}
