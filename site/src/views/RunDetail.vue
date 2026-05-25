<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge.vue';
import HumanLabel from '../components/HumanLabel.vue';

const route = useRoute();
const router = useRouter();
const data = ref<any>(null);
const newNote = ref('');
const submitting = ref(false);

async function load() { data.value = await api.getRun(route.params.id as string); }
async function addNote() {
  if (!newNote.value.trim()) return;
  submitting.value = true;
  try { await api.addRunNote(route.params.id as string, newNote.value); newNote.value = ''; await load(); }
  finally { submitting.value = false; }
}
onMounted(load);
function fmt(s?: string | null) { return s ? new Date(s).toLocaleString('zh-CN') : '—'; }
function iterVerdicts(itId: string) {
  return (data.value?.verdicts ?? []).filter((v: any) => v.iteration_id === itId);
}
function verdictFindings(vId: string) {
  return (data.value?.findings ?? []).filter((f: any) => f.verdict_id === vId);
}
</script>

<template>
  <div v-if="data" class="space-y-6">
    <button @click="router.back()" class="text-sm text-gray-500 hover:underline">← 返回</button>

    <header class="bg-white border rounded-lg p-4 space-y-2">
      <div class="flex items-center gap-3">
        <StatusBadge :state="data.run.terminal_state" />
        <span class="font-bold text-lg">{{ data.run.project_path.split('/').pop() }}</span>
      </div>
      <div class="text-sm text-gray-600">
        <HumanLabel kind="archetype" :id="data.run.detected_archetype" /> ·
        {{ data.run.total_iterations }} 轮 · 用了 ¥{{ ((data.run.total_cost_usd || 0) * 7).toFixed(2) }}
        · {{ fmt(data.run.started_at) }} → {{ fmt(data.run.terminated_at) }}
      </div>
    </header>

    <section class="bg-white border rounded-lg p-4">
      <h3 class="font-semibold mb-2">d2p 这次都做了什么</h3>
      <div v-for="it in data.iterations" :key="it.id" class="border-l-2 border-gray-200 pl-3 mb-3">
        <div class="text-sm font-medium">第 {{ it.iter_n }} 轮</div>
        <div v-if="it.analyzer_summary" class="text-xs text-gray-600">
          分析: {{ it.analyzer_summary }}
        </div>
        <div v-if="it.planner_summary" class="text-xs text-gray-600">
          计划: {{ it.planner_summary }}
        </div>
        <div v-if="it.executor_summary" class="text-xs text-gray-600">
          执行: {{ it.executor_summary }}
        </div>
        <div v-for="v in iterVerdicts(it.id)" :key="v.id">
          <div class="text-sm mt-1">检查: {{ v.verdict }}<span v-if="v.confidence"> (置信度 {{ v.confidence.toFixed(2) }})</span></div>
          <ul class="ml-4 text-sm space-y-1 mt-1">
            <li v-for="f in verdictFindings(v.id)" :key="f.id">
              · <HumanLabel kind="finding" :id="f.category" />
              <span class="text-gray-500">
                (<HumanLabel kind="severity" :id="f.severity" />)
              </span>
              <div v-if="f.evidence" class="text-xs text-gray-500 ml-4">{{ f.evidence }}</div>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section class="bg-white border rounded-lg p-4">
      <h3 class="font-semibold mb-2">备注</h3>
      <ul class="space-y-1 mb-2 text-sm">
        <li v-for="n in data.notes" :key="n.id">
          <span class="text-gray-500">[{{ n.author === 'human' ? '你' : '自动' }} · {{ fmt(n.created_at) }}]</span>
          {{ n.body_md }}
        </li>
      </ul>
      <textarea v-model="newNote" rows="2"
                class="w-full border rounded p-2 text-sm"
                placeholder="加一条备注…"></textarea>
      <button @click="addNote" :disabled="submitting"
              class="mt-1 px-3 py-1 bg-blue-600 text-white rounded text-sm">
        加备注
      </button>
    </section>
  </div>
  <div v-else class="text-sm text-gray-500">加载中…</div>
</template>
