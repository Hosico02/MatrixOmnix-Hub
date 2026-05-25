<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';

const pendingCount = ref(0);

async function refresh() {
  try {
    const r = await api.listProposals('pending');
    pendingCount.value = r.items.length;
  } catch { /* offline */ }
}
onMounted(() => { refresh(); setInterval(refresh, 30_000); });
</script>

<template>
  <nav class="border-b bg-white px-4 py-3 flex gap-6 items-center sticky top-0 z-10">
    <span class="font-bold text-lg">MatrixOmnix Hub</span>
    <router-link to="/" class="hover:underline">运行</router-link>
    <router-link to="/iterate" class="hover:underline">迭代</router-link>
    <router-link to="/standards" class="hover:underline">规则</router-link>
    <router-link to="/mentor" class="hover:underline flex items-center gap-1">
      <span>待办</span>
      <span v-if="pendingCount > 0"
            class="inline-block px-2 py-0.5 text-xs rounded-full bg-amber-200 text-amber-900">
        {{ pendingCount }}
      </span>
    </router-link>
  </nav>
</template>
