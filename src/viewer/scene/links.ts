import {
  Scene,
  BufferGeometry,
  BufferAttribute,
  LineSegments,
  LineBasicMaterial,
  Color,
  AdditiveBlending,
} from 'three';
import type { FileNodeData, Layout } from './layout';

export type DirLinks = {
  lines: LineSegments;
  /**
   * Re-read positions from the live dir nodes.
   * Segments for dirs not yet born (bornAt > commitIdx) are collapsed to zero-length.
   */
  update(commitIdx: number): void;
};

export function createDirLinks(scene: Scene, layout: Layout): DirLinks {
  const links = layout.dirLinks;
  const positions = new Float32Array(links.length * 6);

  function fillPositions(commitIdx: number) {
    for (let i = 0; i < links.length; i++) {
      const { parent, child } = links[i];
      const base = i * 6;
      // Hide if child dir hasn't been born yet
      if (child.bornAt > commitIdx) {
        const px = parent.position.x, py = parent.position.y, pz = parent.position.z;
        positions[base] = px; positions[base + 1] = py; positions[base + 2] = pz;
        positions[base + 3] = px; positions[base + 4] = py; positions[base + 5] = pz;
      } else {
        positions[base] = parent.position.x;
        positions[base + 1] = parent.position.y;
        positions[base + 2] = parent.position.z;
        positions[base + 3] = child.position.x;
        positions[base + 4] = child.position.y;
        positions[base + 5] = child.position.z;
      }
    }
  }
  fillPositions(Infinity); // initial: all visible

  const geo = new BufferGeometry();
  const posAttr = new BufferAttribute(positions, 3);
  geo.setAttribute('position', posAttr);
  const mat = new LineBasicMaterial({
    color: 0xffeeaa,
    transparent: true,
    opacity: 0.32,
  });
  const lines = new LineSegments(geo, mat);
  scene.add(lines);

  return {
    lines,
    update(commitIdx: number) {
      fillPositions(commitIdx);
      posAttr.needsUpdate = true;
    },
  };
}

export type FileTethers = {
  lines: LineSegments;
  /**
   * Call each frame after file orbits have been updated.
   * Segments for files not yet born (bornAt > commitIdx) are collapsed.
   */
  update(commitIdx: number): void;
};

export function createFileTethers(scene: Scene, files: FileNodeData[]): FileTethers {
  const n = files.length;
  const positions = new Float32Array(n * 6);
  const colors = new Float32Array(n * 6);
  const tmpColor = new Color();

  for (let i = 0; i < n; i++) {
    const f = files[i];
    const base = i * 6;
    const p = f.parent.position;
    positions[base] = p.x; positions[base + 1] = p.y; positions[base + 2] = p.z;
    positions[base + 3] = f.currentPosition.x;
    positions[base + 4] = f.currentPosition.y;
    positions[base + 5] = f.currentPosition.z;

    tmpColor.setHex(f.color);
    colors[base] = tmpColor.r; colors[base + 1] = tmpColor.g; colors[base + 2] = tmpColor.b;
    colors[base + 3] = tmpColor.r; colors[base + 4] = tmpColor.g; colors[base + 5] = tmpColor.b;
  }

  const geo = new BufferGeometry();
  const posAttr = new BufferAttribute(positions, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  const mat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.4,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const lines = new LineSegments(geo, mat);
  scene.add(lines);

  function update(commitIdx: number) {
    for (let i = 0; i < n; i++) {
      const f = files[i];
      const base = i * 6;
      if (f.bornAt > commitIdx) {
        // File not yet born → collapse segment to parent position (zero-length)
        const p = f.parent.position;
        positions[base] = p.x; positions[base + 1] = p.y; positions[base + 2] = p.z;
        positions[base + 3] = p.x; positions[base + 4] = p.y; positions[base + 5] = p.z;
        continue;
      }
      const p = f.parent.position;
      positions[base] = p.x; positions[base + 1] = p.y; positions[base + 2] = p.z;
      positions[base + 3] = f.currentPosition.x;
      positions[base + 4] = f.currentPosition.y;
      positions[base + 5] = f.currentPosition.z;
    }
    posAttr.needsUpdate = true;
  }

  return { lines, update };
}
