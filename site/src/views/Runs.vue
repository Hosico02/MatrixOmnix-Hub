<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useRunsStore } from '../stores/runs';
import StatusBadge from '../components/StatusBadge.vue';
import HumanLabel from '../components/HumanLabel.vue';

const router = useRouter();
const store = useRunsStore();
let timer: number | null = null;

function fmtTime(s: string) {
  return new Date(s).toLocaleString('zh-CN', { hour12: false });
}

function oneLineOutcome(r: any) {
  if (r.terminal_state === 'CLEAN') return `完美交付,${r.total_iterations} 轮搞定`;
  if (r.terminal_state === 'WITH_RESIDUALS') return `基本可用,有问题没修完`;
  if (r.terminal_state === 'ESCALATED') return `遇到 Forge 修不动的硬骨头,等你介入`;
  if (r.terminal_state === 'TIMEOUT') return `试到上限还没收敛`;
  return '';
}

onMounted(() => {
  store.refresh();
  timer = window.setInterval(() => store.refresh(), 30_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="space-y-6">
    <section v-if="store.active.length > 0">
      <h2 class="text-base font-semibold mb-2">正在跑</h2>
      <div class="space-y-2">
        <div v-for="r in store.active" :key="r.id"
             @click="router.push(`/runs/${r.id}`)"
             class="bg-white border rounded-lg p-4 cursor-pointer hover:bg-gray-50">
          <div class="flex items-center gap-3 mb-1">
            <StatusBadge :state="r.terminal_state" />
            <span class="font-medium">{{ r.project_path.split('/').pop() }}</span>
            <span class="text-xs text-gray-500 ml-auto">开始于 {{ fmtTime(r.started_at) }}</span>
          </div>
          <div class="text-sm text-gray-600">
            <HumanLabel kind="archetype" :id="r.detected_archetype" /> ·
            第 {{ r.total_iterations || '?' }} 轮 · 已花 ¥{{ ((r.total_cost_usd || 0) * 7).toFixed(2) }}
          </div>
        </div>
      </div>
    </section>

    <section>
      <h2 class="text-base font-semibold mb-2">最近 7 天</h2>
      <div v-if="store.recent.length === 0" class="text-sm text-gray-500">没有最近的运行。</div>
      <div v-else class="space-y-2">
        <div v-for="r in store.recent" :key="r.id"
             @click="router.push(`/runs/${r.id}`)"
             class="bg-white border rounded-lg p-4 cursor-pointer hover:bg-gray-50">
          <div class="flex items-center gap-3 mb-1">
            <StatusBadge :state="r.terminal_state" />
            <span class="font-medium">{{ r.project_path.split('/').pop() }}</span>
            <span class="ml-auto text-sm text-gray-600">{{ fmtTime(r.terminated_at || r.started_at) }}</span>
          </div>
          <div class="text-sm text-gray-700">{{ oneLineOutcome(r) }}</div>
        </div>
      </div>
    </section>

    <div v-if="store.error" class="text-red-600 text-sm">{{ store.error }}</div>
  </div>
</template>
