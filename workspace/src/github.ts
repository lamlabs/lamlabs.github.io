import type { CiState, Repo } from './types';

const QUERY = `query($owner: String!) {
  repositoryOwner(login: $owner) {
    repositories(first: 25, isFork: false, orderBy: { field: PUSHED_AT, direction: DESC }) {
      nodes {
        name url isPrivate pushedAt
        pullRequests(states: OPEN) { totalCount }
        issues(states: OPEN) { totalCount }
        defaultBranchRef { target { ... on Commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

interface RepoNode {
  name: string;
  url: string;
  isPrivate: boolean;
  pushedAt: string | null;
  pullRequests: { totalCount: number };
  issues: { totalCount: number };
  defaultBranchRef: { target: { statusCheckRollup?: { state: CiState } | null } | null } | null;
}

/** The 25 most recently pushed non-fork repos of one owner, in one GraphQL request. */
export async function fetchRepos(owner: string, token: string, fetcher: typeof fetch = fetch): Promise<Repo[]> {
  const res = await fetcher('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'workspace-dashboard',
    },
    body: JSON.stringify({ query: QUERY, variables: { owner } }),
  });
  if (!res.ok) throw new Error(`GitHub ${owner}: HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: { repositoryOwner: { repositories: { nodes: RepoNode[] } } | null };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(`GitHub ${owner}: ${body.errors[0]!.message}`);
  const nodes = body.data?.repositoryOwner?.repositories.nodes;
  if (!nodes) throw new Error(`GitHub ${owner}: owner not found`);
  return nodes.map((n) => ({
    owner,
    name: n.name,
    url: n.url,
    isPrivate: n.isPrivate,
    pushedAt: n.pushedAt,
    openPrs: n.pullRequests.totalCount,
    openIssues: n.issues.totalCount,
    ci: n.defaultBranchRef?.target?.statusCheckRollup?.state ?? null,
  }));
}
