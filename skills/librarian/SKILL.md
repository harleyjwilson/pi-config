---
name: librarian
description: "Cache and refresh remote git repositories under ~/.cache/checkouts/<host>/<org>/<repo> so future references can reuse a local copy. Use this skill when the user points you to a remote git repository as reference or you encountered a remote git repo through other means."
---

Use this skill when the user points you to a remote git repository (GitHub/GitLab/Bitbucket URLs, `git@...`, or `owner/repo` shorthand).

The goal is to keep a reusable local checkout that is:
- **stable** (predictable path)
- **up to date** (periodic fetch + fast-forward when safe)
- **efficient** (partial clone with `--filter=blob:none`, no repeated full clones)

## Cache location

Repositories are stored at:

`~/.cache/checkouts/<host>/<org>/<repo>`

Example:

`github.com/mitsuhiko/minijinja` → `~/.cache/checkouts/github.com/mitsuhiko/minijinja`

## Command

Resolve this skill's directory first, then invoke its script by absolute path (do not assume the current working directory):

```bash
bash /absolute/path/to/skills/librarian/checkout.sh <repo> --path-only
```

Examples:

```bash
bash /absolute/path/to/skills/librarian/checkout.sh mitsuhiko/minijinja --path-only
bash /absolute/path/to/skills/librarian/checkout.sh github.com/mitsuhiko/minijinja --path-only
bash /absolute/path/to/skills/librarian/checkout.sh https://github.com/mitsuhiko/minijinja --path-only
```

The script will:
1. Parse and validate the repo reference into a safe host/org/repo cache path.
2. Clone if missing.
3. Reuse an existing checkout if present, retaining its configured `origin`.
4. Fetch from `origin` when stale (default interval: 300s).
5. Attempt a fast-forward merge if the checkout is clean and has an upstream.

## Update strategy

- Default behavior is **throttled refresh** (every 5 minutes) to avoid unnecessary network calls.
- Force immediate refresh with:

```bash
bash /absolute/path/to/skills/librarian/checkout.sh <repo> --force-update --path-only
```

## Recommended workflow

1. Resolve repository path via `checkout.sh --path-only`.
2. Use that path for searching, reading, and analysis.
3. On later references to the same repo, call `checkout.sh` again; it will find and update the cached checkout.

## If edits are needed

Prefer not to edit directly in the shared cache. Create a separate worktree or copy from the cached checkout for task-specific modifications.

## Notes

- `owner/repo` defaults to `github.com`.
- Shorthand and web URLs clone over HTTPS. Explicit `git@host:org/repo.git` and `ssh://` references clone over SSH; ensure the relevant credentials are available.
- Repository components containing traversal segments (`.` or `..`) or unsafe characters are rejected.
