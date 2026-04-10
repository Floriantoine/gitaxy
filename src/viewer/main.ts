import { Clock, Vector3 } from 'three';
import { loadRepo } from './data/loader';
import { setupScene } from './scene/setup';
import { createPipeline } from './scene/pipeline';
import { buildLayout, type DirNodeData } from './scene/layout';
import { createDirNodes } from './scene/nodes';
import { createFileInstances } from './scene/instances';
import { createSpawnParticles } from './scene/spawn-particles';
import { createDirLinks, createFileTethers } from './scene/links';
import { createDistribution } from './scene/distribution';
import { createStarfield } from './scene/starfield';
// nebulae removed
import { createStarSprites } from './scene/star-sprites';
import { createTrails } from './scene/trails';
import { createDirOrbits } from './scene/dir-orbits';
import { createLabels } from './scene/labels';
import { createFocusController } from './scene/focus';
import { setupHover } from './scene/hover';
import { setupInteractions } from './scene/interactions';
import { createTimeline, makeDirVisibilityUpdater } from './scene/timeline';
import { setupLegend } from './ui/legend';
import { setupSettings } from './ui/settings';
import { setupTimelineUI } from './ui/timeline-ui';
import { createFpsCounter } from './ui/fps';
import { createAuthorComets } from './scene/author-comets';
import { createInspector } from './ui/inspector';
import { createStats } from './ui/stats';
import { createSearch } from './ui/search';
import { createMinimap } from './ui/minimap';

const status = document.getElementById('status');
function setStatus(text: string) {
  if (status) status.textContent = text;
}

// Loading screen helpers
const loadingEl = document.getElementById('loading');
const loadingStatus = loadingEl?.querySelector('.loading-status') as HTMLElement | null;
const loadingFill = loadingEl?.querySelector('.loading-bar-fill') as HTMLElement | null;
const loadingDetail = loadingEl?.querySelector('.loading-detail') as HTMLElement | null;

function setLoading(pct: number, msg: string, detail = '') {
  if (loadingFill) loadingFill.style.width = pct + '%';
  if (loadingStatus) loadingStatus.textContent = msg;
  if (loadingDetail) loadingDetail.textContent = detail;
}
function hideLoading() {
  if (loadingEl) loadingEl.classList.add('done');
  setTimeout(() => { if (loadingEl) loadingEl.style.display = 'none'; }, 600);
}

async function main() {
  // ----- Load data -----
  setLoading(5, 'Chargement des données...');
  const repo = await loadRepo('/data/repo.json');
  // Multi-repo support: meta can be single or { repos: [...] }
  const isMultiRepo = 'repos' in repo.meta;
  const totalFiles = isMultiRepo
    ? (repo.meta as any).repos.reduce((s: number, r: any) => s + r.fileCount, 0)
    : (repo.meta as any).fileCount;
  const totalCommits = repo.commits.length;
  const totalLines = isMultiRepo
    ? (repo.meta as any).repos.reduce((s: number, r: any) => s + (r.totalLines ?? 0), 0)
    : ((repo.meta as any).totalLines ?? 0);
  const repoLabel = isMultiRepo
    ? `${(repo.meta as any).repos.length} repos`
    : (repo.meta as any).repo;
  setLoading(20, 'Données chargées', `${totalFiles} fichiers · ${totalCommits} commits`);
  // Yield to let the loading bar render
  await new Promise(r => setTimeout(r, 50));

  setStatus(
    `${repoLabel} — ${totalFiles} fichiers · ${totalLines.toLocaleString('fr-FR')} lignes · ${totalCommits} commits`,
  );

  // ----- Scene -----
  setLoading(25, 'Initialisation de la scène...');
  await new Promise(r => setTimeout(r, 10));
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const { scene, camera, renderer, controls } = setupScene(canvas);
  const pipeline = createPipeline(renderer, scene, camera);

  // ----- Background -----
  createStarfield(scene);

  // ----- Layout -----
  setLoading(35, 'Calcul du layout 3D...', `${totalFiles} fichiers à positionner`);
  await new Promise(r => setTimeout(r, 10));
  const layout = buildLayout(repo.tree, isMultiRepo);
  console.log(
    `[gitview] layout: ${layout.dirs.length} dirs, ${layout.files.length} files, bounds=${layout.boundsRadius.toFixed(0)}`,
  );

  // ----- Dir meshes -----
  setLoading(50, 'Création des dossiers...', `${layout.dirs.length} dossiers`);
  await new Promise(r => setTimeout(r, 10));
  const dirNodes = createDirNodes(scene, layout);

  // ----- Spawn particles (converging sparkles for file creation) -----
  const spawnParticles = createSpawnParticles(scene);

  // ----- File instances -----
  setLoading(60, 'Création des fichiers...', `${layout.files.length} fichiers (InstancedMesh)`);
  await new Promise(r => setTimeout(r, 10));
  const fileInstances = createFileInstances(scene, layout.files, spawnParticles);

  // ----- Dynamic distribution -----
  setLoading(70, 'Distribution spatiale...', 'Placement initial des éléments');
  await new Promise(r => setTimeout(r, 10));
  const distribution = createDistribution(layout, dirNodes);

  // ----- Links -----
  setLoading(75, 'Connexions...', `${layout.dirLinks.length} liens dossiers · ${layout.files.length} liens fichiers`);
  await new Promise(r => setTimeout(r, 10));
  const dirLinks = createDirLinks(scene, layout);
  const tethers = createFileTethers(scene, layout.files);

  // ----- Cinematic effects -----
  const starSprites = createStarSprites(dirNodes);

  // ----- Dir orbits (solar-system mode) -----
  const dirOrbits = createDirOrbits(layout, dirNodes);

  // ----- Trails: one batch for files, one for dirs -----
  const fileTrails = createTrails(
    scene,
    layout.files.map((f) => ({ position: f.currentPosition, color: f.color, bornAt: f.bornAt })),
  );
  // Dirs that orbit (skip root). Their `position` is mutated each frame by dir-orbits.update()
  const orbitingDirs = layout.dirs.filter((d) => d.parent !== null);
  const dirTrails = createTrails(
    scene,
    orbitingDirs.map((d) => ({ position: d.position, color: d.color, bornAt: d.bornAt })),
  );
  dirTrails.setEnabled(false);
  // Auto-disable trails for large repos (huge perf cost)
  // Auto-optimize for large repos — disable AND uncheck toggles
  const isLargeRepo = layout.files.length > 5000;

  // Combined gating: dir trails are only visible when (trails toggle ON) AND (orbit toggle ON)
  function syncTrailVisibility() {
    fileTrails.setEnabled(trailsToggle);
    dirTrails.setEnabled(trailsToggle && orbitToggle);
  }

  // ----- Labels (CSS2D) -----
  const labels = createLabels(dirNodes);

  // ----- Auto-fit camera + adapt fog to layout bounds -----
  const fitDistance = Math.max(300, layout.boundsRadius * 1.4);
  camera.position.set(fitDistance * 0.7, fitDistance * 0.45, fitDistance);
  controls.maxDistance = Math.max(controls.maxDistance, layout.boundsRadius * 6);
  controls.update();
  camera.far = Math.max(camera.far, fitDistance * 4 + layout.boundsRadius * 2);
  camera.updateProjectionMatrix();
  if (scene.fog && 'density' in scene.fog) {
    (scene.fog as { density: number }).density = 0.32 / Math.max(500, layout.boundsRadius * 2.5);
  }

  // ----- Focus controller -----
  const focus = createFocusController(camera, controls, layout.boundsRadius);

  // ----- Hover (tooltip + breadcrumb + parent-path highlight) -----
  setupHover(canvas, camera, scene, dirNodes, fileInstances, (item) => {
    if (item && item.kind === 'file') {
      inspector.showFile(item.data);
    }
  });

  // ----- Author comets (triggers file spawns on arrival) -----
  const authorComets = createAuthorComets(scene);
  authorComets.onArrival = (job, nowMs) => {
    const STAGGER = 15;
    for (let j = 0; j < job.addedIndices.length; j++) {
      fileInstances.spawn(job.addedIndices[j], nowMs + j * STAGGER);
    }
    for (const fi of job.modifiedIndices) {
      fileInstances.pulse(fi, nowMs);
    }
    for (const fi of job.deletedIndices) {
      fileInstances.implode(fi, nowMs);
      // Also pulse the file red right before implosion (visible shockwave)
      fileInstances.pulse(fi, nowMs);
    }
  };

  // ----- Stats overlay -----
  const stats = createStats(repo.commits, layout.files);
  document.getElementById('stats-btn')?.addEventListener('click', () => stats.toggle());


  // ----- Search (Ctrl+F) -----
  createSearch(layout.files, layout.dirs, fileInstances, (dir) => focus.focusOn(dir));

  // ----- Minimap -----
  const minimap = createMinimap(camera, layout);

  // ----- Inspector panel (bottom-left info) -----
  const inspector = createInspector(repo.commits);

  // ----- Pointer interactions (Shift+drag, click→focus) -----
  setupInteractions(canvas, camera, controls, layout, dirNodes, focus, dirOrbits);

  // Track last expanded dir for the toggle
  let expandedDir: DirNodeData | null = null;

  // ----- Timeline (history playback) -----
  const dirRenderMap = new Map<DirNodeData, (typeof dirNodes)[number]>();
  for (const r of dirNodes) dirRenderMap.set(r.data, r);
  const updateDirVisibility = makeDirVisibilityUpdater(layout.dirs, dirRenderMap);

  // File path → layout index (for resolving commit.added/modified paths)
  const fileByPath = new Map<string, number>();
  for (let i = 0; i < layout.files.length; i++) {
    const p = layout.files[i].fullPath.startsWith('/')
      ? layout.files[i].fullPath.slice(1)
      : layout.files[i].fullPath;
    fileByPath.set(p, i);
  }

  // Dir spawn animations: sparkles + fly from parent (LIVE) → distribution target + scale-in
  const DIR_SPAWN_MS = 800;
  type DirSpawnState = { startTime: number };
  const dirSpawnAnims = new Map<DirNodeData, DirSpawnState>();
  const dirWasVisible = new Set<DirNodeData>();
  for (const d of layout.dirs) {
    if (d.bornAt <= repo.commits.length - 1) dirWasVisible.add(d);
  }

  function triggerDirSpawn(dir: DirNodeData, startTime: number) {
    const r = dirRenderMap.get(dir);
    if (!r) return;
    r.mesh.visible = true;
    r.mesh.scale.setScalar(0.01);
    dirSpawnAnims.set(dir, { startTime });
    const target = distribution.getDirTarget(dir);
    if (target) spawnParticles.trigger(target, dir.color, startTime);
  }

  // --- Snap callback (scrub/jump) ---
  const onTimelineSnap = (commitIdx: number) => {
    updateDirVisibility(commitIdx);
    distribution.snap(commitIdx);
    dirSpawnAnims.clear();
    dirWasVisible.clear();
    for (const d of layout.dirs) {
      if (d.bornAt <= commitIdx) dirWasVisible.add(d);
    }
    // Snap dir positions + scales (no animation on scrub)
    for (const r of dirNodes) {
      r.mesh.position.copy(r.data.position);
      r.mesh.scale.setScalar(r.mesh.visible ? 1 : 0.01);
    }
  };

  // --- Forward callback (play mode) ---
  const LEVEL_DELAY = 150; // ms between depth levels
  const ITEM_STAGGER = 12; // ms between items at same depth level

  const onTimelineForward = (fromIdx: number, toIdx: number, nowMs: number) => {
    // 1. Find newly visible dirs
    const newDirs: DirNodeData[] = [];
    for (const d of layout.dirs) {
      if (d.bornAt > fromIdx && d.bornAt <= toIdx && !dirWasVisible.has(d)) {
        newDirs.push(d);
        dirWasVisible.add(d);
      }
    }

    // 2. Collect new files + modified files
    const newFiles: Array<{ idx: number; depth: number }> = [];
    const modFiles: number[] = [];
    for (let i = fromIdx + 1; i <= toIdx; i++) {
      const commit = repo.commits[i];
      if (!commit) continue;
      for (const path of commit.added) {
        const fi = fileByPath.get(path);
        if (fi !== undefined)
          newFiles.push({ idx: fi, depth: layout.files[fi].parent.depth + 1 });
      }
      for (const path of commit.modified) {
        const fi = fileByPath.get(path);
        if (fi !== undefined) modFiles.push(fi);
      }
    }

    // 3. Dirs spawn with depth stagger (dirs still spawn directly — they're the "landing zones")
    const maxDepth = Math.max(
      ...(newDirs.length > 0 ? newDirs.map((d) => d.depth) : [0]),
      0,
    );
    let delay = 0;
    for (let depth = 0; depth <= maxDepth; depth++) {
      const dirsAtDepth = newDirs.filter((d) => d.depth === depth);
      for (let j = 0; j < dirsAtDepth.length; j++) {
        triggerDirSpawn(dirsAtDepth[j], nowMs + delay + j * ITEM_STAGGER);
      }
      if (dirsAtDepth.length > 0) delay += LEVEL_DELAY;
    }

    // 4. Author comets: 1 COMMIT = 1 lightning salvo.
    //    Stagger commits within the same frame batch so they don't all fire at once.
    let commitStagger = 0;
    const COMMIT_STAGGER_MS = 250; // delay between commits — each commit is visually distinct
    for (let i = fromIdx + 1; i <= toIdx; i++) {
      const commit = repo.commits[i];
      if (!commit) continue;

      const addedIndices: number[] = [];
      const modifiedIndices: number[] = [];
      const deletedIndices: number[] = [];
      const targetPositions: Vector3[] = [];
      let destDir: DirNodeData | null = null;
      let maxCount = 0;

      // Collect all affected files + find the most-affected parent dir as destination
      const parentCounts = new Map<DirNodeData, number>();
      for (const path of commit.added) {
        const fi = fileByPath.get(path);
        if (fi === undefined) continue;
        addedIndices.push(fi);
        targetPositions.push(layout.files[fi].currentPosition);
        const p = layout.files[fi].parent;
        const cnt = (parentCounts.get(p) ?? 0) + 1;
        parentCounts.set(p, cnt);
        if (cnt > maxCount) { maxCount = cnt; destDir = p; }
      }
      for (const path of commit.modified) {
        const fi = fileByPath.get(path);
        if (fi === undefined) continue;
        modifiedIndices.push(fi);
        targetPositions.push(layout.files[fi].currentPosition);
        const p = layout.files[fi].parent;
        const cnt = (parentCounts.get(p) ?? 0) + 1;
        parentCounts.set(p, cnt);
        if (cnt > maxCount) { maxCount = cnt; destDir = p; }
      }

      // Deleted files (takes priority — remove from modified if also present)
      for (const path of (commit.deleted || [])) {
        const fi = fileByPath.get(path);
        if (fi === undefined) continue;
        deletedIndices.push(fi);
        targetPositions.push(layout.files[fi].currentPosition);
        const p = layout.files[fi].parent;
        const cnt = (parentCounts.get(p) ?? 0) + 1;
        parentCounts.set(p, cnt);
        if (cnt > maxCount) { maxCount = cnt; destDir = p; }
      }
      // Remove files from modified if they're being deleted in the same batch
      const deletedSet = new Set(deletedIndices);
      for (let mi = modifiedIndices.length - 1; mi >= 0; mi--) {
        if (deletedSet.has(modifiedIndices[mi])) modifiedIndices.splice(mi, 1);
      }

      if ((addedIndices.length > 0 || modifiedIndices.length > 0 || deletedIndices.length > 0) && targetPositions.length > 0) {
        const centroid = new Vector3();
        for (const p of targetPositions) centroid.add(p);
        centroid.divideScalar(targetPositions.length);

        authorComets.fire(commit.author, {
          addedIndices,
          modifiedIndices,
          deletedIndices,
          targetPositions,
          centroid,
        }, nowMs + commitStagger);
        commitStagger += COMMIT_STAGGER_MS;
      }
    }

    // 5. Update dir visibility
    updateDirVisibility(toIdx);
  };

  const timeline = createTimeline(
    repo.commits,
    layout,
    fileInstances,
    onTimelineSnap,
    onTimelineForward,
  );
  setupTimelineUI(timeline, repo.commits);
  // Sync comet pause with timeline play state
  timeline.onChange(() => {
    authorComets.setPaused(!timeline.state.isPlaying);
  });

  // Track expand/orbit toggle state (declared before setupSettings because callbacks fire at init)
  let expandToggleOn = false;
  let trailsToggle = true;
  let orbitToggle = false;

  // ----- UI -----
  const legend = setupLegend(layout.files);
  const settings = setupSettings({
    onBloom: (b) => pipeline.setBloomEnabled(b),
    onStarSprites: (b) => starSprites.setEnabled(b),
    onTrails: (b) => {
      trailsToggle = b;
      syncTrailVisibility();
    },
    onLinks: (b) => {
      dirLinks.lines.visible = b;
      tethers.lines.visible = b;
    },
    onLabels: (b) => labels.setEnabled(b),
    onDirOrbits: (b) => {
      orbitToggle = b;
      dirOrbits.setEnabled(b);
      // Reset trail ring buffers so trails don't smear from stale positions
      if (b) dirTrails.reset();
      syncTrailVisibility();
    },
    onAutoRotate: (b) => {
      controls.autoRotate = b;
      controls.autoRotateSpeed = 0.4;
    },
    onExpand: (b) => {
      expandToggleOn = b;
      if (expandedDir) {
        distribution.collapseDir(expandedDir);
        expandedDir = null;
      }
      if (b) {
        const tracked = focus.getTrackedDir();
        if (tracked) {
          distribution.expandDir(tracked);
          expandedDir = tracked;
          // Re-focus zoomed out to fit expanded content
          setTimeout(() => focus.focusOn(tracked, 1.6), 100);
        }
      }
    },
  }, isLargeRepo ? { bloom: false, star: false, trails: false, labels: false } : undefined);

  let lastTrackedDir: DirNodeData | null = null;

  // ----- Author panel + hover tooltip -----
  const authorsEl = document.getElementById('authors');
  const allSeenAuthors = new Map<string, number>(); // name → color
  let followedAuthor: string | null = null;
  const followOffset = new Vector3(30, 20, 40);

  function updateAuthorPanel() {
    if (!authorsEl) return;
    const active = authorComets.getActiveAuthors();
    for (const a of active) allSeenAuthors.set(a.name, a.color);

    while (authorsEl.firstChild) authorsEl.removeChild(authorsEl.firstChild);
    if (allSeenAuthors.size === 0) { authorsEl.style.display = 'none'; return; }
    authorsEl.style.display = 'block';

    const title = document.createElement('div');
    title.className = 'author-title';
    title.textContent = 'Auteurs';
    authorsEl.appendChild(title);

    for (const [name, color] of allSeenAuthors) {
      const item = document.createElement('div');
      item.className = 'author-item';
      const swatch = document.createElement('span');
      swatch.className = 'author-swatch';
      const hex = '#' + color.toString(16).padStart(6, '0');
      swatch.style.background = hex;
      swatch.style.boxShadow = '0 0 5px ' + hex;
      const label = document.createElement('span');
      label.className = 'author-name';
      label.textContent = name;
      item.appendChild(swatch);
      item.appendChild(label);
      item.addEventListener('click', () => {
        // Toggle follow for this author
        if (followedAuthor === name) {
          followedAuthor = null; // un-follow
          controls.enablePan = true;
        } else {
          followedAuthor = name;
          focus.clearTracking(); // release any dir tracking
          // Initial jump to comet
          const pos = authorComets.getAuthorPosition(name);
          if (pos) {
            controls.target.copy(pos);
            camera.position.copy(pos).add(followOffset);
          }
        }
      });
      authorsEl.appendChild(item);
    }
  }

  // Tooltip for comets on hover
  const tooltipEl = document.getElementById('tooltip');
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const author = authorComets.findAuthorAtScreen(ndcX, ndcY, camera, 0.04);
    if (author && tooltipEl) {
      tooltipEl.style.display = 'block';
      tooltipEl.style.left = e.clientX + 12 + 'px';
      tooltipEl.style.top = e.clientY + 12 + 'px';
      tooltipEl.textContent = '[author] ' + author;
    }
  });

  // Stop following author on right-click (pan) or middle-click
  canvas.addEventListener('pointerdown', (e) => {
    if (followedAuthor && (e.button === 2 || e.button === 1)) {
      followedAuthor = null;
    }
  });

  // Position author panel under legend
  if (authorsEl) {
    const legend = document.getElementById('legend');
    if (legend) {
      const updatePos = () => {
        const rect = legend.getBoundingClientRect();
        authorsEl.style.top = (rect.bottom + 8) + 'px';
      };
      updatePos();
      setInterval(updatePos, 2000);
    }
  }

  setLoading(95, 'Prêt !', `${layout.files.length} fichiers · ${layout.dirs.length} dossiers`);
  await new Promise(r => setTimeout(r, 200));
  hideLoading();

  // ----- Loop -----
  const clock = new Clock();
  const fps = createFpsCounter();
  let lastNow = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    const rawDelta = now - lastNow;
    lastNow = now;
    const deltaMs = Math.min(rawDelta, 100); // cap at 100ms to prevent tab-switch explosions
    const t = clock.getElapsedTime();

    timeline.tick(deltaMs, now);
    dirOrbits.update(t);

    // Auto-expand + inspector on focus change
    const currentTracked = focus.getTrackedDir();
    if (currentTracked !== lastTrackedDir) {
      // Stop following author when focusing a dir
      if (currentTracked && followedAuthor) {
        followedAuthor = null;
        controls.enablePan = true;
      }
      // Update inspector
      if (currentTracked) {
        inspector.showDir(currentTracked);
      } else {
        inspector.hide();
      }
      // Auto-expand when toggle is ON + re-focus zoomed out
      if (expandToggleOn) {
        if (expandedDir) {
          distribution.collapseDir(expandedDir);
          expandedDir = null;
        }
        if (currentTracked) {
          distribution.expandDir(currentTracked);
          expandedDir = currentTracked;
          // Re-focus with zoom-out to fit expanded content (slight delay to not fight first focus)
          const dir = currentTracked;
          setTimeout(() => focus.focusOn(dir, 1.6), 150);
        }
      }
    }
    lastTrackedDir = currentTracked;

    const commitIdx = timeline.state.currentIndex;
    distribution.update(commitIdx); // recompute targets if N_visible changed
    const expanding = distribution.tick(); // lerp ALL dirs + files toward targets
    if (expanding) fileInstances.markAllDirty(); // expansion moved files → refresh GPU buffers
    // Dir spawn flight animations AFTER tick — overrides spawning dirs
    for (const [d, state] of dirSpawnAnims) {
      const render = dirRenderMap.get(d);
      if (!render) { dirSpawnAnims.delete(d); continue; }
      const elapsed = now - state.startTime;
      const target = distribution.getDirTarget(d) ?? d.position;
      const parentPos = d.parent ? d.parent.position : d.position;
      if (elapsed < 0) {
        render.mesh.position.copy(parentPos);
        render.mesh.scale.setScalar(0.01);
        d.position.copy(parentPos);
      } else if (elapsed < DIR_SPAWN_MS) {
        const t01 = elapsed / DIR_SPAWN_MS;
        const eased = 1 - Math.pow(1 - t01, 3);
        render.mesh.position.lerpVectors(parentPos, target, eased);
        d.position.copy(render.mesh.position);
        const overshoot = t01 < 0.5 ? 1 + t01 * 0.5 : 1.25 - (t01 - 0.5) * 0.5;
        render.mesh.scale.setScalar(Math.max(0.01, eased * overshoot));
      } else {
        render.mesh.scale.setScalar(1);
        dirSpawnAnims.delete(d);
      }
    }

    fileInstances.animate(now);     // apply spawn/pulse modifiers + write matrices
    spawnParticles.animate(now);
    authorComets.animate(now, deltaMs);
    dirLinks.update(commitIdx);
    tethers.update(commitIdx);
    fileTrails.update(commitIdx);
    dirTrails.update(commitIdx);
    starSprites.tick(t);
    focus.tick();
    labels.tick(camera);

    // Follow author comet (smooth tracking)
    if (followedAuthor) {
      const pos = authorComets.getAuthorPosition(followedAuthor);
      if (pos) {
        // Smooth follow: lerp camera toward comet instead of snapping
        const dx = pos.x - controls.target.x;
        const dy = pos.y - controls.target.y;
        const dz = pos.z - controls.target.z;
        const followLerp = 0.08;
        controls.target.x += dx * followLerp;
        controls.target.y += dy * followLerp;
        controls.target.z += dz * followLerp;
        camera.position.x += dx * followLerp;
        camera.position.y += dy * followLerp;
        camera.position.z += dz * followLerp;
      }
      // Don't auto-stop on comet disappearance — keep following position
      // User must explicitly stop (click background, click another dir, or right-click)
    }

    // Update author panel (every 30 frames to avoid DOM thrashing)
    if (Math.round(now / 500) !== Math.round((now - deltaMs) / 500)) {
      updateAuthorPanel();
    }

    controls.update();
    pipeline.render();
    labels.render(scene, camera);

    settings.setFps(fps.tick(now));
    stats.update(commitIdx);
    legend.update(commitIdx);
    if (!isLargeRepo) minimap.render(scene, renderer); // skip minimap double-render for large repos
  }
  frame();

  // ----- Resize -----
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    pipeline.resize(w, h);
    labels.resize(w, h);
  });
}

main().catch((err) => {
  console.error(err);
  setStatus('Erreur : ' + (err instanceof Error ? err.message : String(err)));
});
