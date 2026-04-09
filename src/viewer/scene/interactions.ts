import { Raycaster, Vector2, Vector3, Plane, type Camera } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { DirNodeData, Layout } from './layout';
import type { DirNodeRender } from './nodes';
import type { FocusController } from './focus';
import type { DirOrbits } from './dir-orbits';
import type { ContextMenu } from '../ui/context-menu';

const CLICK_MAX_PIXELS = 5;
const CLICK_MAX_MS = 400;

/**
 * Pointer interactions for directories:
 *  - **Shift + drag** = move a dir (and its entire subtree)
 *  - **Click** (no shift, < 5px movement, < 400ms) = focus camera on the dir
 *  - **Click on background** = (no-op for now; could reset focus later)
 */
export function setupInteractions(
  canvas: HTMLCanvasElement,
  camera: Camera,
  controls: OrbitControls,
  layout: Layout,
  dirRenders: DirNodeRender[],
  focus: FocusController,
  dirOrbits: DirOrbits,
  contextMenu?: ContextMenu,
): void {
  const dirMeshes = dirRenders.map((r) => r.mesh);
  const raycaster = new Raycaster();
  const mouse = new Vector2();

  type DragState = {
    dir: DirNodeData;
    plane: Plane;
    grabOffset: Vector3;
  };
  let dragging: DragState | null = null;

  // Click detection state
  let downX = 0;
  let downY = 0;
  let downTime = 0;
  let downValid = false;

  function setNDC(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickDir(): { data: DirNodeData; point: Vector3 } | null {
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(dirMeshes, false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    const data = (hit.object.userData as { _data?: DirNodeData })._data;
    if (!data) return null;
    return { data, point: hit.point.clone() };
  }

  // Index dirRender by data for O(1) translateSubtree lookups.
  const dirRenderByData = new Map<DirNodeData, DirNodeRender>();
  for (const r of dirRenders) dirRenderByData.set(r.data, r);

  function translateSubtree(dir: DirNodeData, delta: Vector3) {
    const queue: DirNodeData[] = [dir];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      cur.position.add(delta);
      const r = dirRenderByData.get(cur);
      if (r) r.mesh.position.copy(cur.position);
      const kids = layout.childrenMap.get(cur);
      if (kids) queue.push(...kids);
    }
  }

  // Pointerdown — capture phase so we can intercept Shift+drag before OrbitControls
  canvas.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (e.button !== 0) return;
      downX = e.clientX;
      downY = e.clientY;
      downTime = performance.now();
      downValid = true;

      if (!e.shiftKey) return; // not a drag-dir attempt
      // Drag is meaningless when dirs are orbiting (orbit update overrides position)
      if (dirOrbits.isEnabled()) return;
      setNDC(e);
      const hit = pickDir();
      if (!hit) return;

      const camDir = new Vector3();
      camera.getWorldDirection(camDir);
      const plane = new Plane().setFromNormalAndCoplanarPoint(camDir.negate(), hit.data.position);
      const grabOffset = hit.data.position.clone().sub(hit.point);

      dragging = { dir: hit.data, plane, grabOffset };
      controls.enabled = false;
      canvas.style.cursor = 'grabbing';
      downValid = false; // dragging — not a click anymore
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    if (dragging) {
      setNDC(e);
      raycaster.setFromCamera(mouse, camera);
      const intersect = new Vector3();
      if (raycaster.ray.intersectPlane(dragging.plane, intersect)) {
        const target = intersect.add(dragging.grabOffset);
        const delta = target.sub(dragging.dir.position);
        if (delta.lengthSq() > 0) translateSubtree(dragging.dir, delta);
      }
      return;
    }

    // Movement during a click candidate? cancel click
    if (downValid) {
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (dx * dx + dy * dy > CLICK_MAX_PIXELS * CLICK_MAX_PIXELS) downValid = false;
    }

    // Cursor hint when shift is held over a dir (skip when orbits are on — drag is disabled)
    if (e.shiftKey && !dirOrbits.isEnabled()) {
      setNDC(e);
      const hit = pickDir();
      canvas.style.cursor = hit ? 'grab' : '';
    } else if (canvas.style.cursor === 'grab') {
      canvas.style.cursor = '';
    }
  });

  function endDrag() {
    if (!dragging) return;
    dragging = null;
    controls.enabled = true;
    canvas.style.cursor = '';
  }

  canvas.addEventListener('pointerup', (e: PointerEvent) => {
    if (dragging) {
      endDrag();
      return;
    }
    // Click detection
    if (!downValid) return;
    if (performance.now() - downTime > CLICK_MAX_MS) {
      downValid = false;
      return;
    }
    setNDC(e);
    const hit = pickDir();
    if (hit) {
      focus.focusOn(hit.data);
    } else {
      focus.clearTracking();
    }
    downValid = false;
  });
  canvas.addEventListener('pointercancel', () => {
    endDrag();
    downValid = false;
  });
  canvas.addEventListener('pointerleave', () => {
    endDrag();
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' && !dragging && canvas.style.cursor === 'grab') {
      canvas.style.cursor = '';
    }
  });

  // Escape releases any active focus follow
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') focus.clearTracking();
  });
}
