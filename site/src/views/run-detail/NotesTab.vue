<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../../api';

const props = defineProps<{ data: any; runId: string }>();
const emit = defineEmits<{ (e: 'reload'): void }>();

const newNote = ref('');
const submitting = ref(false);

function fmt(s?: string | null) {
  return s ? new Date(s).toLocaleString('zh-CN') : '—';
}

async function addNote() {
  if (!newNote.value.trim()) return;
  submitting.value = true;
  try {
    await api.addRunNote(props.runId, newNote.value);
    newNote.value = '';
    emit('reload');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
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
</template>
