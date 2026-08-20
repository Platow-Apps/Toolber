#!/bin/bash
set -e

echo "Running all tests..."
echo ""

echo "=== test:no-direct-pickup-location ==="
npm run --silent test:no-direct-pickup-location
echo ""

echo "=== test:lint ==="
npm run --silent test:lint
echo ""

echo "=== test:types ==="
npm run --silent test:types
echo ""

echo "=== test:knip ==="
npm run --silent test:knip
echo ""

echo "=== test:security ==="
npm run --silent test:security
echo ""

echo "=== test:audit ==="
npm run --silent test:audit
echo ""

echo "=== test:ava ==="
npm run --silent test:ava
echo ""

echo "All tests passed!"
