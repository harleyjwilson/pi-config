---
name: uv
description: "Use uv as the default Python workflow for new work: run scripts with `uv run`, manage project dependencies with `uv add` and `uv sync`, and use inline metadata for standalone scripts. Follow repository-specific tooling when it conflicts."
---

## Quick Reference

```bash
uv run script.py                       # Run a script
uv run --with requests script.py       # Run with an ad-hoc dependency
uv run python -m ast foo.py >/dev/null # Verify syntax without writing __pycache__
uv add requests                        # Add a project dependency
uv add --group dev pytest              # Add a development dependency
uv sync                                 # Create/update the environment from uv.lock
uv run pytest                          # Run a project command
uv init --script foo.py                # Create a script with inline metadata
```

Use uv for new Python work unless the repository documents another required workflow. Do not replace an existing project's package manager, lockfile, or CI commands without the user's approval. Commit `uv.lock` whenever dependency resolution changes.

## Inline Script Dependencies

```python
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests"]
# ///
```

See [scripts.md](scripts.md) for full details on running scripts, locking, and reproducibility.

## Build Backend

Use `uv_build` for pure Python packages. Prefer `uv init --package` to generate a build-system requirement compatible with the installed uv release. If configuring it manually, keep the backend in the current uv minor-version line:

```toml
[build-system]
requires = ["uv_build>=0.11.29,<0.12"]
build-backend = "uv_build"
```

For extension modules, choose a backend appropriate to the extension technology (for example, `maturin` or `scikit-build-core`). Use `hatchling` when its flexible pure-Python build configuration is a good fit.

See [build.md](build.md) for project structure, namespaces, and file inclusion.
