#!/bin/sh

# Syncs LFS objects from a source ref to a destination remote, pushing only the objects
# referenced by the source ref (not all objects).
#
# Usage: ./scripts/sync-upstream-lfs.sh [SOURCE_REF] [DEST_REMOTE]
# Default: ./scripts/sync-upstream-lfs.sh upstream/master origin
#
# The source ref's own `.lfsconfig` names the LFS endpoint holding its objects. This repository's
# `.lfsconfig` points at its own endpoint, so objects added upstream are absent here until they are
# fetched from the source endpoint and pushed to the destination one.
#
# `git lfs fetch` exits 0 even when objects are missing from the endpoint it asked, so the objects
# are checked against the local store after fetching. `git lfs push` does fail, which makes the push
# the backstop for the destination.

set -e

SOURCE_REF="${1:-upstream/master}"
SOURCE_REF="${SOURCE_REF#refs/remotes/}"
DEST_REMOTE="${2:-origin}"

SOURCE_REMOTE="${SOURCE_REF%%/*}"
FULL_SOURCE_REF="refs/remotes/${SOURCE_REF}"

# Create a temporary file for the source lfsconfig
TMP_LFSCONFIG=$(mktemp)

# Cleanup on exit
trap 'rm -f "$TMP_LFSCONFIG"' EXIT INT TERM

# Step 1: Fetch the lfsconfig from source ref into temp file
echo "Fetching lfsconfig from ${SOURCE_REF}..."
git cat-file -p "${FULL_SOURCE_REF}:.lfsconfig" >"$TMP_LFSCONFIG"

# Verify we got content
if [ ! -s "$TMP_LFSCONFIG" ]; then
  echo "ERROR: Failed to fetch lfsconfig from ${SOURCE_REF}" >&2
  exit 1
fi

echo "Using lfsconfig:"
cat "$TMP_LFSCONFIG"

# Step 2: Read the source endpoint from that lfsconfig.
# GIT_LFS_CONFIG is not a git-lfs variable, so the endpoint has to be passed as configuration.
# The url line is last-wins, which is also how git itself resolves .lfsconfig.
SOURCE_LFS_URL=$(awk '
  /^[[:space:]]*\[/ { section = tolower($0) }
  section ~ /^[[:space:]]*\[lfs\]/ && /^[[:space:]]*url[[:space:]]*=/ {
    value = $0
    sub(/^[^=]*=[[:space:]]*/, "", value)
    gsub(/[[:space:]]+$/, "", value)
  }
  END { print value }
' "$TMP_LFSCONFIG")

if [ -z "$SOURCE_LFS_URL" ]; then
  echo "ERROR: No lfs.url found in the lfsconfig of ${SOURCE_REF}" >&2
  exit 1
fi

echo "Source LFS endpoint: ${SOURCE_LFS_URL}"

# Step 3: Fetch LFS objects for the source ref from the source endpoint.
echo "Fetching LFS objects from ${SOURCE_REMOTE} (${FULL_SOURCE_REF})..."
git -c "lfs.url=${SOURCE_LFS_URL}" lfs fetch "$SOURCE_REMOTE" "$FULL_SOURCE_REF"

# Step 4: Get the full OIDs of all LFS files in source ref
# --long gives the full SHA256 OID (not just the short prefix)
# git lfs push --object-id requires full OIDs to locate the files
# This gives us the "same scope" - just the objects referenced by source ref
echo "Collecting OIDs for LFS files in ${SOURCE_REF}..."
OID_LIST=$(git lfs ls-files --long "$FULL_SOURCE_REF" | awk '{print $1}')

if [ -z "$OID_LIST" ]; then
  echo "No LFS files found in ${SOURCE_REF}, nothing to push."
  exit 0
fi

# Count for display
OID_COUNT=$(echo "$OID_LIST" | wc -l | tr -d ' ')
echo "Found $OID_COUNT LFS objects to sync."

# Step 5: Fail if any object is still absent from the local store, since a missing object would
# otherwise only surface as a smudge failure during some later checkout.
MISSING=""

LFS_DIR=$(git lfs env | sed -n 's/^LocalMediaDir=//p')
if [ -z "$LFS_DIR" ]; then
  echo "ERROR: Could not determine the local LFS store from 'git lfs env'" >&2
  exit 1
fi

for OID in $OID_LIST; do
  PREFIX=$(echo "$OID" | cut -c1-2)
  SUFFIX=$(echo "$OID" | cut -c3-4)
  if [ ! -f "${LFS_DIR}/${PREFIX}/${SUFFIX}/${OID}" ]; then
    MISSING="${MISSING} ${OID}"
  fi
done

if [ -n "$MISSING" ]; then
  echo "ERROR: ${SOURCE_LFS_URL} did not provide these objects:" >&2
  for OID in $MISSING; do
    echo "  ${OID}" >&2
  done
  exit 1
fi

echo "All ${OID_COUNT} objects are present in the local LFS store."

# Step 6: Push only those specific OIDs to destination remote
# Using --object-id ensures we push JUST these objects, not everything
echo "Pushing LFS objects to ${DEST_REMOTE}..."
echo "$OID_LIST" | git lfs push --object-id "$DEST_REMOTE" --stdin

echo "Done. LFS objects from ${SOURCE_REF} are now pushed to ${DEST_REMOTE}."
