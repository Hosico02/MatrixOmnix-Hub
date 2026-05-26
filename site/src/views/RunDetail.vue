<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import OverviewTab from './run-detail/OverviewTab.vue';
import LogsTab from './run-detail/LogsTab.vue';
import NotesTab from './run-detail/NotesTab.vue';

const route = useRoute();
const router = useRouter();
const data = ref<any>(null);

type TabKey = 'overview' | 'logs' | 'notes';
const VALID_TABS: TabKey[] = ['overview', 'logs', 'notes'];

function tabFromHash(): TabKey {
  const h = (route.hash || '').replace(/^#/, '');
  return (VALID_TABS as string[]).includes(h) ? (h as TabKey) : 'overview';
}

const active = ref<TabKey>(tabFromHash());

watch(() => route.hash, () => { active.value = tabFromHash(); });

function select(k: TabKey) {
  active.value = k;
  router.replace({ hash: `#${k}` });
}

async function load() {
  data.value = await api.getRun(route.params.id as string);
}
onMounted(load);

const runId = computed(() => route.params.id as string);
</script>

<template>
  <div v-if="data" class="space-y-4">
    <button @click="router.back()" class="text-sm text-gray-500 hover:underline">← 返回</button>

    <nav class="flex gap-1 border-b">
      <button v-for="k in (['overview','logs','notes'] as const)"
              :key="k"
              @click="select(k)"
              :class="[
                'px-3 py-2 text-sm border-b-2 -mb-px',
                active === k
                  ? 'border-blue-600 text-blue-700 font-medium'
                  : 'border-transparent text-gray-600 hover:text-gray-900',
              ]">
        {{ k === 'overview' ? '概览' : k === 'logs' ? '日志' : '备注' }}
      </button>
    </nav>

    <OverviewTab v-if="active === 'overview'" :data="data" />
    <LogsTab v-else-if="active === 'logs'" :data="data" :run-id="runId" />
    <NotesTab v-else-if="active === 'notes'" :data="data" :run-id="runId" @reload="load" />
  </div>
  <div v-else class="text-sm text-gray-500">加载中…</div>
</template>
