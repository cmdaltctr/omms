#!/usr/bin/env bash

set -euo pipefail

bun run check
bun test
bun run build
