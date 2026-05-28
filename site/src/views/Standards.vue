<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import HumanLabel from '../components/HumanLabel.vue';

const router = useRouter();
const items = ref<any[]>([]);
onMounted(async () => { items.value = (await api.listStandards()).items; });
</script>

<template>
  <div>
    <p class="text-sm text-gray-600 mb-3">
      Forge 在判断"项目算不算 productize 完了"时,按这些规则来。
    </p>
    <div class="space-y-2">
      <div v-for="s in items" :key="s.archetype"
           @click="router.push(`/standards/${s.archetype}`)"
           class="bg-white border rounded-lg p-4 cursor-pointer hover:bg-gray-50">
        <div class="font-medium">
          <HumanLabel kind="archetype" :id="s.archetype" />
        </div>
        <div class="text-sm text-gray-600">
          当前 v{{ s.current_version }} · {{ s.version_count }} 个版本
        </div>
      </div>
    </div>
  </div>
</template>
