#!/bin/sh

# Syncs LFS objects from upstream to origin, pushing only the objects
# referenced by upstream/master (not all objects).
#
# Usage: ./scripts/sync-upstream-lfs.sh

set -e

# Create a temporary file for the upstream lfsconfig
TMP_LFSCONFIG=$(mktemp)

# Cleanup on exit
trap 'rm -f "$TMP_LFSCONFIG"' EXIT INT TERM

# Fully-qualified refs
UPSTREAM_MASTER="refs/remotes/upstream/master"

# Step 1: Fetch the lfsconfig from upstream/master into temp file
echo "Fetching lfsconfig from upstream/master..."
git cat-file -p "$UPSTREAM_MASTER:.lfsconfig" >"$TMP_LFSCONFIG"

# Verify we got content
if [ ! -s "$TMP_LFSCONFIG" ]; then
  echo "ERROR: Failed to fetch lfsconfig from upstream/master" >&2
  exit 1
fi

echo "Using lfsconfig:"
cat "$TMP_LFSCONFIG"

# Step 2: Fetch LFS objects from upstream using their config
# GIT_LFS_CONFIG overrides the .lfsconfig file path
echo "Fetching LFS objects from upstream ($UPSTREAM_MASTER)..."
GIT_LFS_CONFIG="$TMP_LFSCONFIG" git lfs fetch upstream "$UPSTREAM_MASTER"

# Step 3: Get the full OIDs of all LFS files in upstream/master
# --long gives the full SHA256 OID (not just the short prefix)
# git lfs push --object-id requires full OIDs to locate the files
# This gives us the "same scope" - just the objects referenced by upstream/master
echo "Collecting OIDs for LFS files in upstream/master..."
OID_LIST=$(git lfs ls-files --long "$UPSTREAM_MASTER" | awk '{print $1}')

if [ -z "$OID_LIST" ]; then
  echo "No LFS files found in upstream/master, nothing to push."
  exit 0
fi

# Count for display
OID_COUNT=$(echo "$OID_LIST" | wc -l | tr -d ' ')
echo "Found $OID_COUNT LFS objects to sync."

# Step 4: Push only those specific OIDs to origin
# Using --object-id ensures we push JUST these objects, not everything
echo "Pushing LFS objects to origin..."
echo "$OID_LIST" | tr '\n' ' ' | xargs git lfs push --object-id origin

echo "Done. LFS objects from upstream/master are now pushed to origin."
