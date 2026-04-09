import {
  OrthographicCamera,
  Vector3,
  type Scene,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import type { Layout } from '../scene/layout';

export type Minimap = {
  render(scene: Scene, renderer: WebGLRenderer): void;
};

const SIZE = 200; // pixels

/**
 * Minimap: small 3D render of the full scene in the bottom-left corner.
 *
 * Uses an orthographic camera that always shows the entire constellation,
 * matching the main camera's viewing angle (rotated with it).
 * Rendered via viewport/scissor into the main canvas — no extra canvas needed.
 */
export function createMinimap(
  mainCamera: PerspectiveCamera,
  layout: Layout,
): Minimap {
  const bounds = layout.boundsRadius * 1.3;

  // Orthographic camera that encompasses the full scene
  const ortho = new OrthographicCamera(-bounds, bounds, bounds, -bounds, 0.1, bounds * 6);
  ortho.position.set(0, bounds * 2, 0);
  ortho.lookAt(0, 0, 0);

  const tmpDir = new Vector3();

  function render(scene: Scene, renderer: WebGLRenderer) {
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    const dpr = renderer.getPixelRatio();
    // Bottom-left corner, just above the timeline (~100px from bottom)
    const px = Math.round(12 * dpr);
    const py = Math.round(12 * dpr);
    const sw = Math.round(SIZE * dpr);
    const sh = Math.round(SIZE * dpr);

    // Position ortho camera: same direction as main camera but zoomed out to see everything
    // Mirror the main camera's horizontal rotation (ignore tilt for readability)
    mainCamera.getWorldDirection(tmpDir);
    const angle = Math.atan2(tmpDir.x, tmpDir.z);
    const camDist = bounds * 2.5;
    ortho.position.set(
      Math.sin(angle) * camDist * -0.5,
      camDist * 0.8,
      Math.cos(angle) * camDist * -0.5,
    );
    ortho.lookAt(0, 0, 0);
    ortho.updateProjectionMatrix();

    // Save state
    const oldScissorTest = renderer.getScissorTest();

    // Render minimap in the bottom-left corner
    renderer.setViewport(px, py, sw, sh);
    renderer.setScissor(px, py, sw, sh);
    renderer.setScissorTest(true);

    // Clear just the minimap area with a dark background
    renderer.setClearColor(0x06060f, 0.85);
    renderer.clear(true, true, false);

    renderer.render(scene, ortho);

    // Restore full viewport
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.setScissorTest(oldScissorTest);
    renderer.setClearColor(0x05050d, 1);
  }

  return { render };
}
