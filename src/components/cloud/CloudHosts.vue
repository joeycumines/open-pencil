<script setup lang="ts">
import CloudConnectHost from './connect/CloudConnectHost.vue'
import CloudInvitationHost from './invitation/CloudInvitationHost.vue'
import CloudNewWorkspaceHost from './workspace/CloudNewWorkspaceHost.vue'
import CloudWorkspaceMembersHost from './workspace/CloudWorkspaceMembersHost.vue'

/** Cloud's app-wide dialogs: connecting a server, invitations, and managing workspaces. */
</script>

<template>
  <CloudConnectHost />
  <CloudInvitationHost />
  <CloudNewWorkspaceHost />
  <CloudWorkspaceMembersHost />
</template>
