#!/usr/bin/env bash
set -euo pipefail

dry_run=0
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
  shift
fi

version="${1:-}"
if [[ -z "$version" || $# -ne 1 ]]; then
  echo "Usage: scripts/release.sh [--dry-run] <0.1.x|0.1.x-rc.N>" >&2
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

branch="$(git branch --show-current)"
release_json="$(node scripts/check-release.mjs --version "$version" --branch "$branch")"
tag="$(node -e 'console.log(JSON.parse(process.argv[1]).tag)' "$release_json")"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean; refusing to tag a release." >&2
  exit 1
fi

git fetch --tags origin "$branch"
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse "origin/$branch")"
if [[ "$local_sha" != "$remote_sha" ]]; then
  echo "Local $branch ($local_sha) does not match origin/$branch ($remote_sha)." >&2
  exit 1
fi

ci_status="$(gh run list --workflow=ci.yml --branch "$branch" --commit "$local_sha" --limit 1 --json conclusion --jq '.[0].conclusion')"
if [[ "$ci_status" != "success" ]]; then
  echo "CI for $branch@$local_sha is '${ci_status:-missing}', not successful." >&2
  exit 1
fi

credentials_status="$(gh run list --workflow=publish.yml --branch "$branch" --commit "$local_sha" --limit 1 --json conclusion --jq '.[0].conclusion')"
if [[ "$credentials_status" != "success" ]]; then
  echo "The repository-owned npm credential check for $branch@$local_sha is '${credentials_status:-missing}', not successful." >&2
  exit 1
fi

required_js="$(node -e "import('./scripts/release-policy.mjs').then(m => console.log(m.requiredGenlayerJsVersion))")"
published_js="$(npm view "genlayer-js@$required_js" version)"
if [[ "$published_js" != "$required_js" ]]; then
  echo "Required genlayer-js@$required_js is not available on npm." >&2
  exit 1
fi

for package_name in \
  @genlayer/transaction-kit \
  @genlayer/transaction-kit-react \
  @genlayer/transaction-kit-vue; do
  if npm view "$package_name@$version" version >/dev/null 2>&1; then
    echo "$package_name@$version is already published; refusing to reuse it." >&2
    exit 1
  fi
done

npm ci
npm run typecheck
npm run build
npm test
npm run pack:check

if [[ "$dry_run" -eq 1 ]]; then
  echo "Dry run passed for $tag on $branch@$local_sha."
  exit 0
fi

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Local tag $tag already exists." >&2
  exit 1
fi
if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  echo "Remote tag $tag already exists." >&2
  exit 1
fi

git tag -a "$tag" -m "Release $tag"
git push origin "refs/tags/$tag"
echo "Pushed $tag. The tag-owned publish workflow will release all three packages."
