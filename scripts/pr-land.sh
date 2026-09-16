#!/bin/bash
# Wait for the checks, then squash-merge and come home.
#
#   npm run pr:land
#
# Blocks until `test` and `database` have both finished, refuses to merge if
# either failed, then squashes, deletes the branch on both sides, returns to
# main and pulls. The waiting is the useful part: merging before the database
# job reports is how a policy regression reaches main with a green tick beside
# it, which is the whole reason that job exists.
set -e

BRANCH=$(git rev-parse --abbrev-ref HEAD)
DEFAULT=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || echo main)

if [ "$BRANCH" = "$DEFAULT" ]; then
  echo "You are on $DEFAULT — there is no pull request to land."
  exit 1
fi

if ! gh pr view >/dev/null 2>&1; then
  echo "No pull request open for $BRANCH. Run: npm run pr"
  exit 1
fi

# The trap that cost a production outage twice over: the deployed app queries
# columns that do not exist yet, because Cloudflare builds from main the moment
# this merges. Said before the merge, while it is still cheap to act on.
if gh pr diff --name-only | grep -q '^supabase/migrations/'; then
  echo
  echo "  ┌─────────────────────────────────────────────────────────────┐"
  echo "  │  This PR adds a migration.                                  │"
  echo "  │  Run  npm run supabase:db:push  BEFORE the Cloudflare build │"
  echo "  │  lands, or the live app queries columns that do not exist.  │"
  echo "  └─────────────────────────────────────────────────────────────┘"
  echo
fi

echo "Waiting for checks…"
# Exits non-zero the moment one fails, so `set -e` stops before the merge.
gh pr checks --watch --fail-fast

gh pr merge --squash --delete-branch

# gh usually returns to the default branch itself, but not in every version,
# and being left on a deleted branch is a confusing place to end up.
git checkout -q "$DEFAULT" 2>/dev/null || true
git pull -q --ff-only

echo
echo "Merged and back on $DEFAULT at $(git rev-parse --short HEAD)."
