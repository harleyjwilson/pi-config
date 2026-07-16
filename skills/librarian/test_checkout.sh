#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checkout="$skill_dir/checkout.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cache="$tmp/cache"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

prepare_checkout() {
  local host="$1" org="$2" repo="$3" origin="$4"
  local path="$cache/$host/$org/$repo"
  mkdir -p "$path"
  git -C "$path" init -q
  git -C "$path" remote add origin "$origin"
  date +%s > "$path/.git/librarian-last-fetch"
}

prepare_checkout github.com acme widget https://github.com/acme/widget.git
actual="$(LIBRARIAN_CACHE_ROOT="$cache" "$checkout" acme/widget --path-only)"
[[ "$actual" == "$cache/github.com/acme/widget" ]] || fail "shorthand path was $actual"

prepare_checkout gitlab.com team/platform api https://gitlab.com/team/platform/api.git
actual="$(LIBRARIAN_CACHE_ROOT="$cache" "$checkout" gitlab.com/team/platform/api --path-only)"
[[ "$actual" == "$cache/gitlab.com/team/platform/api" ]] || fail "nested-group path was $actual"

prepare_checkout github.com private project git@github.com:private/project.git
LIBRARIAN_CACHE_ROOT="$cache" "$checkout" git@github.com:private/project.git --path-only >/dev/null
[[ "$(git -C "$cache/github.com/private/project" remote get-url origin)" == "git@github.com:private/project.git" ]] || fail "existing SSH origin changed"

for ref in invalid '../../outside/repo' 'github.com/acme/../repo' 'https://../acme/repo' 'https://github.com/acme/repo with space'; do
  if LIBRARIAN_CACHE_ROOT="$cache" "$checkout" "$ref" --path-only >/dev/null 2>&1; then
    fail "invalid reference was accepted: $ref"
  fi
done

bash -n "$checkout"
echo "librarian checkout tests passed"
