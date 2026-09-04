#!/bin/sh

# Syncs LFS objects from a source ref to a destination remote, pushing only the objects
# referenced by the source ref (not all objects).
#
# Usage: ./scripts/sync-upstream-lfs.sh [SOURCE_REF] [DEST_REMOTE]
# Default: ./scripts/sync-upstream-lfs.sh upstream/master origin

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

# Step 2: Fetch LFS objects from source remote using their config
# GIT_LFS_CONFIG overrides the .lfsconfig file path
echo "Fetching LFS objects from ${SOURCE_REMOTE} (${FULL_SOURCE_REF})..."
GIT_LFS_CONFIG="$TMP_LFSCONFIG" git lfs fetch "$SOURCE_REMOTE" "$FULL_SOURCE_REF"

# Step 3: Get the full OIDs of all LFS files in source ref
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

# Step 4: Push only those specific OIDs to destination remote
# Using --object-id ensures we push JUST these objects, not everything
echo "Pushing LFS objects to ${DEST_REMOTE}..."
echo "$OID_LIST" | tr '\n' ' ' | xargs git lfs push --object-id "$DEST_REMOTE"

echo "Done. LFS objects from ${SOURCE_REF} are now pushed to ${DEST_REMOTE}."
