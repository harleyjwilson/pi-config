# Pi Config

My personal [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) configuration.

## Setup

Clone this repo to `~/.pi/agent/`, add your API keys to `~/.pi/agent/auth.json`, then restart pi.

```bash
mkdir -p ~/.pi
git clone ssh://git@codeberg.org/hjw/pi-config.git ~/.pi/agent
```

To update later:

```bash
cd ~/.pi/agent && git pull
```

## Skills

Loaded on demand when relevant.

| Skill               | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| **commit**          | Instructions for making git commits                                    |
| **frontend-design** | Guidance for designing and building polished frontend UIs              |
| **uv**              | Prefer `uv` over `pip`, `python -m venv`, and related Python workflows |

## Extensions

| Extension   | What it does                                                              |
| ----------- | ------------------------------------------------------------------------- |
| **answer/** | Adds `/answer` and `Ctrl+.` for interactive question extraction and Q&A   |
| **files/**  | Adds `/files` plus file browsing shortcuts for session-referenced files   |
| **review/** | Adds review commands and review-loop tooling                              |
| **todos/**  | Adds `/todos` and todo management UI for `.pi/todos`                      |
| **uv/**     | Wraps Python tooling so agents use `uv` workflows instead of `pip`/`venv` |

## Commands

| Command       | Description                                                                    |
| ------------- | ------------------------------------------------------------------------------ |
| `/answer`     | Extract questions from the last assistant message into an interactive Q&A flow |
| `/files`      | Browse repo files and files referenced in the current session                  |
| `/review`     | Review code changes, commits, branches, GitHub/Codeberg PRs, or folders        |
| `/end-review` | Exit the current review session                                                |
| `/todos`      | Browse and manage todos from `.pi/todos`                                       |

## Credits

Extensions from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): `answer`, `files`, `review`, `todos`, `uv`

Skills from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): `commit`, `frontend-design`, `uv`
