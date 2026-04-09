import { Raycaster, Vector2, type Camera, type Object3D } from 'three';

export function setupTooltip(
  canvas: HTMLCanvasElement,
  camera: Camera,
  pickables: Object3D[],
): void {
  const tooltip = document.getElementById('tooltip');
  if (!tooltip) return;
  const raycaster = new Raycaster();
  const mouse = new Vector2();

  canvas.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    if (hits.length > 0) {
      const ud = hits[0].object.userData as { kind?: string; name?: string; fullPath?: string };
      tooltip.style.display = 'block';
      tooltip.style.left = e.clientX + 12 + 'px';
      tooltip.style.top = e.clientY + 12 + 'px';
      const prefix = ud.kind === 'dir' ? '[dir] ' : '[file] ';
      tooltip.textContent = prefix + (ud.fullPath ?? ud.name ?? '');
    } else {
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
}
