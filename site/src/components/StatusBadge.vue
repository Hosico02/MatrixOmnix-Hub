<script setup lang="ts">
import { humanize } from '../humanize';

const props = defineProps<{ state: string | null }>();
</script>

<template>
  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm">
    <span>{{ humanize.stateIcon(props.state) }}</span>
    <span>{{ humanize.state(props.state) }}</span>
  </span>
</template>
