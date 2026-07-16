---
name: commit
description: "Read this skill before making git commits"
---

Create a git commit for the current changes using a concise Conventional Commits-style subject.

## Format

`<type>(<scope>): <summary>` or, without a scope, `<type>: <summary>`

- `type` REQUIRED. Use `feat` for new features, `fix` for bug fixes. Other common types: `docs`, `refactor`, `chore`, `test`, `perf`.
- `scope` OPTIONAL. Use a short noun for the affected area (e.g., `api`, `parser`, `ui`).
- `summary` REQUIRED. Short, imperative, <= 72 chars, no trailing period.

## Notes

- Body is OPTIONAL. If needed, add a blank line after the subject and write short paragraphs.
- Accurately represent breaking changes when applicable, following the repository's established convention.
- Do NOT add sign-offs (no `Signed-off-by`).
- Only commit; do NOT push.
- Preserve and run repository commit hooks; do not bypass them unless the user explicitly asks.
- If it is unclear whether a file should be included, ask the user which files to commit.
- Treat any caller-provided arguments as additional commit guidance. Common patterns:
  - Freeform instructions should influence scope, summary, and body.
  - File paths or globs should limit which files to commit. If files are specified, only stage/commit those unless the user explicitly asks otherwise.
  - If arguments combine files and instructions, honor both.

## Steps

1. Infer from the prompt whether the user supplied paths/globs and/or commit-message guidance.
2. Review `git status --short`, `git diff --cached`, and `git diff` separately. Never assume pre-staged changes are related to unstaged changes.
3. Stop and ask if there are unrelated staged changes, ambiguous extra files, or an unclear target set. If there are no intended changes, report that and do not create an empty commit.
4. Run `git diff --check` for the intended changes. Check for an in-progress merge, rebase, or cherry-pick before proceeding.
5. (Optional) Run `git log -n 50 --pretty=format:%s` to follow local scope and message conventions.
6. Stage only the intended files. For path-limited commits, use `git add -A -- <paths>` so additions, modifications, and deletions are all included. Do not stage every change merely because some changes were already staged.
7. Run `git commit -m "<subject>"` (and `-m "<body>"` if needed), without bypassing hooks.
8. Verify success with `git status --short` and `git log -1 --format=%s`.
