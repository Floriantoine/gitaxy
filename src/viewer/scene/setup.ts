import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Color,
  FogExp2,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type SceneCtx = {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
};

export function setupScene(canvas: HTMLCanvasElement): SceneCtx {
  const scene = new Scene();
  scene.background = new Color(0x05050d);
  // Very light fog by default — main.ts overrides density to match layout bounds.
  scene.fog = new FogExp2(0x05050d, 0.0002);

  const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 12000);
  camera.position.set(380, 240, 560);

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);
  controls.maxDistance = 6000;

  return { scene, camera, renderer, controls, canvas };
}
