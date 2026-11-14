export interface Env {
  CACHE: KVNamespace;
  GITHUB_OWNERS: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ALLOW_UNAUTHENTICATED?: string;
  GITHUB_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

export type CiState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null;

export interface Repo {
  owner: string;
  name: string;
  url: string;
  isPrivate: boolean;
  pushedAt: string | null;
  openPrs: number;
  openIssues: number;
  ci: CiState;
}

export interface WorkerScript {
  name: string;
  modifiedOn: string | null;
}

export interface PagesProject {
  name: string;
  url: string | null;
  deployedAt: string | null;
  status: string | null;
}

export interface Snapshot {
  generatedAt: string;
  repos: Repo[];
  workers: WorkerScript[];
  pages: PagesProject[];
  /** One entry per source that failed. The rest of the snapshot is still valid. */
  errors: string[];
}
