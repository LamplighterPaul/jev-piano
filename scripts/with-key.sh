#!/usr/bin/env bash
# Run a command with the TypeSafe key injected from 1Password. The key is never
# written to disk and never printed.
exec op run --env-file="$(dirname "$0")/../.env.op" --no-masking -- "$@"
