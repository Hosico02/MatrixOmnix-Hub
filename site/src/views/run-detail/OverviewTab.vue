<script setup lang="ts">
import StatusBadge from '../../components/StatusBadge.vue';
import HumanLabel from '../../components/HumanLabel.vue';

const props = defineProps<{ data: any }>();

function fmt(s?: string | null) {
  return s ? new Date(s).toLocaleString('zh-CN') : '—';
}
function iterVerdicts(itId: string) {
  return (props.data?.verdicts ?? []).filter((v: any) => v.iteration_id === itId);
}
function verdictFindings(vId: string) {
  return (props.data?.findings ?? []).filter((f: any) => f.verdict_id === vId);
}
</script>

<template>
  <div class="space-y-6">
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
      <h3 class="font-semibold mb-2">Forge 这次都做了什么</h3>
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
  </div>
</template>
