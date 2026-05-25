<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRunnerStore } from '../stores/runner';
import { useRunner } from '../composables/useRunner';
import { adminApi } from '../api';

const store = useRunnerStore();
const runner = useRunner();

const tokenInput = ref(store.adminToken);
const path = ref('');
const iter = ref(3);

const pushOpen = ref(false);
const remoteUrl = ref('');
const branch = ref('main');
const commitMsg = ref('');
const pushing = ref(false);
const pushResult = ref<any | null>(null);

function saveToken() {
  store.setToken(tokenInput.value);
}

async function onStart() {
  await runner.start(path.value, iter.value);
}

async function onPush() {
  if (!runner.runId.value) return;
  pushing.value = true; pushResult.value = null;
  try {
    pushResult.value = await adminApi.pushGithub(store.adminToken,
                                                 runner.runId.value, {
      remote_url: remoteUrl.value, branch: branch.value,
      commit_message: commitMsg.value,
    });
  } catch (e: any) {
    pushResult.value = { ok: false, error: e?.message ?? String(e) };
  } finally {
    pushing.value = false;
  }
}

// Default commit message once we know iter count + cost.
const suggestedMsg = computed(() => {
  const d = runner.runDetail.value?.run;
  if (!d) return '';
  const iters = d.total_iterations ?? '?';
  const cost = (d.total_cost_usd ?? 0).toFixed(4);
  return `feat: d2p iteration ${iters} (cost $${cost})`;
});

function onPushOpen() {
  pushOpen.value = true;
  if (!commitMsg.value) commitMsg.value = suggestedMsg.value;
}

onMounted(() => {
  // Try to reattach to an in-flight run if there is one.
  if (store.adminToken) void runner.attach();
});
</script>

<template>
  <div class="space-y-6">
    <!-- Token gate -->
    <section v-if="!store.adminToken" class="bg-amber-50 border border-amber-300 rounded-lg p-4">
      <h2 class="font-semibold mb-2">Admin token required</h2>
      <p class="text-sm text-gray-700 mb-3">
        The /iterate page calls admin-gated routes. Paste the
        <code>HUB_ADMIN_TOKEN</code> the Hub was started with.
        It is stored only in this browser's localStorage.
      </p>
      <div class="flex gap-2">
        <input v-model="tokenInput" type="password" placeholder="admin token"
               class="flex-1 border rounded px-3 py-2 text-sm" />
        <button @click="saveToken" class="px-4 py-2 bg-gray-900 text-white rounded text-sm">
          Save
        </button>
      </div>
    </section>

    <!-- Setup -->
    <section v-if="store.adminToken && runner.phase.value === 'idle'"
             class="bg-white border rounded-lg p-4">
      <h2 class="text-base font-semibold mb-3">Run d2p on a folder</h2>
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-medium mb-1">Absolute project path</label>
          <input v-model="path" type="text" placeholder="/Users/you/projects/demo"
                 class="w-full border rounded px-3 py-2 text-sm font-mono" />
        </div>
        <div class="flex items-center gap-3">
          <label class="text-sm font-medium">Max iterations</label>
          <input v-model.number="iter" type="number" min="1" max="10"
                 class="w-20 border rounded px-2 py-1 text-sm" />
        </div>
        <button @click="onStart"
                :disabled="!path || iter < 1 || iter > 10"
                class="px-4 py-2 bg-emerald-600 text-white rounded text-sm disabled:opacity-50">
          Run d2p
        </button>
      </div>
    </section>

    <!-- Starting spinner -->
    <section v-else-if="runner.phase.value === 'starting'"
             class="bg-white border rounded-lg p-4 text-sm">
      Starting d2p subprocess…
    </section>

    <!-- Progress -->
    <section v-else-if="runner.phase.value === 'running' || runner.phase.value === 'terminal'"
             class="bg-white border rounded-lg p-4 space-y-3">
      <div class="flex items-center gap-3">
        <h2 class="text-base font-semibold">
          Run <span class="font-mono text-xs">{{ runner.runId.value?.slice(0, 8) }}</span>
        </h2>
        <span v-if="runner.phase.value === 'running'"
              class="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded">running</span>
        <span v-else
              class="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded">
          {{ runner.runDetail.value?.run?.terminal_state ?? 'terminal' }}
        </span>
      </div>
      <div v-if="runner.runDetail.value?.run" class="text-sm text-gray-700">
        Iter {{ runner.runDetail.value.run.total_iterations || '?' }} ·
        cost ${{ (runner.runDetail.value.run.total_cost_usd || 0).toFixed(4) }} ·
        archetype: {{ runner.runDetail.value.run.detected_archetype || '?' }}
      </div>
      <pre class="bg-gray-900 text-gray-100 text-xs font-mono p-3 rounded h-72 overflow-auto whitespace-pre-wrap"
           >{{ runner.stdoutBuf.value || '(waiting for output…)' }}</pre>

      <div v-if="runner.phase.value === 'terminal'" class="pt-2 border-t">
        <button v-if="!pushOpen" @click="onPushOpen"
                class="px-4 py-2 bg-gray-900 text-white rounded text-sm">
          Push to GitHub →
        </button>
        <div v-else class="space-y-3">
          <h3 class="font-semibold text-sm">Push to existing GitHub repo</h3>
          <div>
            <label class="block text-xs font-medium mb-1">Remote URL</label>
            <input v-model="remoteUrl" type="text"
                   placeholder="git@github.com:user/repo.git"
                   class="w-full border rounded px-3 py-2 text-sm font-mono" />
          </div>
          <div class="flex gap-3">
            <div class="flex-1">
              <label class="block text-xs font-medium mb-1">Branch</label>
              <input v-model="branch" type="text"
                     class="w-full border rounded px-3 py-2 text-sm font-mono" />
            </div>
            <div class="flex-1">
              <label class="block text-xs font-medium mb-1">Commit message</label>
              <input v-model="commitMsg" type="text"
                     class="w-full border rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <button @click="onPush" :disabled="pushing || !remoteUrl"
                  class="px-4 py-2 bg-emerald-600 text-white rounded text-sm disabled:opacity-50">
            {{ pushing ? 'Pushing…' : 'Push' }}
          </button>

          <div v-if="pushResult" class="border rounded p-3 text-xs"
               :class="pushResult.ok ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'">
            <div v-if="pushResult.ok">
              Pushed.
              <a v-if="pushResult.remote_html" :href="pushResult.remote_html" target="_blank"
                 class="underline text-blue-700">{{ pushResult.remote_html }}</a>
            </div>
            <div v-else class="text-red-800">
              Push failed.
              <span v-if="pushResult.error">{{ pushResult.error }}</span>
            </div>
            <pre v-if="pushResult.steps" class="mt-2 font-mono whitespace-pre-wrap">{{
              pushResult.steps.map((s: any) => `[${s.exit}] ${s.cmd}\n${s.output}`.trim()).join('\n\n')
            }}</pre>
          </div>
        </div>
      </div>

      <div class="pt-2">
        <button @click="runner.stop()" class="text-xs text-gray-500 underline">
          Forget this run (does NOT kill it)
        </button>
      </div>
    </section>

    <section v-else-if="runner.phase.value === 'error'"
             class="bg-red-50 border border-red-300 rounded-lg p-4 text-sm text-red-800">
      Error: {{ runner.error.value }}
      <button @click="runner.stop()" class="ml-2 underline">reset</button>
    </section>
  </div>
</template>
