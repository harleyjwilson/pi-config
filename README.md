# Pi Config

My personal [pi](https://github.com/earendil-works/pi-coding-agent) configuration.

## Setup

Clone this repo to `~/.pi/agent/`, add your API keys to `~/.pi/agent/auth.json`, install extension dependencies where noted, then restart pi or run `/reload`.

```bash
mkdir -p ~/.pi
git clone git@github.com:harleyjwilson/pi-config.git ~/.pi/agent
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

## Extensions

| Extension               | What it does                                                                 |
| ----------------------- | ---------------------------------------------------------------------------- |
| **answer/**             | Adds `/answer` for interactive question extraction and Q&A                   |
| **brave-search/**       | Adds Brave Search, readable page scraping, and API-key management             |
| **files/**              | Adds `/files` for repo/session browsing, actions, and git-delta diffs         |
| **review/**             | Adds review commands and review-loop tooling                                 |
| **todos/**              | Adds `/todos` and todo management UI/tooling for `.pi/todos`                 |
| **update/**             | Adds `/update` and `--update` to run the built-in `pi update` command         |
| **usage/**              | Adds `/usage` to show live Codex weekly usage and reset time                  |
| **uv/**                 | Wraps bash/Python tooling so agents use `uv` workflows instead of pip/venv   |
| **youtube-transcript/** | Adds `/youtube-transcript` for YouTube transcript fetching                   |

## Slash commands

| Command               | Description                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| `/answer`             | Extract questions from the last assistant message into an interactive Q&A flow |
| `/brave-search`       | Manage the Brave Search API key or show the Brave usage dashboard link         |
| `/files`              | Browse repo files and files referenced in the current session                  |
| `/review`             | Review code changes, commits, branches, GitHub PRs, or folders                 |
| `/end-review`         | Exit the current review session                                                |
| `/todos`              | Browse and manage todos from `.pi/todos`                                       |
| `/update`             | Run the built-in `pi update` command; pass extra args like `/update --self`    |
| `/usage`              | Show the live Codex weekly usage remaining and reset time                      |
| `/youtube-transcript` | Fetch a YouTube transcript by video id/URL and optional language               |

## References and credits

Extensions in this config are adapted from or inspired by these projects:

- [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) — source/inspiration for `answer`, `files`, `review`, `todos`, and `uv`.
- [badlogic/pi-skills](https://github.com/badlogic/pi-skills) — source/inspiration for the `youtube-transcript` and `brave-search` extensions.
- [davis7dotsh/my-pi-setup](https://github.com/davis7dotsh/my-pi-setup) — source/inspiration for the `update` extension.
