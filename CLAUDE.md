# Working with Claude here

## Brainstorm → build flow

Keep it short and simple first; expand only when asked.

1. Brainstorm: layouts as text wireframes, features as short bullets. Desktop first, plus one line per screen on how it collapses on mobile.
2. Cut to the smallest v1 before any review.
3. Write v1 as a GitHub issue with 3-6 acceptance checks (survives sessions and compaction).
4. Review the issue once: strong model, medium effort, at most 5 problems ranked by severity.
5. Build in thin slices on a branch, with a Cloudflare preview deploy per PR.
6. CI (tests, types) gates the merge.
7. One fresh-context review of the PR diff against the acceptance checks: mid model, low effort.
8. A repeated mistake becomes one line in the project CLAUDE.md.

High effort only for auth, payments, data deletion or migrations. No model review for anything CI catches.
