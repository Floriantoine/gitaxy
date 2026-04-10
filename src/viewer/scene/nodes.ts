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

    // Dir core: semi-transparent + wireframe overlay for structural look
    const mat = new MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.4 });
    const mesh = new Mesh(dirGeo(radius), mat);
    mesh.position.copy(d.position);
    mesh.userData = { kind: 'dir', name: d.name, fullPath: d.fullPath, _data: d };
    scene.add(mesh);

    // Wireframe overlay — makes dirs look like structural hubs, not data dots
    const wireMat = new MeshBasicMaterial({ color: d.color, wireframe: true, transparent: true, opacity: 0.6 });
    const wire = new Mesh(dirGeo(radius), wireMat);
    wire.position.set(0, 0, 0);
    mesh.add(wire);

    // Halo ring
    const haloMat = new MeshBasicMaterial({
      color: d.color,
      transparent: true,
      opacity: 0.1,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const halo = new Mesh(dirHaloGeo(radius), haloMat);
    halo.position.set(0, 0, 0);
    mesh.add(halo);

    out.push({ data: d, mesh, halo, radius });
  }
  return out;
}
