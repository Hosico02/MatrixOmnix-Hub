<script setup lang="ts">
import { humanize } from '../humanize';
const props = defineProps<{ kind: 'archetype' | 'severity' | 'finding' | 'proposalType'; id: string | null }>();
function display() {
  if (!props.id) return '—';
  switch (props.kind) {
    case 'archetype': return humanize.archetype(props.id);
    case 'severity': return humanize.severity(props.id);
    case 'finding': return humanize.findingCategory(props.id);
    case 'proposalType': return humanize.proposalType(props.id);
  }
}
function untranslated() {
  if (props.kind === 'finding' && props.id) return !humanize.hasFindingTranslation(props.id);
  return false;
}
</script>

<template>
  <span>
    {{ display() }}
    <span v-if="untranslated()" class="ml-1 text-xs text-gray-400">[待翻译]</span>
  </span>
</template>
