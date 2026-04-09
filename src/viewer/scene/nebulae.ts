import {
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  AdditiveBlending,
  type Scene,
} from 'three';

function nebulaTexture(c1: string, c2: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, c1);
  g.addColorStop(0.55, c2);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
}

const NEBULAE = [
  { c1: 'rgba(140,70,200,0.55)', c2: 'rgba(60,30,100,0.18)', pos: [350, 80, -400], size: 700 },
  { c1: 'rgba(50,110,200,0.5)',  c2: 'rgba(20,40,90,0.15)',  pos: [-450, -120, 250], size: 800 },
  { c1: 'rgba(200,80,150,0.4)',  c2: 'rgba(90,40,80,0.1)',   pos: [150, -300, 350], size: 600 },
  { c1: 'rgba(80,160,180,0.35)', c2: 'rgba(30,60,80,0.1)',   pos: [-200, 250, -300], size: 550 },
];

export type Nebulae = {
  setEnabled(enabled: boolean): void;
};

export function createNebulae(scene: Scene): Nebulae {
  const sprites: Sprite[] = [];
  for (const n of NEBULAE) {
    const tex = nebulaTexture(n.c1, n.c2);
    const mat = new SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const sprite = new Sprite(mat);
    sprite.position.set(n.pos[0], n.pos[1], n.pos[2]);
    sprite.scale.set(n.size, n.size, 1);
    scene.add(sprite);
    sprites.push(sprite);
  }
  return {
    setEnabled(enabled: boolean) {
      for (const s of sprites) s.visible = enabled;
    },
  };
}
