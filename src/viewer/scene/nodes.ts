import {
  Scene,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  AdditiveBlending,
} from 'three';
import type { DirNodeData, Layout } from './layout';
import { dirRadius } from './colors';

// Quantized cache so we don't allocate one geometry per dir
const DIR_GEO_CACHE = new Map<number, SphereGeometry>();
const DIR_HALO_CACHE = new Map<number, SphereGeometry>();

function quantize(r: number): number {
  return Math.round(r * 4) / 4; // 0.25 step
}

function dirGeo(radius: number): SphereGeometry {
  const key = quantize(radius);
  let g = DIR_GEO_CACHE.get(key);
  if (!g) {
    g = new SphereGeometry(key, 16, 16);
    DIR_GEO_CACHE.set(key, g);
  }
  return g;
}

function dirHaloGeo(radius: number): SphereGeometry {
  const key = quantize(radius);
  let g = DIR_HALO_CACHE.get(key);
  if (!g) {
    // Halo factor reduced from 2.8 → 2.0 — with bigger dir radii, the old
    // factor was bleeding too much and overlapping with neighbors.
    g = new SphereGeometry(key * 2.0, 14, 14);
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

    const mat = new MeshBasicMaterial({ color: d.color });
    const mesh = new Mesh(dirGeo(radius), mat);
    mesh.position.copy(d.position);
    // _data exposed for the drag/click interactions
    mesh.userData = { kind: 'dir', name: d.name, fullPath: d.fullPath, _data: d };
    scene.add(mesh);

    // Halo as a child of the mesh — follows the mesh on drag automatically
    const haloMat = new MeshBasicMaterial({
      color: d.color,
      transparent: true,
      opacity: 0.12,
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
