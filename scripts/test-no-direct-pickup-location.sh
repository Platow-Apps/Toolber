#!/bin/bash
# CI guard: fail if client code ever reads a privacy-critical column directly.
#
# Toolber's central security promise is that a tool's exact pickup location is
# only visible to someone whose specific borrow request has been approved, and
# that a crib's real home coordinates are never visible to anyone. Both are
# enforced in Postgres by column-level GRANT/REVOKE (supabase/migrations), with
# get_pickup_location() as the single sanctioned read path.
#
# Column grants would reject a direct read at runtime, but the failure surfaces
# as an opaque "permission denied for table tools" in front of a user. This
# check catches it at commit time instead. See CLAUDE.md -> Patterns to Follow.
#
# Exclusions (where naming these columns is expected and correct):
#   supabase/       - the migrations that define the columns and the RPC
#   docs/           - design documentation
#   mvp/, toolber.jsx - the frozen pre-build prototype, not part of the app
#   *.test.*        - the tests that assert this very rule
#   scripts/        - this file, which necessarily names the patterns
set -e

# `pickup_location` inside a supabase-js select/insert/update string, or any
# mention of the private home coordinates.
PATTERN='pickup_location|home_lat|home_lng'

MATCHES=$(git grep -l -E "$PATTERN" -- \
  'src' \
  ':!*.test.js' \
  ':!*.test.jsx' \
  || true)

FAILED=0
for file in $MATCHES; do
  # Only *reads* are the problem. The REVOKE is on SELECT, so the owner writing
  # their own pickup_location (ListTool) or home coordinates (Onboarding) is
  # allowed. A read looks like the column name inside a PostgREST column string
  # — `select("id, name, pickup_location")` — or a property access on a returned
  # row; a write looks like a bare object-literal key, `pickup_location: value`.
  READS=$(grep -nE "[\"'][^\"']*($PATTERN)[^\"']*[\"']|\.($PATTERN)\b" "$file" \
    | grep -vE "get_pickup_location" \
    || true)
  if [ -n "$READS" ]; then
    echo "Direct read of a protected column in $file:"
    echo "$READS" | sed 's/^/  /'
    FAILED=1
  fi
done

if [ "$FAILED" = "1" ]; then
  echo ""
  echo "pickup_location must only be read through the get_pickup_location() RPC,"
  echo "and home_lat/home_lng must never be read by the client at all."
  echo "See CLAUDE.md -> Patterns to Follow -> Pickup location handling."
  exit 1
fi

echo "No direct reads of pickup_location / home_lat / home_lng in src/."
