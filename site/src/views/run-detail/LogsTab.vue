<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useRunnerStore } from '../../stores/runner';
import { useRunLogs } from '../../composables/useRunLogs';
import { deriveMilestones, type Milestone } from '../../lib/milestones';
import { findStdoutOffsetFor, milestoneFractionInTimeline } from '../../lib/jump';
import TokenGate from './TokenGate.vue';

const props = defineProps<{ data: any; runId: string }>();

const store = useRunnerStore();
const logs = useRunLogs();
const scrollHost = ref<HTMLElement | null>(null);
const autoScroll = ref(true);

const milestones = computed<Milestone[]>(() => deriveMilestones(props.data));

function tryStart() {
  const tok = store.adminToken;
  if (!tok) {
    // We let the composable's state stay idle; the gate is shown via v-if.
    return;
  }
  void logs.start(props.runId, tok);
}

onMounted(tryStart);
onBeforeUnmount(() => { logs.stop(); });

watch(() => store.adminToken, (t) => {
  if (t) tryStart();
});

// Auto-scroll: append → next tick → scroll to bottom if autoScroll on.
watch(() => logs.buffer.value, async () => {
  if (!autoScroll.value || !scrollHost.value) return;
  await nextTick();
  scrollHost.value.scrollTop = scrollHost.value.scrollHeight;
});

function onScroll(ev: Event) {
  const el = ev.target as HTMLElement;
  // Disable auto-scroll if user moved away from bottom.
  if (el.scrollTop + el.clientHeight < el.scrollHeight - 20) {
    autoScroll.value = false;
  }
}

function jump(m: Milestone) {
  if (!scrollHost.value) return;
  const offset = findStdoutOffsetFor(
    m.ts,
    logs.buffer.value,
    () => milestoneFractionInTimeline(m, milestones.value),
  );
  // Approximate: scrollTop = offset / buffer.length * scrollHeight
  const len = logs.buffer.value.length;
  if (len === 0) return;
  const fraction = offset / len;
  autoScroll.value = false;
  scrollHost.value.scrollTop = scrollHost.value.scrollHeight * fraction;
}

function fmt(s?: string | null) {
  return s ? new Date(s).toLocaleString('zh-CN') : '—';
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const stateLabel = computed(() => {
  switch (logs.state.value) {
    case 'idle': return '未开始';
    case 'loading': return '加载中…';
    case 'streaming': return '正在追加…';
    case 'eof': return '日志已结束';
    case 'no_log': return '此 run 无原始日志';
    case 'needs_token': return '需要令牌';
    case 'error': return '错误';
  }
  return '';
});
</script>

<template>
  <div class="space-y-3">
    <TokenGate v-if="logs.state.value === 'needs_token' || !store.adminToken"
               @saved="tryStart" />

    <div v-else class="grid grid-cols-1 md:grid-cols-5 gap-3">
      <!-- Left: milestones -->
      <aside class="md:col-span-2 bg-white border rounded-lg p-3 space-y-2 max-h-[700px] overflow-y-auto">
        <h3 class="font-semibold text-sm mb-2">里程碑</h3>
        <ul class="space-y-2">
          <li v-for="m in milestones" :key="m.id"
              class="border-l-2 border-gray-200 pl-2">
            <div class="text-xs text-gray-500">{{ fmt(m.ts) }}</div>
            <div class="text-sm font-medium">{{ m.title }}</div>
            <div v-if="m.subtitle" class="text-xs text-gray-600">{{ m.subtitle }}</div>
            <button v-if="logs.state.value !== 'no_log' && logs.buffer.value.length > 0"
                    @click="jump(m)"
                    class="text-xs text-blue-600 hover:underline">
              → 在日志中查看
            </button>
          </li>
        </ul>
      </aside>

      <!-- Right: stdout -->
      <section class="md:col-span-3 bg-white border rounded-lg p-3">
        <div class="flex items-center gap-3 text-xs text-gray-600 mb-2">
          <label class="flex items-center gap-1">
            <input type="checkbox" v-model="autoScroll" />
            自动滚动
          </label>
          <span>大小 {{ fmtBytes(logs.nextOffset.value) }}</span>
          <span class="ml-auto">{{ stateLabel }}</span>
        </div>
        <div v-if="logs.state.value === 'no_log'" class="text-sm text-gray-500 p-4">
          此 run 无原始日志（外部启动，Hub 只收到了结构化事件）。
        </div>
        <div v-else-if="logs.state.value === 'error'" class="text-sm text-red-600 p-4">
          错误：{{ logs.error.value }}
        </div>
        <pre v-else
             ref="scrollHost"
             @scroll="onScroll"
             class="bg-gray-50 border rounded p-2 text-xs font-mono whitespace-pre overflow-auto max-h-[600px]">{{ logs.buffer.value }}</pre>
      </section>
    </div>
  </div>
</template>
