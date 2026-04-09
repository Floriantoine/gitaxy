import type { RepoData } from './types';

export async function loadRepo(url: string): Promise<RepoData> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Impossible de charger ${url} (HTTP ${res.status}). Lance d'abord : npm run scan -- <chemin-du-repo>`,
    );
  }
  return (await res.json()) as RepoData;
}
