<template>
  <div class="page-header">
    <div>
      <h1 class="page-title">{{ title }}</h1>
      <p class="page-subtitle">{{ subtitle }}</p>
    </div>
    <button v-if="buttonLabel" class="action-btn-primary" @click="$emit('action')">{{ buttonLabel }}</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  subtitle: string
  buttonLabel?: string
}>()

defineEmits<{
  action: []
}>()
</script>

<style scoped>
.page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; gap: 12px; flex-wrap: wrap; }
.page-title { font-size: 1.75rem; font-weight: 500; color: #fff; margin: 0; }
.page-subtitle { color: #6b7280; font-size: 0.875rem; margin-top: 4px; }
.action-btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 500; cursor: pointer; border: none; background: #8b5cf6; color: #fff; transition: background 0.15s; white-space: nowrap; }
.action-btn-primary:hover { background: #7c3aed; }
</style>
