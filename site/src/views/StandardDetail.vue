<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import HumanLabel from '../components/HumanLabel.vue';

const route = useRoute();
const router = useRouter();
const data = ref<any>(null);
const tab = ref<'current' | 'history' | 'pending'>('current');
const archetype = computed(() => route.params.archetype as string);
async function load() { data.value = await api.getStandardsHistory(archetype.value); }
onMounted(load);
function fmt(s?: string | null) { return s ? new Date(s).toLocaleDateString('zh-CN') : '—'; }
const currentBody = computed(() => data.value?.versions?.[0]?.body_md ?? '');
</script>

<template>
  <div v-if="data" class="space-y-4">
    <button @click="router.back()" class="text-sm text-gray-500 hover:underline">← 返回</button>
    <h2 class="text-lg font-bold">
      <HumanLabel kind="archetype" :id="archetype" /> 的规则
    </h2>

    <div class="border-b flex gap-4 text-sm">
      <button @click="tab='current'" :class="tab==='current' ? 'font-bold border-b-2 border-blue-600 pb-1' : 'text-gray-500 pb-1'">现在用的</button>
      <button @click="tab='history'" :class="tab==='history' ? 'font-bold border-b-2 border-blue-600 pb-1' : 'text-gray-500 pb-1'">
        改动历史 ({{ data.versions.length }})
      </button>
      <button @click="tab='pending'" :class="tab==='pending' ? 'font-bold border-b-2 border-blue-600 pb-1' : 'text-gray-500 pb-1'">
        待决定 ({{ data.proposals.length }})
      </button>
    </div>

    <pre v-if="tab==='current'" class="bg-white border rounded p-4 text-sm whitespace-pre-wrap">{{ currentBody }}</pre>

    <ul v-else-if="tab==='history'" class="space-y-3">
      <li v-for="v in data.versions" :key="v.id" class="bg-white border rounded p-3">
        <div class="text-sm">
          <span class="font-medium">v{{ v.version }}</span> · {{ fmt(v.created_at) }}
        </div>
        <pre v-if="v.diff_from_prev_md" class="text-xs text-gray-700 mt-1 whitespace-pre-wrap">{{ v.diff_from_prev_md }}</pre>
      </li>
    </ul>

    <ul v-else class="space-y-2">
      <li v-for="p in data.proposals" :key="p.id"
          @click="router.push(`/proposals/${p.id}`)"
          class="bg-white border rounded p-3 cursor-pointer hover:bg-gray-50">
        <div class="text-sm">{{ p.proposal_type }}</div>
        <div class="text-xs text-gray-600 mt-1">{{ p.body_md.slice(0, 120) }}</div>
      </li>
    </ul>
  </div>
</template>
