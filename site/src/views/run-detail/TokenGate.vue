<script setup lang="ts">
import { ref } from 'vue';
import { useRunnerStore } from '../../stores/runner';

const emit = defineEmits<{
  (e: 'saved'): void;
}>();

const store = useRunnerStore();
const input = ref('');
const checking = ref(false);
const errorMsg = ref('');

async function probe(token: string): Promise<boolean> {
  const r = await fetch('/admin/runs/current',
    { headers: { Authorization: `Bearer ${token}` } });
  return r.status === 200 || r.status === 204;
}

async function save() {
  const t = input.value.trim();
  if (!t) {
    errorMsg.value = '令牌不能为空。';
    return;
  }
  checking.value = true;
  errorMsg.value = '';
  try {
    const ok = await probe(t);
    if (!ok) {
      errorMsg.value = '令牌被 Hub 拒绝。';
      return;
    }
    store.setToken(t);
    input.value = '';
    emit('saved');
  } catch (e) {
    errorMsg.value = '校验失败：' + String(e);
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <div class="bg-yellow-50 border border-yellow-200 rounded p-4 text-sm space-y-2">
    <div class="font-medium">需要管理员令牌才能查看原始日志</div>
    <input v-model="input"
           @keyup.enter="save"
           type="password"
           placeholder="HUB_ADMIN_TOKEN"
           class="w-full border rounded p-2 text-sm" />
    <div class="flex items-center gap-2">
      <button @click="save" :disabled="checking"
              class="px-3 py-1 bg-blue-600 text-white rounded text-sm">
        {{ checking ? '校验中…' : '保存' }}
      </button>
      <span v-if="errorMsg" class="text-red-600 text-xs">{{ errorMsg }}</span>
    </div>
  </div>
</template>
