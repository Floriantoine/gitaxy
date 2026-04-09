import {
  Raycaster,
  Vector2,
  BufferGeometry,
  BufferAttribute,
  LineSegments,
  LineBasicMaterial,
  AdditiveBlending,
  type Camera,
  type Scene,
} from 'three';
import type { DirNodeData, FileNodeData } from './layout';
import type { DirNodeRender } from './nodes';
import type { FileInstances } from './instances';

export type HoverCallback = (item: { kind: 'dir'; data: DirNodeData } | { kind: 'file'; data: FileNodeData } | null) => void;

const MAX_PATH_DEPTH = 32;

/**
 * Unified hover layer:
 *  - Updates the cursor tooltip with the hovered item's path
 *  - Updates the bottom breadcrumb with the same path
 *  - Highlights the parent ancestry chain with a bright LineSegments overlay
 *
 * Single raycast per mousemove. Files are picked via the InstancedMesh `instanceId`.
 */
export function setupHover(
  canvas: HTMLCanvasElement,
  camera: Camera,
  scene: Scene,
  dirRenders: DirNodeRender[],
  fileInstances: FileInstances,
  onHover?: HoverCallback,
): void {
  const tooltipEl = document.getElementById('tooltip');
  const breadcrumbEl = document.getElementById('breadcrumb');
  if (!tooltipEl || !breadcrumbEl) {
    console.warn('[gitview] tooltip or breadcrumb element missing');
    return;
  }
  const tooltip: HTMLElement = tooltipEl;
  const breadcrumb: HTMLElement = breadcrumbEl;

  const raycaster = new Raycaster();
  const mouse = new Vector2();
  const dirMeshes = dirRenders.map((r) => r.mesh);

  // ----- Highlight overlay -----
  const highlightPositions = new Float32Array(MAX_PATH_DEPTH * 2 * 3);
  const highlightGeo = new BufferGeometry();
  const highlightAttr = new BufferAttribute(highlightPositions, 3);
  highlightGeo.setAttribute('position', highlightAttr);
  highlightGeo.setDrawRange(0, 0);
  const highlightMat = new LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const highlight = new LineSegments(highlightGeo, highlightMat);
  highlight.renderOrder = 999;
  scene.add(highlight);

  function setHighlightChain(chain: DirNodeData[]) {
    let i = 0;
    const limit = Math.min(chain.length - 1, MAX_PATH_DEPTH - 1);
    for (let k = 0; k < limit; k++) {
      const a = chain[k].position;
      const b = chain[k + 1].position;
      highlightPositions[i++] = a.x;
      highlightPositions[i++] = a.y;
      highlightPositions[i++] = a.z;
      highlightPositions[i++] = b.x;
      highlightPositions[i++] = b.y;
      highlightPositions[i++] = b.z;
    }
    highlightAttr.needsUpdate = true;
    highlightGeo.setDrawRange(0, Math.max(0, limit) * 2);
  }
  function clearHighlight() {
    highlightGeo.setDrawRange(0, 0);
  }

  function ancestry(dir: DirNodeData): DirNodeData[] {
    const out: DirNodeData[] = [];
    let cur: DirNodeData | null = dir;
    while (cur) {
      out.push(cur);
      cur = cur.parent;
    }
    out.reverse();
    return out;
  }

  function setNDC(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function showHover(label: string, path: string, chain: DirNodeData[], e: MouseEvent) {
    tooltip.style.display = 'block';
    tooltip.style.left = e.clientX + 12 + 'px';
    tooltip.style.top = e.clientY + 12 + 'px';
    tooltip.textContent = label;
    breadcrumb.textContent = path;
    breadcrumb.style.opacity = '1';
    setHighlightChain(chain);
  }

  function hideHover() {
    tooltip.style.display = 'none';
    breadcrumb.textContent = '';
    breadcrumb.style.opacity = '0';
    clearHighlight();
  }

  canvas.addEventListener('mousemove', (e) => {
    setNDC(e);
    raycaster.setFromCamera(mouse, camera);

    // Files first (most numerous, instanced)
    const fileHits = raycaster.intersectObject(fileInstances.fileMesh, false);
    if (fileHits.length > 0 && fileHits[0].instanceId !== undefined) {
      const f = fileInstances.fileByInstance(fileHits[0].instanceId);
      if (f) {
        showHover('[file] ' + f.name, f.fullPath, ancestry(f.parent), e);
        return;
      }
    }

    // Then dirs
    const dirHits = raycaster.intersectObjects(dirMeshes, false);
    if (dirHits.length > 0) {
      const data = (dirHits[0].object.userData as { _data?: DirNodeData })._data;
      if (data) {
        showHover('[dir] ' + data.name, data.fullPath, ancestry(data), e);
        return;
      }
    }

    hideHover();
  });

  canvas.addEventListener('mouseleave', hideHover);

  // Click on file → notify callback (doesn't affect dir focus)
  canvas.addEventListener('click', (e) => {
    if (!onHover) return;
    setNDC(e);
    raycaster.setFromCamera(mouse, camera);
    const fileHits = raycaster.intersectObject(fileInstances.fileMesh, false);
    if (fileHits.length > 0 && fileHits[0].instanceId !== undefined) {
      const f = fileInstances.fileByInstance(fileHits[0].instanceId);
      if (f) {
        onHover({ kind: 'file', data: f });
        return;
      }
    }
    // Dir click is handled by interactions.ts (focus), not here
  });
}
