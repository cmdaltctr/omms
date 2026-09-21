#!/usr/bin/env bash

set -euo pipefail

bun run check
bun test --max-concurrency 1
bun run build
