# Branch Visualization — Design Spec

## Overview

Add branch visualization to gitView's 3D constellation. Each branch is represented as a **full duplicate** of the main constellation in a ghostly/gaseous style, connected to main by a single dashed root-to-root link. Merges trigger a spectacular fusion animation.

## Data Model

### Scanner changes (`src/cli/scan-repo.mjs`)

New git commands:
- `git branch -a` — list all branches
- `git log --all --oneline --parents` — full commit graph with parent hashes
- `git merge-base <branch> <main>` — find fork point for each branch

Output `repo.json` gains a `branches` array:

```json
{
  "meta": { ... },
  "tree": { ... },
  "commits": [ ... ],
  "branches": [
    {
      "name": "feature-auth",
      "forkCommitIdx": 12,
      "mergeCommitIdx": 45,
      "commits": [13, 14, 15, 16],
      "color": "0xc864ff"
    },
    {
      "name": "develop",
      "forkCommitIdx": 3,
      "mergeCommitIdx": null,
      "commits": [4, 5, 6, 7, 8],
      "color": "0x44ddcc"
    }
  ]
}
```

### New type (`src/viewer/data/types.ts`)

```ts
type BranchInfo = {
  name: string;
  forkCommitIdx: number;
  mergeCommitIdx: number | null; // null = open branch
  commits: number[];
  color: number;
};
```

`RepoData` gains `branches: BranchInfo[]`.

## Layout

### Spatial positioning

Each active branch creates a full clone of the layout, offset horizontally:

```
branch-1 (ghostly)    main (solid)    branch-2 (ghostly)
     [===]---------|--------[===]---------|--------[===]
            dashed link           dashed link
```

- Main stays at `(0, 0, 0)`
- Branches offset at `500 * index` on X axis, alternating left/right
- Camera auto-adjusts FOV or distance to frame all visible clusters

### Ghostly rendering (branch clusters)

Branch clusters reuse existing rendering modules but with modified materials:

| Element | Main (solid) | Branch (ghostly) |
|---------|-------------|-------------------|
| Dir spheres | opacity 1.0 | opacity 0.35, transparent |
| Dir halos | radius ×2.0, opacity 0.12 | radius ×2.8, opacity 0.20 |
| Files | opacity 1.0 | opacity 0.45, transparent |
| File halos | radius ×2.5 | radius ×3.5 |
| Dir links | opacity 0.32 | opacity 0.18 |
| File tethers | opacity 0.4 | opacity 0.2 |

Additional:
- Color tint: each branch gets a unique color (name hash -> HSL, same algorithm as author comets)
- All elements lerp 30-35% toward branch color
- Nebula: soft radial-gradient particles (`PointsMaterial` with circular `CanvasTexture`) around the cluster, opacity ~0.1

### Root-to-root connection

One per branch:
- `Line` with `LineDashedMaterial` (color = branch color, dashSize 8, gapSize 5)
- Energy particles: 20 points traveling along the line with sinusoidal wobble (`PointsMaterial` with glow texture)
- `computeLineDistances()` called on update for dashing to work

## Author Comets

- The existing `AuthorComets` system handles sprites, lightning arcs, and trails
- For each visible branch: duplicate comets for authors who have commits on that branch
- An author active on both main and a branch has a comet on both galaxies
- Branch comets only animate when `branchScale > 0.3`

## Timeline

### Track markers

On the existing timeline scrubber (`timeline-ui.ts`):
- Branch fork: colored marker `|` at fork commit position, branch color
- Branch merge: golden marker `|` at merge commit position
- Open branches: fork marker only (no merge marker)

### Scrub behavior

| Timeline position | Visual state |
|-------------------|-------------|
| Before fork | Single constellation (main only) |
| At fork | Clone appears with separation animation (~500ms ease-in-out) |
| During branch | Both galaxies live, commits animate on correct cluster |
| At merge | Merge animation, clone absorbed into main |
| After merge | Single constellation |
| Open branch | Clone stays visible from fork to end of timeline |

### Commit info label

The existing commit info display adds the branch name: `[feature-auth] feat: add auth provider`

## Merge Animation

Triggered when timeline reaches a merge commit. Sequence (total ~1.2s):

1. **Converge** (0-300ms): Branch cluster accelerates toward main (ease-out-cubic)
2. **Core flash** (100-600ms): White sphere at contact point, fading to gold, scale 5→30
3. **Shockwave 1** (200-800ms): Gold torus expanding outward (scale 0→200), fading
4. **Shockwave 2** (350-900ms): Purple torus, delayed, wider (scale 0→250)
5. **Spark burst** (150-1000ms): 80 particles in random sphere directions (gold/white/purple), drag decay
6. **Absorb** (300-800ms): Branch cluster scale → 0

All effects use `AdditiveBlending` and `depthWrite: false`.

## Settings

One addition to the existing settings panel (`src/viewer/ui/settings.ts`):
- Toggle checkbox: "Branches" (default: on)
- When off: all branch clusters, connections, and markers hidden

## Files to modify

| File | Change |
|------|--------|
| `src/cli/scan-repo.mjs` | Add branch detection commands, output `branches` array |
| `src/viewer/data/types.ts` | Add `BranchInfo` type, update `RepoData` |
| `src/viewer/data/loader.ts` | Parse `branches` from JSON |
| `src/viewer/scene/layout.ts` | Support creating cloned layouts with offset |
| `src/viewer/scene/nodes.ts` | Support ghostly material params |
| `src/viewer/scene/instances.ts` | Support ghostly file rendering |
| `src/viewer/scene/links.ts` | Support ghostly opacity |
| `src/viewer/scene/branch-cluster.ts` | **NEW** — orchestrates clone creation, nebula, connection line, energy particles |
| `src/viewer/scene/merge-fx.ts` | **NEW** — merge animation (flash, shockwaves, sparks) |
| `src/viewer/scene/timeline.ts` | Handle branch fork/merge events |
| `src/viewer/ui/timeline-ui.ts` | Add branch/merge markers on track |
| `src/viewer/ui/settings.ts` | Add branches toggle |
| `src/viewer/main.ts` | Wire up branch clusters, merge FX, settings toggle |

## Out of scope

- Branch comparison / diff view
- Branch filtering UI (beyond on/off toggle)
- Rebase visualization
- Nested branches (branch off a branch) — future enhancement
