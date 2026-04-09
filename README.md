# Gitaxy

**Visualisation 3D interactive de l'histoire d'un repo Git, facon constellation cosmique.**

Chaque dossier est une etoile, chaque fichier une planete en orbite, chaque auteur une comete qui traverse l'espace. Rejouez l'histoire de votre code comme un timelapse galactique.

Inspire par [Gource](https://gource.io/) mais en 3D, dans le navigateur, avec des effets modernes (bloom, particules, eclairs).

---

## Features

### Visualisation 3D
- **Dossiers = etoiles** avec taille proportionnelle au nombre de fichiers
- **Fichiers = planetes** en orbite multi-niveaux (multi-shell, formes variees par dossier)
- **Connexions parent-enfant** visibles (tethers colores par extension)
- **Distribution dynamique** : les fichiers se repartissent et se reorganisent quand de nouveaux apparaissent
- **Couleur par extension** : .ts bleu, .vue vert, .css rose, .md vert clair, etc.
- **Taille par lignes de code** : gros fichiers = grosses planetes

### Timeline & Histoire Git
- **Replay chronologique** de tout l'historique du repo
- **Barre de timeline** scrubable avec play/pause et vitesse (1x, 5x, 20x, 100x)
- **Apparition animee** : sparkle converge + vol du parent vers l'orbite
- **Modification** : pulse lumineux (flash blanc + wobble)
- **Suppression** : implosion rouge + explosion de sparkles
- **Stagger par profondeur** : dossiers d'abord, puis sous-dossiers, puis fichiers
- **Commits distincts** : 250ms entre chaque commit pour une animation lisible

### Cometes Auteurs
- Chaque auteur = une **comete coloree unique** qui flotte dans la zone des fichiers concernes
- **Eclairs** (lightning arcs) depuis la comete vers chaque fichier cree/modifie/supprime
- **Pulse wave** a l'impact
- Les cometes se deplacent vers le **centroide** des fichiers de chaque commit
- **Follow** : cliquer sur un auteur dans la liste pour suivre sa comete

### Effets Cinematiques (tous toggleables)
- **Bloom** post-processing (UnrealBloomPass)
- **Star sprites** avec scintillement sur les dossiers
- **Trails** lumineux sur les fichiers en orbite
- **Nebuleuses** de fond (desactivees par defaut)
- **Sparkle particles** a la creation et destruction
- Panneau **presets** : High / Medium / Low + compteur FPS

### Interactions
- **Rotation / Zoom / Pan** (OrbitControls)
- **Shift + drag** pour deplacer un dossier (tout le sous-arbre suit)
- **Click** sur un dossier pour focus + follow (la camera suit)
- **Click** sur un fichier pour voir ses infos dans l'inspecteur
- **Expand selection** : toggle qui ecarte les enfants du dossier focus pour mieux lire
- **Orbites dossiers** : mode systeme solaire (toggle)
- **Auto-rotation** camera

### UI
- **Labels CSS2D** sur les dossiers (taille adaptee a la distance camera)
- **Breadcrumb** au survol (chemin complet du fichier/dossier)
- **Highlight parent-path** : survol = chemin lumineux de la racine au fichier
- **Inspecteur** (bas gauche) : infos detaillees au click (taille, lignes, date creation, auteur, modifications)
- **Liste des auteurs** (haut droite) avec couleurs + click pour follow
- **Statistiques** reactives : top contributeurs, fichiers les plus modifies, activite mensuelle — evolue avec la timeline
- **Recherche** (Ctrl+F) : recherche fichiers/dossiers avec highlight + pulse + navigation
- **Minimap 3D** : rendu miniature dans le coin bas-gauche, suit la rotation camera

---

## Installation

```bash
git clone https://github.com/Floriantoine/gitaxy.git
cd gitaxy
npm install
```

## Usage

### Methode rapide (CLI)

```bash
# Visualiser un repo
node src/cli/gitview.mjs /chemin/vers/mon/repo

# Avec port custom
node src/cli/gitview.mjs /chemin/vers/mon/repo --port 3000

# Aide
node src/cli/gitview.mjs --help
```

La CLI scanne le repo, lance le viewer et ouvre le navigateur automatiquement.

### Methode manuelle

```bash
# 1. Scanner un repo git
npm run scan -- /chemin/vers/mon/repo

# 2. Lancer le viewer
npm run dev

# 3. Ouvrir http://localhost:5175
```

---

## Controles

| Action | Controle |
|--------|----------|
| Tourner la vue | Clic gauche + drag |
| Zoomer | Molette |
| Panner | Clic droit + drag |
| Deplacer un dossier | **Shift** + clic gauche + drag |
| Focus un dossier | Clic sur un dossier |
| Infos fichier | Clic sur un fichier |
| Recherche | **Ctrl+F** |
| Play / Pause timeline | **Espace** |
| Quitter la recherche | **Escape** |
| Quitter le focus | Clic sur le fond ou **Escape** |

---

## Panneau Effets

| Toggle | Description |
|--------|-------------|
| Bloom | Post-processing glow |
| Sprites etoiles + scintillement | Cross-flare sur les dossiers |
| Trails (fichiers + dossiers) | Trainees lumineuses |
| Connexions (dossiers + fichiers) | Lignes parent-enfant |
| Labels dossiers | Noms CSS2D au-dessus des dossiers |
| Orbites dossiers (systeme solaire) | Les dossiers orbitent autour de leur parent |
| Auto-rotation camera | Rotation lente automatique |
| Expand selection | Ecarte les enfants du dossier focus |

Presets : **High** (tout ON) / **Medium** / **Low** (minimum pour la performance)

---

## Architecture

```
gitaxy/
├── src/
│   ├── cli/
│   │   ├── gitview.mjs        # CLI entry point (scan + launch)
│   │   └── scan-repo.mjs      # Git repo scanner → JSON
│   └── viewer/
│       ├── main.ts             # Orchestration principale
│       ├── data/
│       │   ├── types.ts        # Types partages CLI/viewer
│       │   └── loader.ts       # Fetch JSON
│       ├── scene/
│       │   ├── setup.ts        # Scene, camera, renderer
│       │   ├── pipeline.ts     # Bloom post-processing
│       │   ├── layout.ts       # Placement 3D recursif
│       │   ├── distribution.ts # Distribution dynamique (golden angle + multi-ring)
│       │   ├── nodes.ts        # Meshes dossiers
│       │   ├── instances.ts    # InstancedMesh fichiers (spawn/pulse/implode)
│       │   ├── links.ts        # Lignes parent-enfant
│       │   ├── trails.ts       # Trainees lumineuses
│       │   ├── starfield.ts    # Etoiles de fond
│       │   ├── star-sprites.ts # Cross-flare sprites
│       │   ├── spawn-particles.ts # Particules convergentes/explosives
│       │   ├── author-comets.ts   # Cometes auteurs + eclairs
│       │   ├── dir-orbits.ts      # Mode systeme solaire
│       │   ├── focus.ts           # Camera focus + follow
│       │   ├── hover.ts           # Tooltip + breadcrumb + highlight
│       │   ├── interactions.ts    # Drag + click
│       │   ├── timeline.ts        # State machine play/scrub
│       │   ├── labels.ts          # CSS2D labels
│       │   └── colors.ts          # Palette extensions + metriques
│       ├── ui/
│       │   ├── settings.ts     # Panneau toggles + presets
│       │   ├── timeline-ui.ts  # Barre timeline
│       │   ├── legend.ts       # Legende extensions
│       │   ├── inspector.ts    # Panneau infos fichier/dossier
│       │   ├── stats.ts        # Dashboard statistiques reactif
│       │   ├── search.ts       # Recherche Ctrl+F
│       │   ├── minimap.ts      # Minimap 3D
│       │   ├── fps.ts          # Compteur FPS
│       │   └── context-menu.ts # Menu contextuel (reserve)
│       └── style.css
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Stack technique

- **Three.js** 0.160 — rendu 3D + post-processing
- **TypeScript** — types stricts
- **Vite** — dev server + HMR + build
- **InstancedMesh** — 1 draw call pour des milliers de fichiers
- **CSS2DRenderer** — labels HTML en 3D
- **Canvas 2D** — textures procedurales (sparkles, flares, rings)

## Donnees

Le scanner CLI lit le repo via `git ls-files` + `git log` et produit un JSON :
- Arbre hierarchique avec taille/lignes par fichier
- `bornAt` / `modifiedAt` / `deletedAt` par fichier
- Liste de commits avec auteur/date/message/added/modified/deleted
- Comptage de lignes (skip binaires, detection null-byte)

## Performance

- **InstancedMesh** : 2500+ fichiers en 1 draw call
- **BufferGeometry** partagee + cache quantifie pour les dossiers
- **Trails** : ring buffer + teleportation detection
- **Distribution** : O(1) par item (golden angle)
- **Throttle** : stats recalculees tous les 5 commits, labels tous les N frames
- **Toggles** : chaque effet desactivable pour gagner en FPS
- Presets Low/Med/High

---

## License

MIT

---

*Built with Three.js, TypeScript, and a lot of cosmic inspiration.*
