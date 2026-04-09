import {
  Vector2,
  type Scene,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export type Pipeline = {
  render(): void;
  setBloomEnabled(enabled: boolean): void;
  resize(width: number, height: number): void;
};

/**
 * Render pipeline with optional bloom post-processing.
 * When bloom is disabled, the renderer is used directly (cheaper).
 * When enabled, the EffectComposer chain runs.
 */
export function createPipeline(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
): Pipeline {
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(window.innerWidth, window.innerHeight);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new UnrealBloomPass(
    new Vector2(window.innerWidth, window.innerHeight),
    0.45, // strength — toned down (was 0.85)
    0.45, // radius
    0.55, // threshold — only really bright pixels bloom (was 0.2)
  );
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  let bloomEnabled = true;

  return {
    render() {
      if (bloomEnabled) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    },
    setBloomEnabled(enabled: boolean) {
      bloomEnabled = enabled;
    },
    resize(width: number, height: number) {
      composer.setSize(width, height);
      bloomPass.setSize(width, height);
    },
  };
}
