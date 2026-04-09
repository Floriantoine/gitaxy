// Shared shape between the CLI output and the viewer.
// The CLI (src/cli/scan-repo.mjs) writes JSON matching these types.

export type FileNode = {
  name: string;
  type: 'file';
  size: number;
  lines: number;
  /** Commit index where this file first appeared in history. */
  bornAt: number;
  /** Sorted commit indices where this file was modified. */
  modifiedAt: number[];
};

export type DirNode = {
  name: string;
  type: 'dir';
  children: TreeNode[];
};

export type TreeNode = FileNode | DirNode;

export type RepoMeta = {
  repo: string;
  path: string;
  fileCount: number;
  totalSize: number;
  totalLines: number;
  commitCount: number;
  scannedAt: string;
};

export type CommitInfo = {
  hash: string;
  date: string; // ISO 8601
  author: string;
  message: string;
  /** Paths added in this commit (only currently-tracked files). */
  added: string[];
  /** Paths modified in this commit. */
  modified: string[];
  /** Paths deleted in this commit. */
  deleted?: string[];
};

export type RepoData = {
  meta: RepoMeta;
  tree: DirNode;
  commits: CommitInfo[];
};
