<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import HumanLabel from '../components/HumanLabel.vue';
import { humanize } from '../humanize';

const route = useRoute();
const router = useRouter();
const data = ref<any>(null);
const editing = ref(false);
const editedBody = ref('');
async function load() {
  data.value = await api.getProposal(route.params.id as string);
  editedBody.value = data.value.proposal.body_md;
}
onMounted(load);
async function approve() {
  await api.decideProposal(route.params.id as string, 'approve',
    editing.value ? { edited_body_md: editedBody.value } : undefined);
  router.push('/mentor');
}
async function reject() {
  await api.decideProposal(route.params.id as string, 'reject');
  router.push('/mentor');
}
const isPending = computed(() => data.value?.proposal?.status === 'pending');
</script>

<template>
  <div v-if="data" class="space-y-4">
    <button @click="router.back()" class="text-sm text-gray-500 hover:underline">← 返回</button>
    <header class="flex items-center gap-2">
      <span class="text-2xl">{{ humanize.proposalIcon(data.proposal.proposal_type) }}</span>
      <HumanLabel kind="archetype" :id="data.proposal.archetype" />
      <span class="text-gray-400">·</span>
      <span class="font-medium">{{ humanize.proposalType(data.proposal.proposal_type) }}</span>
    </header>

    <section class="bg-white border rounded-lg p-4">
      <div v-if="!editing" class="text-sm whitespace-pre-wrap">{{ data.proposal.body_md }}</div>
      <textarea v-else v-model="editedBody" rows="8" class="w-full border rounded p-2 text-sm"></textarea>
    </section>

    <section class="bg-white border rounded-lg p-4">
      <div class="text-sm font-medium mb-2">为什么提:</div>
      <p class="text-sm text-gray-700 whitespace-pre-wrap">{{ data.proposal.rationale_md }}</p>
    </section>

    <section v-if="data.evidence.length > 0" class="bg-white border rounded-lg p-4">
      <div class="text-sm font-medium mb-2">涉及的例子 ({{ data.evidence.length }}):</div>
      <ul class="text-sm space-y-1">
        <li v-for="e in data.evidence.slice(0, 10)" :key="e.id">
          · <HumanLabel kind="finding" :id="e.category" />
          <span class="text-gray-500">(<HumanLabel kind="severity" :id="e.severity" />)</span>
        </li>
      </ul>
    </section>

    <div v-if="isPending" class="flex gap-2">
      <button @click="approve" class="px-4 py-2 bg-green-600 text-white rounded">
        {{ editing ? '✓ 改完接受' : '✓ 接受' }}
      </button>
      <button @click="reject" class="px-4 py-2 bg-gray-500 text-white rounded">✗ 不要</button>
      <button v-if="!editing" @click="editing = true" class="px-4 py-2 border rounded">✎ 改下措辞</button>
    </div>
    <div v-else class="text-sm text-gray-500">
      已决定: {{ data.proposal.status }} 于 {{ data.proposal.decided_at }}
    </div>
  </div>
</template>
