import {
  Scene,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  AdditiveBlending,
} from 'three';
import type { DirNodeData, Layout } from './layout';
import { dirRadius } from './colors';

// Quantized cache — low-poly for perf
const DIR_GEO_CACHE = new Map<number, SphereGeometry>();
const DIR_HALO_CACHE = new Map<number, SphereGeometry>();

function quantize(r: number): number {
  return Math.round(r * 4) / 4;
}

function dirGeo(radius: number): SphereGeometry {
  const key = quantize(radius);
  let g = DIR_GEO_CACHE.get(key);
  if (!g) {
    g = new SphereGeometry(key, 10, 10);
    DIR_GEO_CACHE.set(key, g);
  }
  return g;
}

function dirHaloGeo(radius: number): SphereGeometry {
  const key = quantize(radius);
  let g = DIR_HALO_CACHE.get(key);
  if (!g) {
    g = new SphereGeometry(key * 2.0, 8, 8);
    DIR_HALO_CACHE.set(key, g);
  }
  return g;
}

export type DirNodeRender = {
  data: DirNodeData;
  mesh: Mesh;
  halo: Mesh;
  /** Sphere radius computed from the dir's recursive file count. */
  radius: number;
};

export function createDirNodes(scene: Scene, layout: Layout): DirNodeRender[] {
  const out: DirNodeRender[] = [];
  for (const d of layout.dirs) {
    const isRoot = d.depth === 0;
    const radius = dirRadius(d.fileCount, isRoot);

    // Dir core — simplified for large repos (skip wireframe + halo to reduce draw calls)
    const isLarge = layout.dirs.length > 500;
    const mat = new MeshBasicMaterial({
      color: d.color,
      transparent: !isLarge, // opaque for large repos (cheaper)
      opacity: isLarge ? 1 : 0.4,
      wireframe: isLarge && d.depth > 1, // wireframe only for deep dirs in large repos (visual distinction without extra mesh)
    });
    const mesh = new Mesh(dirGeo(radius), mat);
    mesh.position.copy(d.position);
    mesh.userData = { kind: 'dir', name: d.name, fullPath: d.fullPath, _data: d };
    scene.add(mesh);

    // Wireframe + halo only for small repos (< 500 dirs)
    let halo: Mesh;
    if (!isLarge) {
      const wireMat = new MeshBasicMaterial({ color: d.color, wireframe: true, transparent: true, opacity: 0.6 });
      const wire = new Mesh(dirGeo(radius), wireMat);
      mesh.add(wire);

      const haloMat = new MeshBasicMaterial({
        color: d.color, transparent: true, opacity: 0.1,
        blending: AdditiveBlending, depthWrite: false,
      });
      halo = new Mesh(dirHaloGeo(radius), haloMat);
      mesh.add(halo);
    } else {
      halo = mesh; // placeholder — no separate halo
    }

    out.push({ data: d, mesh, halo, radius });
  }
  return out;
}
