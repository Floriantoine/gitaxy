import {
  Scene,
  BufferGeometry,
  BufferAttribute,
  Points,
  PointsMaterial,
  LineSegments,
  LineBasicMaterial,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  AdditiveBlending,
  Color,
  Vector3,
} from 'three';

/**
 * Author comets v3: comets FLOAT in the area and ZAP files from a distance.
 *
 * No more point-to-point flight. Each author:
 * - Has a "home" position = centroid of recently affected files
 * - Gently wanders around home (organic drift)
 * - On commit: lightning arcs shoot from comet to ALL affected files
 * - Files spawn/pulse at the lightning moment
 */

const LIGHTNING_DURATION_MS = 700;
const PULSE_DURATION_MS = 800;
const COMET_IDLE_MS = 4000;
const MAX_COMETS = 20;
const MAX_LIGHTNINGS = 80;
const WANDER_SPEED = 0.3;     // how fast the comet drifts
const WANDER_RADIUS = 25;     // max distance from home
const HOME_LERP = 0.04;       // how fast home follows the centroid of new commits

function authorColorHex(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  const c = new Color();
  c.setHSL(((h >>> 0) % 360) / 360, 0.85, 0.6);
  return c.getHex();
}

let _glowTex: CanvasTexture | null = null;
function glowTexture(): CanvasTexture {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _glowTex = new CanvasTexture(c);
  return _glowTex;
}

let _ringTex: CanvasTexture | null = null;
function ringTexture(): CanvasTexture {
  if (_ringTex) return _ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = 'white'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 10; ctx.stroke();
  _ringTex = new CanvasTexture(c);
  return _ringTex;
}

export type CometJob = {
  addedIndices: number[];
  modifiedIndices: number[];
  deletedIndices: number[];
  /** Live refs to file currentPositions — lightning targets. */
  targetPositions: Vector3[];
  /** Centroid of affected files (for updating comet home). */
  centroid: Vector3;
};

type CometState = {
  author: string;
  color: number;
  homePos: Vector3;
  currentPos: Vector3;
  wanderPhase: number;
  lastActiveMs: number;
  sprite: Sprite;
};

type Lightning = { from: Vector3; to: Vector3; color: number; startMs: number };
type PulseWave = { position: Vector3; color: number; startMs: number; sprite: Sprite };

export type AuthorComets = {
  /** Fire lightning from the author's comet to files + trigger spawns. */
  fire(author: string, job: CometJob, nowMs: number): void;
  animate(nowMs: number, deltaMs: number): void;
  getActiveAuthors(): Array<{ name: string; color: number; position: Vector3 }>;
  findAuthorAtScreen(ndcX: number, ndcY: number, camera: import('three').Camera, threshold?: number): string | null;
  getAuthorPosition(name: string): Vector3 | null;
  setEnabled(enabled: boolean): void;
  setPaused(paused: boolean): void;
  onArrival: ((job: CometJob, nowMs: number) => void) | null;
};

export function createAuthorComets(scene: Scene): AuthorComets {
  const comets = new Map<string, CometState>();
  const lightnings: Lightning[] = [];
  const pulses: PulseWave[] = [];
  let enabled = true;
  let paused = false;
  let arrivalCallback: AuthorComets['onArrival'] = null;

  // Trail dots
  const maxPts = MAX_COMETS * 20;
  const ptPos = new Float32Array(maxPts * 3);
  const ptCol = new Float32Array(maxPts * 3);
  const trailGeo = new BufferGeometry();
  trailGeo.setAttribute('position', new BufferAttribute(ptPos, 3));
  trailGeo.setAttribute('color', new BufferAttribute(ptCol, 3));
  trailGeo.setDrawRange(0, 0);
  scene.add(new Points(trailGeo, new PointsMaterial({
    vertexColors: true, transparent: true, opacity: 0.8,
    blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true, size: 2.5,
  })));

  // Lightning lines
  const lnPos = new Float32Array(MAX_LIGHTNINGS * 6);
  const lnCol = new Float32Array(MAX_LIGHTNINGS * 6);
  const lnGeo = new BufferGeometry();
  lnGeo.setAttribute('position', new BufferAttribute(lnPos, 3));
  lnGeo.setAttribute('color', new BufferAttribute(lnCol, 3));
  lnGeo.setDrawRange(0, 0);
  scene.add(new LineSegments(lnGeo, new LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1.0,
    blending: AdditiveBlending, depthWrite: false,
  })));

  // Pulse sprite pool
  const pulseSpritePool: Sprite[] = [];
  function acquirePulse(): Sprite {
    for (const s of pulseSpritePool) if (!s.visible) return s;
    const s = new Sprite(new SpriteMaterial({
      map: ringTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false,
    }));
    s.visible = false; scene.add(s); pulseSpritePool.push(s);
    return s;
  }

  function getOrCreate(author: string, nowMs: number): CometState {
    let c = comets.get(author);
    if (c) { c.lastActiveMs = nowMs; return c; }
    const color = authorColorHex(author);
    const sprite = new Sprite(new SpriteMaterial({
      map: glowTexture(), color: new Color(color),
      transparent: true, blending: AdditiveBlending, depthWrite: false,
    }));
    sprite.scale.set(6, 6, 1);
    sprite.visible = false;
    scene.add(sprite);
    c = {
      author, color,
      homePos: new Vector3(),
      currentPos: new Vector3(),
      wanderPhase: Math.random() * Math.PI * 2,
      lastActiveMs: nowMs,
      sprite,
    };
    comets.set(author, c);
    return c;
  }

  function fire(author: string, job: CometJob, nowMs: number) {
    if (!enabled) return;
    const c = getOrCreate(author, nowMs);

    // Update home position (lerp toward new centroid)
    if (c.homePos.lengthSq() === 0) {
      c.homePos.copy(job.centroid);
      c.currentPos.copy(job.centroid);
    } else {
      c.homePos.lerp(job.centroid, HOME_LERP * 8); // fast shift toward new area
    }

    // Trigger spawns/pulses immediately
    if (arrivalCallback) arrivalCallback(job, nowMs);

    // Lightning from comet's CURRENT position to each file (delayed 100ms for file flight)
    for (const pos of job.targetPositions) {
      lightnings.push({ from: c.currentPos, to: pos, color: c.color, startMs: nowMs + 100 });
    }

    // Pulse at centroid
    const ps = acquirePulse();
    ps.visible = true;
    ps.position.copy(c.currentPos);
    (ps.material as SpriteMaterial).color.setHex(c.color);
    (ps.material as SpriteMaterial).opacity = 0.8;
    ps.scale.set(3, 3, 1);
    pulses.push({ position: c.currentPos.clone(), color: c.color, startMs: nowMs, sprite: ps });
  }

  const tmpColor = new Color();

  function animate(nowMs: number, deltaMs: number) {
    if (!enabled) { trailGeo.setDrawRange(0, 0); lnGeo.setDrawRange(0, 0); return; }
    // NOTE: even when paused, we still render/cleanup lightnings + pulses (they must fade out).
    // Only comet MOVEMENT is frozen when paused.

    let ptIdx = 0;
    const dt = deltaMs / 1000;

    for (const [author, c] of comets) {
      if (nowMs - c.lastActiveMs > COMET_IDLE_MS) {
        c.sprite.visible = false;
        comets.delete(author);
        continue;
      }

      if (paused) { ptIdx++; continue; } // freeze movement but keep sprite visible

      // Organic wander around home
      c.wanderPhase += dt * WANDER_SPEED;
      const wx = Math.sin(c.wanderPhase * 1.3 + 0.5) * WANDER_RADIUS;
      const wy = Math.cos(c.wanderPhase * 0.9 + 1.2) * WANDER_RADIUS * 0.6;
      const wz = Math.sin(c.wanderPhase * 1.1 + 2.7) * WANDER_RADIUS;
      const targetPos = new Vector3(c.homePos.x + wx, c.homePos.y + wy, c.homePos.z + wz);
      c.currentPos.lerp(targetPos, 0.03); // smooth drift

      c.sprite.visible = true;
      c.sprite.position.copy(c.currentPos);

      // Trail (small ring buffer inline)
      tmpColor.setHex(c.color);
      if (ptIdx < maxPts) {
        ptPos[ptIdx * 3] = c.currentPos.x;
        ptPos[ptIdx * 3 + 1] = c.currentPos.y;
        ptPos[ptIdx * 3 + 2] = c.currentPos.z;
        ptCol[ptIdx * 3] = tmpColor.r * 0.7;
        ptCol[ptIdx * 3 + 1] = tmpColor.g * 0.7;
        ptCol[ptIdx * 3 + 2] = tmpColor.b * 0.7;
        ptIdx++;
      }
    }

    (trailGeo.attributes.position as BufferAttribute).needsUpdate = true;
    (trailGeo.attributes.color as BufferAttribute).needsUpdate = true;
    trailGeo.setDrawRange(0, ptIdx);

    // Lightning arcs — from is LIVE (comet moves), to is LIVE (file moves)
    let lnIdx = 0;
    for (let i = lightnings.length - 1; i >= 0; i--) {
      const l = lightnings[i];
      const elapsed = nowMs - l.startMs;
      if (elapsed > LIGHTNING_DURATION_MS) { lightnings.splice(i, 1); continue; }
      if (elapsed < 0) continue;
      if (lnIdx >= MAX_LIGHTNINGS) continue;
      const fade = 1 - elapsed / LIGHTNING_DURATION_MS;
      tmpColor.setHex(l.color);
      const base = lnIdx * 6;
      // from = comet's LIVE position (moves with wander)
      lnPos[base] = l.from.x; lnPos[base + 1] = l.from.y; lnPos[base + 2] = l.from.z;
      // to = file's LIVE position (moves with spawn flight)
      lnPos[base + 3] = l.to.x; lnPos[base + 4] = l.to.y; lnPos[base + 5] = l.to.z;
      const whiteBlend = Math.max(0, fade - 0.3) / 0.7;
      lnCol[base] = tmpColor.r + (1 - tmpColor.r) * whiteBlend;
      lnCol[base + 1] = tmpColor.g + (1 - tmpColor.g) * whiteBlend;
      lnCol[base + 2] = tmpColor.b + (1 - tmpColor.b) * whiteBlend;
      lnCol[base + 3] = tmpColor.r * fade;
      lnCol[base + 4] = tmpColor.g * fade;
      lnCol[base + 5] = tmpColor.b * fade;
      lnIdx++;
    }
    (lnGeo.attributes.position as BufferAttribute).needsUpdate = true;
    (lnGeo.attributes.color as BufferAttribute).needsUpdate = true;
    lnGeo.setDrawRange(0, lnIdx * 2);

    // Pulses
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      const elapsed = nowMs - p.startMs;
      if (elapsed > PULSE_DURATION_MS) { p.sprite.visible = false; pulses.splice(i, 1); continue; }
      const t = elapsed / PULSE_DURATION_MS;
      (p.sprite.material as SpriteMaterial).opacity = 0.7 * (1 - t);
      const s = 4 + t * 20;
      p.sprite.scale.set(s, s, 1);
    }
  }

  function getActiveAuthors() {
    const out: Array<{ name: string; color: number; position: Vector3 }> = [];
    for (const [, c] of comets) if (c.sprite.visible) out.push({ name: c.author, color: c.color, position: c.currentPos });
    return out;
  }

  function findAuthorAtScreen(ndcX: number, ndcY: number, camera: import('three').Camera, threshold = 0.05) {
    for (const [, c] of comets) {
      if (!c.sprite.visible) continue;
      const p = c.currentPos.clone().project(camera);
      if ((p.x - ndcX) ** 2 + (p.y - ndcY) ** 2 < threshold ** 2) return c.author;
    }
    return null;
  }

  return {
    fire,
    animate,
    getActiveAuthors,
    findAuthorAtScreen,
    getAuthorPosition(name) { const c = comets.get(name); return c?.sprite.visible ? c.currentPos.clone() : null; },
    setEnabled(b) {
      enabled = b;
      if (!b) { for (const [, c] of comets) c.sprite.visible = false; trailGeo.setDrawRange(0, 0); lnGeo.setDrawRange(0, 0); for (const s of pulseSpritePool) s.visible = false; }
    },
    setPaused(p) { paused = p; },
    get onArrival() { return arrivalCallback; },
    set onArrival(cb) { arrivalCallback = cb; },
  };
}
