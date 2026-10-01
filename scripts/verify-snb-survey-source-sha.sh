#!/usr/bin/env bash
set -euo pipefail

# Usage: SOURCE_SHA=<sha> verify-snb-survey-source-sha.sh
# Run inside a full-history checkout whose origin/main is the reviewed main branch.
: "${SOURCE_SHA:?source_sha is required}"
main_ref="${SNB_SURVEY_MAIN_REF:-origin/main}"

if [[ ! "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'source_sha must be a full 40-character lowercase commit SHA.' >&2
  exit 1
fi
if ! git cat-file -e "${SOURCE_SHA}^{commit}" 2>/dev/null; then
  echo 'source_sha does not exist in this repository.' >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$SOURCE_SHA" "$main_ref"; then
  echo 'source_sha is not contained in main.' >&2
  exit 1
fi
main_head="$(git rev-parse "${main_ref}^{commit}")"
if [[ "$SOURCE_SHA" != "$main_head" ]]; then
  echo 'source_sha is not the current main HEAD.' >&2
  exit 1
fi
echo 'source_sha is the current main HEAD.'
