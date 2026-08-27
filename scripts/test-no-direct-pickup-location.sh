#!/bin/bash
# CI guard: fail if client code ever reads a privacy-critical column directly.
#
# Toolber's central security promise is that a tool's exact pickup location is
# only visible to someone whose specific borrow request has been approved, and
# that a crib's real home coordinates are never visible to anyone. asking_price
# (0021_tool_for_sale.sql) is the same shape for a different reason: a tool's
# asking price is deliberately not public, only the tool's owner can read it
# back, and a prospective buyer sees the for_sale flag and inquires via chat
# instead. All three are enforced in Postgres by column-level GRANT/REVOKE
# (supabase/migrations), with a dedicated RPC as the single sanctioned read
# path for each.
#
# Column grants would reject a direct read at runtime, but the failure surfaces
# as an opaque "permission denied for table tools" in front of a user. This
# check catches it at commit time instead. See CLAUDE.md -> Patterns to Follow.
#
# Exclusions (where naming these columns is expected and correct):
#   supabase/       - the migrations that define the columns and the RPCs
#   docs/           - design documentation
#   mvp/, toolber.jsx - the frozen pre-build prototype, not part of the app
#   *.test.*        - the tests that assert this very rule
#   scripts/        - this file, which necessarily names the patterns
set -e

# Column name inside a supabase-js select/insert/update string, or any
# mention of the private home coordinates.
PATTERN='pickup_location|home_lat|home_lng|asking_price'

MATCHES=$(git grep -l -E "$PATTERN" -- \
  'src' \
  ':!*.test.js' \
  ':!*.test.jsx' \
  || true)

FAILED=0
for file in $MATCHES; do
  # Only *reads* are the problem. The REVOKE is on SELECT, so the owner writing
  # their own pickup_location (ListTool), home coordinates (Onboarding), or
  # asking_price (ListTool) is allowed. A read looks like the column name
  # inside a PostgREST column string — `select("id, name, pickup_location")`
  # — or a property access on a returned row; a write looks like a bare
  # object-literal key, `pickup_location: value`.
  READS=$(grep -nE "[\"'][^\"']*($PATTERN)[^\"']*[\"']|\.($PATTERN)\b" "$file" \
    | grep -vE "get_pickup_location|get_asking_price" \
    || true)
  if [ -n "$READS" ]; then
    echo "Direct read of a protected column in $file:"
    echo "$READS" | sed 's/^/  /'
    FAILED=1
  fi
done

if [ "$FAILED" = "1" ]; then
  echo ""
  echo "pickup_location must only be read through get_pickup_location(),"
  echo "asking_price only through get_asking_price(), and home_lat/home_lng"
  echo "must never be read by the client at all."
  echo "See CLAUDE.md -> Patterns to Follow -> Pickup location handling."
  exit 1
fi

echo "No direct reads of pickup_location / home_lat / home_lng / asking_price in src/."
