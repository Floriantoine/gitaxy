import type { CommitInfo } from '../data/types';
import type { FileNodeData, DirNodeData, Layout } from './layout';
import type { FileInstances } from './instances';

export type TimelineState = {
  currentIndex: number; // integer commit index, 0..totalCommits-1
  totalCommits: number;
  isPlaying: boolean;
  speed: number; // commits per second
};

export type Timeline = {
  state: TimelineState;
  /** Jump to a commit index. Snaps visibility — no spawn animations. */
  jumpTo(idx: number): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  setSpeed(commitsPerSec: number): void;
  /** Advance time during playback. Call each frame. */
  tick(deltaMs: number, nowMs: number): void;
  /** Subscribe to state changes (current index, play state). */
  onChange(cb: () => void): void;
};

/**
 * Timeline state machine. Drives:
 *  - File visibility snapping on jumpTo (via fileInstances.snapToCommit)
 *  - File spawn/pulse animations on play (via fileInstances.spawn/.pulse)
 *  - Dir mesh visibility (via dirVisibilityCallback)
 */
/**
 * @param onSnap — Called on jump/scrub. Hard-snap everything.
 * @param onForward — Called during forward play with (fromIdx, toIdx, nowMs).
 *                     The caller handles file spawns, dir animations, and depth staggering.
 */
export function createTimeline(
  commits: CommitInfo[],
  layout: Layout,
  fileInstances: FileInstances,
  onSnap: (commitIdx: number) => void,
  onForward: (fromIdx: number, toIdx: number, nowMs: number) => void,
): Timeline {
  const totalCommits = commits.length;

  // Build a path → file index map for fast lookup
  const fileByPath = new Map<string, number>();
  for (let i = 0; i < layout.files.length; i++) {
    // strip leading slash from fullPath to match git ls-files relative paths
    const p = layout.files[i].fullPath.startsWith('/')
      ? layout.files[i].fullPath.slice(1)
      : layout.files[i].fullPath;
    fileByPath.set(p, i);
  }

  const state: TimelineState = {
    currentIndex: totalCommits - 1, // start at HEAD
    totalCommits,
    isPlaying: false,
    speed: 20, // commits/sec default
  };

  // Floating-point time accumulator for smooth playback
  let currentTime = state.currentIndex;
  const subscribers: Array<() => void> = [];
  function notify() {
    for (const cb of subscribers) cb();
  }

  function snapVisibility(commitIdx: number) {
    fileInstances.snapToCommit(commitIdx);
    onSnap(commitIdx);
  }

  function jumpTo(idx: number) {
    const clamped = Math.max(0, Math.min(totalCommits - 1, Math.round(idx)));
    state.currentIndex = clamped;
    currentTime = clamped;
    snapVisibility(clamped);
    notify();
  }

  function play() {
    if (state.isPlaying) return;
    // If at end, rewind to start so play does something
    if (state.currentIndex >= totalCommits - 1) {
      jumpTo(0);
    }
    state.isPlaying = true;
    notify();
  }

  function pause() {
    if (!state.isPlaying) return;
    state.isPlaying = false;
    notify();
  }

  function togglePlay() {
    if (state.isPlaying) pause();
    else play();
  }

  function setSpeed(s: number) {
    state.speed = Math.max(0.1, s);
    notify();
  }

  /**
   * Apply spawn/pulse for commits in (fromIdx, toIdx]. Forward only.
   * For each crossed commit, look up its added/modified paths and trigger animations.
   */
  function applyForwardEvents(fromIdx: number, toIdx: number, nowMs: number) {
    onForward(fromIdx, toIdx, nowMs);
  }

  function tick(deltaMs: number, nowMs: number) {
    if (!state.isPlaying) return;
    currentTime += (deltaMs / 1000) * state.speed;
    if (currentTime >= totalCommits - 1) {
      currentTime = totalCommits - 1;
      state.isPlaying = false;
    }
    const newIdx = Math.floor(currentTime);
    if (newIdx !== state.currentIndex) {
      const prev = state.currentIndex;
      state.currentIndex = newIdx;
      if (newIdx > prev) {
        applyForwardEvents(prev, newIdx, nowMs);
      } else {
        // Backward during playback shouldn't happen, but be safe
        snapVisibility(newIdx);
      }
      notify();
    } else if (!state.isPlaying) {
      notify(); // pause notification (when we hit the end)
    }
  }

  // Initial snap so files appear correctly
  snapVisibility(state.currentIndex);

  return {
    state,
    jumpTo,
    play,
    pause,
    togglePlay,
    setSpeed,
    tick,
    onChange(cb) {
      subscribers.push(cb);
    },
  };
}

/** Build a function that updates dir mesh visibility based on commit index. */
export function makeDirVisibilityUpdater(
  dirs: DirNodeData[],
  meshByDir: Map<DirNodeData, { mesh: { visible: boolean } }>,
) {
  return (commitIdx: number) => {
    for (const d of dirs) {
      const r = meshByDir.get(d);
      if (r) r.mesh.visible = d.bornAt <= commitIdx;
    }
  };
}
