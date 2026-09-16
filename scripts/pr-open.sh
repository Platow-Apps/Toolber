#!/bin/bash
# Branch, commit, push and open a pull request — in one command.
#
# Once `main` requires the `test` and `database` status checks, a direct push
# is rejected: the checks cannot have run on a commit the remote has never
# seen. The five-step dance that replaces it is the same five steps every
# time, which is exactly the sort of thing worth writing down once.
#
#   npm run pr -- "Short description of the change"
#       Commits everything in the tree with that message, branches off main
#       using a slug of it, pushes, and opens the PR.
#
#   npm run pr
#       For work already committed. This project writes long commit messages
#       that will not pass as a shell argument, so committing by hand first is
#       the normal path — including the very common case of having committed
#       onto main out of habit, which this rescues rather than refuses.
#
# Deliberately does NOT run the test suite. That was the point of moving to
# pull requests: CI runs the full gate chain and the database suite on every
# push, and a red PR harms nothing because nothing reached main. Running the
# whole chain locally as well would add two minutes to every change to learn
# the same thing twice.
set -e

MESSAGE="$*"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DEFAULT=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || echo main)

HAS_CHANGES=$(git status --porcelain | head -1)

# Commits sitting on the local default branch that the remote has never seen.
# Committing onto main is this project's twelve-month habit and the ruleset
# does not stop it — it stops the *push*. So the commits need moving, not a
# lecture.
UNPUSHED=0
if [ "$BRANCH" = "$DEFAULT" ]; then
  git fetch -q origin "$DEFAULT" 2>/dev/null || true
  UNPUSHED=$(git rev-list --count "origin/$DEFAULT..HEAD" 2>/dev/null || echo 0)
fi

if [ -z "$HAS_CHANGES" ] && [ "$UNPUSHED" -eq 0 ] && [ "$BRANCH" = "$DEFAULT" ]; then
  echo "Nothing to open a pull request for: the tree is clean and $DEFAULT matches the remote."
  exit 1
fi

if [ -n "$HAS_CHANGES" ] && [ -z "$MESSAGE" ] && [ "$UNPUSHED" -eq 0 ]; then
  echo "There are uncommitted changes but no message."
  echo
  echo "  npm run pr -- \"Short description\"   commits everything and opens the PR"
  echo "  git commit …  &&  npm run pr         for a longer message written by hand"
  exit 1
fi

# A branch per change, named from the message — or, when the work is already
# committed, from the subject of the first commit that is not on the remote.
# The PR list then reads as a list of changes rather than of dates. A short
# timestamp is appended because the same description twice must not collide
# with a branch that already exists.
if [ "$BRANCH" = "$DEFAULT" ]; then
  SOURCE="$MESSAGE"
  if [ -z "$SOURCE" ]; then
    SOURCE=$(git log --format=%s "origin/$DEFAULT..HEAD" | tail -1)
  fi

  SLUG=$(echo "$SOURCE" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
    | cut -c1-48)
  [ -z "$SLUG" ] && SLUG="change"

  BRANCH="$SLUG-$(date +%m%d%H%M)"
  git checkout -q -b "$BRANCH"

  # Take the commits with us and put the local default branch back where the
  # remote has it. Without this, main keeps drifting ahead of origin and the
  # next pull is a merge nobody asked for.
  if [ "$UNPUSHED" -gt 0 ]; then
    git branch -q -f "$DEFAULT" "origin/$DEFAULT"
    echo "Moved $UNPUSHED commit(s) off $DEFAULT onto $BRANCH, and rewound $DEFAULT to the remote."
  else
    echo "Branched: $BRANCH"
  fi
fi

if [ -n "$HAS_CHANGES" ]; then
  git add -A
  git commit -q -m "$MESSAGE"
  echo "Committed."
fi

git push -q -u origin "$BRANCH"
echo "Pushed: $BRANCH"

# --fill takes the title and body from the commits, so a carefully written
# commit message is not retyped into a PR form.
if gh pr view >/dev/null 2>&1; then
  echo "Pull request already open, updated with the new commits:"
  gh pr view --json url --jq '.url'
else
  gh pr create --fill --base "$DEFAULT"
fi

echo
echo "Checks are running. When they pass:  npm run pr:land"
