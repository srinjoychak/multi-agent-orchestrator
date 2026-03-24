#!/bin/bash

# Exit on errors
set -e

echo "Building Gemini worker..."
docker build -t worker-gemini -f docker/workers/Dockerfile.gemini .

echo "Building Claude worker..."
docker build -t worker-claude -f docker/workers/Dockerfile.claude .

# Disable exit on error for testing
set +e

echo "Testing Gemini worker..."
if docker run --rm -v ~/.gemini:/home/node/.gemini worker-gemini --version > /dev/null 2>&1; then
    echo "Gemini: PASS"
else
    echo "Gemini: FAIL"
fi

echo "Testing Claude worker..."
if docker run --rm -v ~/.claude:/home/node/.claude worker-claude --version > /dev/null 2>&1; then
    echo "Claude: PASS"
else
    echo "Claude: FAIL"
fi
