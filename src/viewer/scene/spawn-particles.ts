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

const PARTICLES_PER_SPAWN = 8;
const MAX_CONCURRENT_SPAWNS = 48;
const POOL_SIZE = PARTICLES_PER_SPAWN * MAX_CONCURRENT_SPAWNS; // 384
const CONVERGE_DURATION_MS = 500; // fast enough to be visible at 5× speed

const IDENTITY_Q = new Quaternion();
const ZERO_POS = new Vector3();
const ZERO_SCALE = new Vector3(0, 0, 0);

export type SpawnParticles = {
  /** Converging sparkles (for file creation). */
  trigger(posRef: Vector3, color: number, nowMs: number): void;
  /** Exploding sparkles (for file deletion) — particles scatter OUTWARD. size = visual radius of the item. */
  explode(posRef: Vector3, color: number, nowMs: number, size?: number): void;
  /** Update all active particle positions. Call each frame. */
  animate(nowMs: number): void;
};

type ParticleGroup = {
  startIdx: number;
  targetRef: Vector3;
  startTime: number;
  dirs: Vector3[];
  dists: number[];
  mode: 'converge' | 'scatter';
};

export function createSpawnParticles(scene: Scene): SpawnParticles {
  const geo = new SphereGeometry(0.7, 6, 6); // big fat sparkles
  const mat = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new InstancedMesh(geo, mat, POOL_SIZE);
  mesh.frustumCulled = false;

  // All particles start hidden (scale 0)
  const hideMat = new Matrix4();
  hideMat.compose(ZERO_POS, IDENTITY_Q, ZERO_SCALE);
  for (let i = 0; i < POOL_SIZE; i++) {
    mesh.setMatrixAt(i, hideMat);
  }
  mesh.instanceMatrix.needsUpdate = true;

  // Default color white
  const tmpColor = new Color(1, 1, 1);
  for (let i = 0; i < POOL_SIZE; i++) {
    mesh.setColorAt(i, tmpColor);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  scene.add(mesh);

  const activeGroups: ParticleGroup[] = [];
  let nextPoolIdx = 0;

  const tmpMat = new Matrix4();
  const tmpPos = new Vector3();
  const tmpScale = new Vector3();

  function trigger(posRef: Vector3, color: number, nowMs: number) {
    const startIdx = nextPoolIdx;
    nextPoolIdx = (nextPoolIdx + PARTICLES_PER_SPAWN) % POOL_SIZE;

    // Bright sparkle color = file color blended toward white
    tmpColor.setHex(color);
    tmpColor.r = tmpColor.r * 0.35 + 0.65;
    tmpColor.g = tmpColor.g * 0.35 + 0.65;
    tmpColor.b = tmpColor.b * 0.35 + 0.65;
    for (let i = 0; i < PARTICLES_PER_SPAWN; i++) {
      mesh.setColorAt(startIdx + i, tmpColor);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const dirs: Vector3[] = [];
    const dists: number[] = [];
    for (let i = 0; i < PARTICLES_PER_SPAWN; i++) {
      dirs.push(
        new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      );
      dists.push(6 + Math.random() * 10); // wider spread for visibility
    }

    activeGroups.push({ startIdx, targetRef: posRef, startTime: nowMs, dirs, dists, mode: 'converge' as const });
  }

  const SCATTER_DURATION_MS = 1000; // longer so the explosion lingers

  function explode(posRef: Vector3, _color: number, nowMs: number, size = 1) {
    // More particles for bigger items (3-6 groups of 8)
    const groupCount = Math.max(3, Math.min(6, Math.ceil(size * 3)));
    const scatterDist = 12 + size * 18; // bigger items scatter further

    for (let g = 0; g < groupCount; g++) {
      const startIdx = nextPoolIdx;
      nextPoolIdx = (nextPoolIdx + PARTICLES_PER_SPAWN) % POOL_SIZE;

      // PURE RED sparkles for deletion
      tmpColor.setRGB(1.0, 0.15, 0.05);
      for (let i = 0; i < PARTICLES_PER_SPAWN; i++) {
        mesh.setColorAt(startIdx + i, tmpColor);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      const dirs: Vector3[] = [];
      const dists: number[] = [];
      for (let i = 0; i < PARTICLES_PER_SPAWN; i++) {
        dirs.push(new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize());
        dists.push(scatterDist * (0.5 + Math.random()));
      }

      // Stagger each group slightly for a cascading explosion feel
      activeGroups.push({
        startIdx, targetRef: posRef,
        startTime: nowMs + g * 60, // 60ms between explosion waves
        dirs, dists, mode: 'scatter' as const,
      });
    }
  }

  function animate(nowMs: number) {
    let dirty = false;

    for (let g = activeGroups.length - 1; g >= 0; g--) {
      const group = activeGroups[g];
      const elapsed = nowMs - group.startTime;

      if (elapsed < 0) {
        // Waiting for stagger delay — particles hidden
        continue;
      }

      const duration = group.mode === 'scatter' ? SCATTER_DURATION_MS : CONVERGE_DURATION_MS;

      if (elapsed > duration) {
        for (let i = 0; i < PARTICLES_PER_SPAWN; i++) {
          hideMat.compose(ZERO_POS, IDENTITY_Q, ZERO_SCALE);
          mesh.setMatrixAt(group.startIdx + i, hideMat);
        }
        activeGroups.splice(g, 1);
        dirty = true;
        continue;
      }

      const t01 = elapsed / duration;

      if (group.mode === 'scatter') {
        // SCATTER: particles fly OUTWARD from center (deletion effect)
        const expand = t01 * t01; // ease-in: accelerate outward
        const particleScale = 0.6 * Math.max(0, 1 - t01 * 0.7); // big + shrink slowly

        for (let i = 0; i < PARTICLES_PER_SPAWN; i++) {
          const dist = expand * group.dists[i];
          tmpPos.copy(group.targetRef).addScaledVector(group.dirs[i], dist);
          tmpScale.set(particleScale, particleScale, particleScale);
          tmpMat.compose(tmpPos, IDENTITY_Q, tmpScale);
          mesh.setMatrixAt(group.startIdx + i, tmpMat);
        }
      } else {
        // CONVERGE: particles fly INWARD to center (creation effect)
        const converge = t01 * t01;
        const particleScale = 0.3 * Math.max(0, 1 - t01 * 0.8);

        for (let i = 0; i < PARTICLES_PER_SPAWN; i++) {
          const dist = (1 - converge) * group.dists[i];
          tmpPos.copy(group.targetRef).addScaledVector(group.dirs[i], dist);
          tmpScale.set(particleScale, particleScale, particleScale);
          tmpMat.compose(tmpPos, IDENTITY_Q, tmpScale);
          mesh.setMatrixAt(group.startIdx + i, tmpMat);
        }
      }
      dirty = true;
    }

    if (dirty) mesh.instanceMatrix.needsUpdate = true;
  }

  return { trigger, explode, animate };
}
