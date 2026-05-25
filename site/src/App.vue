<script setup lang="ts">
import NavBar from './components/NavBar.vue';
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <NavBar />
    <main class="max-w-5xl mx-auto px-4 py-6">
      <router-view />
    </main>
  </div>
</template>
