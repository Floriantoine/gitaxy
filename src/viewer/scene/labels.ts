import {
  CSS2DRenderer,
  CSS2DObject,
} from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Scene, Camera, PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import type { DirNodeRender } from './nodes';
import type { DirNodeData } from './layout';

export type Labels = {
  domElement: HTMLElement;
  render(scene: Scene, camera: Camera): void;
  resize(width: number, height: number): void;
  setEnabled(enabled: boolean): void;
  /** Recompute distance-based opacity + font size each frame. Cheap (~5 labels). */
  tick(camera: PerspectiveCamera): void;
};

type LabelEntry = {
  div: HTMLDivElement;
  baseFontSize: number;
  data: DirNodeData;
  worldPos: Vector3;
};

/**
 * CSS2D labels for directories.
 *
 * Strategy:
 *  - Show labels only for depth ≤ 1 (root + top-level dirs)
 *  - **Distance-based scaling**: closer = bigger, farther = smaller, hidden beyond farDistance
 *  - Updated each frame in `tick(camera)` (cheap — only ~5 labels for typical repos)
 *
 * Labels are children of dir meshes so they follow on drag.
 */
export function createLabels(dirRenders: DirNodeRender[]): Labels {
  const renderer = new CSS2DRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.top = '0';
  renderer.domElement.style.left = '0';
  renderer.domElement.style.pointerEvents = 'none';
  document.body.appendChild(renderer.domElement);

  const entries: LabelEntry[] = [];

  for (const d of dirRenders) {
    if (d.data.depth > 1) continue; // skip deep dirs
    const div = document.createElement('div');
    div.className = 'dir-label depth-' + d.data.depth;
    div.textContent = d.data.name;
    const obj = new CSS2DObject(div);
    obj.position.set(0, 5, 0); // local offset above mesh
    d.mesh.add(obj);

    const baseFontSize = d.data.depth === 0 ? 13 : 11;
    div.style.fontSize = baseFontSize + 'px';
    entries.push({ div, baseFontSize, data: d.data, worldPos: new Vector3() });
  }

  let enabled = true;

  // Distance thresholds for label scaling — calibrated for typical layouts
  const REF_DISTANCE = 350;  // distance at which label = base size
  const NEAR_DISTANCE = 80;  // closer = clamped to MAX_SCALE
  const FAR_DISTANCE = 1500; // farther = hidden
  const MIN_SCALE = 0.45;
  const MAX_SCALE = 1.6;

  function tick(camera: PerspectiveCamera) {
    if (!enabled || entries.length === 0) return;
    const camPos = camera.position;
    for (const e of entries) {
      // Use the actual mesh world position (in case of drag)
      e.data.position.x; // ensure data exists
      const dx = camPos.x - e.data.position.x;
      const dy = camPos.y - e.data.position.y;
      const dz = camPos.z - e.data.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Opacity fade from FAR_DISTANCE → fully visible at REF_DISTANCE
      let opacity: number;
      if (dist <= REF_DISTANCE) opacity = 1;
      else if (dist >= FAR_DISTANCE) opacity = 0;
      else opacity = 1 - (dist - REF_DISTANCE) / (FAR_DISTANCE - REF_DISTANCE);

      // Scale: ref / dist, clamped
      let scale = REF_DISTANCE / Math.max(NEAR_DISTANCE, dist);
      if (scale < MIN_SCALE) scale = MIN_SCALE;
      else if (scale > MAX_SCALE) scale = MAX_SCALE;

      const fontSize = e.baseFontSize * scale;
      e.div.style.fontSize = fontSize.toFixed(1) + 'px';
      e.div.style.opacity = opacity.toFixed(2);
      // Hide entirely if invisible (avoid layout cost)
      e.div.style.display = opacity < 0.05 ? 'none' : '';
    }
  }

  return {
    domElement: renderer.domElement,
    render(scene, camera) {
      if (enabled) renderer.render(scene, camera);
    },
    resize(width, height) {
      renderer.setSize(width, height);
    },
    setEnabled(value: boolean) {
      enabled = value;
      renderer.domElement.style.display = value ? '' : 'none';
    },
    tick,
  };
}
