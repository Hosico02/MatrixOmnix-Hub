<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import HumanLabel from '../components/HumanLabel.vue';
import { humanize } from '../humanize';

const router = useRouter();
const tab = ref<'pending' | 'decided'>('pending');
const items = ref<any[]>([]);
const loading = ref(false);
async function load() {
  loading.value = true;
  try {
    if (tab.value === 'pending') items.value = (await api.listProposals('pending')).items;
    else items.value = (await api.listProposals('approved')).items
      .concat((await api.listProposals('rejected')).items);
  } finally { loading.value = false; }
}
onMounted(load);
</script>

<template>
  <div>
    <p class="text-sm text-gray-600 mb-3">
      系统观察了最近的项目,建议你做这些决定。
    </p>
    <div class="border-b flex gap-4 text-sm mb-3">
      <button @click="tab='pending'; load()" :class="tab==='pending' ? 'font-bold border-b-2 border-blue-600 pb-1' : 'text-gray-500 pb-1'">
        等你决定
      </button>
      <button @click="tab='decided'; load()" :class="tab==='decided' ? 'font-bold border-b-2 border-blue-600 pb-1' : 'text-gray-500 pb-1'">
        最近决定的
      </button>
    </div>
    <div v-if="loading" class="text-sm text-gray-500">加载中…</div>
    <div v-else-if="items.length === 0" class="text-sm text-gray-500">
      {{ tab === 'pending' ? '当前没有待办,Forge 自己跑得不错。' : '没有已决定的项。' }}
    </div>
    <div v-else class="space-y-3">
      <div v-for="p in items" :key="p.id"
           @click="router.push(`/proposals/${p.id}`)"
           class="bg-white border rounded-lg p-4 cursor-pointer hover:bg-gray-50">
        <div class="flex items-center gap-2 text-sm">
          <span class="text-lg">{{ humanize.proposalIcon(p.proposal_type) }}</span>
          <HumanLabel kind="archetype" :id="p.archetype" />
          <span class="text-gray-400">·</span>
          <span>{{ humanize.proposalType(p.proposal_type) }}</span>
          <span v-if="p.status !== 'pending'" class="ml-auto text-xs text-gray-500">{{ p.status }}</span>
        </div>
        <div class="text-sm mt-1">{{ p.body_md.slice(0, 200) }}</div>
      </div>
    </div>
  </div>
</template>
