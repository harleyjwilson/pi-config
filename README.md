# Pi Config

My personal [pi](https://github.com/earendil-works/pi-coding-agent) configuration.

## Setup

Clone this repo to `~/.pi/agent/`, add your API keys to `~/.pi/agent/auth.json`, install extension dependencies where noted, then restart pi or run `/reload`.

```bash
mkdir -p ~/.pi
git clone ssh://git@codeberg.org/hjw/pi-config.git ~/.pi/agent
```

To update later:

```bash
cd ~/.pi/agent && git pull
```

Node-based extensions with their own `package.json` need dependencies installed:

```bash
cd ~/.pi/agent/extensions/brave-search && npm install
cd ~/.pi/agent/extensions/youtube-transcript && npm install
```

## Skills

Loaded on demand when relevant.

| Skill                         | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| **commit**                    | Instructions for making git commits                                    |
| **frontend-design**           | Guidance for designing and building polished frontend UIs              |
| **librarian**                 | Cache and refresh remote git repositories for local reference          |
| **svelte-code-writer**        | Svelte 5 documentation lookup and component/module analysis            |
| **svelte-core-bestpractices** | Guidance for robust modern Svelte code                                 |
| **uv**                        | Prefer `uv` over `pip`, `python -m venv`, and related Python workflows |

## Extensions

| Extension               | What it does                                                                 |
| ----------------------- | ---------------------------------------------------------------------------- |
| **answer/**             | Adds `/answer` for interactive question extraction and Q&A                   |
| **brave-search/**       | Adds Brave Search and readable page scraping                                 |
| **files/**              | Adds `/files` for repo/session file browsing, actions, and git-delta diffs   |
| **review/**             | Adds review commands and review-loop tooling                                 |
| **todos/**              | Adds `/todos` and todo management UI/tooling for `.pi/todos`                 |
| **update/**             | Adds `/update` and `--update` to update Pi via the detected install method    |
| **uv/**                 | Wraps bash/Python tooling so agents use `uv` workflows instead of pip/venv   |
| **youtube-transcript/** | Adds `/youtube-transcript` for YouTube transcript fetching                   |

## Slash commands

| Command               | Description                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| `/answer`             | Extract questions from the last assistant message into an interactive Q&A flow |
| `/brave-search`       | Set/get the Brave Search API key or print the Brave usage dashboard link       |
| `/files`              | Browse repo files and files referenced in the current session                  |
| `/review`             | Review code changes, commits, branches, GitHub/Codeberg PRs, or folders       |
| `/end-review`         | Exit the current review session                                                |
| `/todos`              | Browse and manage todos from `.pi/todos`                                       |
| `/update`             | Update Pi using vp, pnpm, bun, npm, brew, or native detection                  |
| `/youtube-transcript` | Fetch a YouTube transcript by video id/URL and optional language               |

## References and credits

Extensions and skills in this config are adapted from or inspired by these projects:

- [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) — source/inspiration for `answer`, `files`, `review`, `todos`, `uv`, plus the `commit`, `frontend-design`, and `uv` skills.
- [badlogic/pi-skills](https://github.com/badlogic/pi-skills) — source/inspiration for `youtube-transcipt` and `brave-search` extensions.
- [davis7dotsh/my-pi-setup](https://github.com/davis7dotsh/my-pi-setup) — source/inspiration for the `update` extension.
