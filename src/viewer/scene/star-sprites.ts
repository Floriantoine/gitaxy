import {
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  AdditiveBlending,
  Color,
} from 'three';
import type { DirNodeRender } from './nodes';

let _flareTexture: CanvasTexture | null = null;

/** Cross-shaped flare texture (radial center + horizontal/vertical streaks). */
function flareTexture(): CanvasTexture {
  if (_flareTexture) return _flareTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;

  // Radial center
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 90);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);

  // Horizontal streak
  const gH = ctx.createLinearGradient(0, 128, 256, 128);
  gH.addColorStop(0, 'rgba(255,255,255,0)');
  gH.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  gH.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gH;
  ctx.fillRect(0, 124, 256, 8);

  // Vertical streak
  const gV = ctx.createLinearGradient(128, 0, 128, 256);
  gV.addColorStop(0, 'rgba(255,255,255,0)');
  gV.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  gV.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gV;
  ctx.fillRect(124, 0, 8, 256);

  _flareTexture = new CanvasTexture(c);
  return _flareTexture;
}

export type StarSprites = {
  setEnabled(enabled: boolean): void;
  /** Called each frame to twinkle (intensity wobble). */
  tick(t: number): void;
};

/**
 * Add a glowing cross-flare sprite to each directory node.
 * Sprites are added as CHILDREN of the dir mesh so they follow on drag.
 */
export function createStarSprites(dirs: DirNodeRender[]): StarSprites {
  const tex = flareTexture();
  const sprites: Array<{ sprite: Sprite; baseScale: number; phase: number; baseOpacity: number }> = [];

  for (const d of dirs) {
    const isRoot = d.data.depth === 0;
    const isTop = d.data.depth === 1;
    // Star sprite scales with the dir's actual mesh radius (which itself is
    // based on recursive file count). Bigger dirs → bigger flare.
    const baseScale = d.radius * 2.6;
    const baseOpacity = isRoot ? 0.55 : isTop ? 0.5 : 0.35;
    const mat = new SpriteMaterial({
      map: tex,
      color: new Color(d.data.color),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      opacity: baseOpacity,
    });
    const sprite = new Sprite(mat);
    // Sprite is a child of the dir mesh — local position 0,0,0
    sprite.position.set(0, 0, 0);
    sprite.scale.set(baseScale, baseScale, 1);
    d.mesh.add(sprite);
    sprites.push({ sprite, baseScale, phase: Math.random() * Math.PI * 2, baseOpacity });
  }

  let visible = true;

  return {
    setEnabled(enabled: boolean) {
      visible = enabled;
      for (const s of sprites) s.sprite.visible = enabled;
    },
    tick(t: number) {
      if (!visible) return;
      for (const s of sprites) {
        const wobble = 0.85 + Math.sin(t * 1.3 + s.phase) * 0.15;
        s.sprite.scale.set(s.baseScale * wobble, s.baseScale * wobble, 1);
        (s.sprite.material as SpriteMaterial).opacity =
          s.baseOpacity * (0.85 + Math.sin(t * 2.1 + s.phase) * 0.15);
      }
    },
  };
}
