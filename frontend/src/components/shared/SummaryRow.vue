<template>
  <div class="summary-row">
    <div v-for="card in cards" :key="card.label" class="summary-card">
      <span class="summary-number" :class="card.color">{{ card.value }}</span>
      <span class="summary-label">{{ card.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface SummaryCard {
  value: string | number
  label: string
  color: string
}

defineProps<{
  cards: SummaryCard[]
}>()
</script>

<style scoped>
.summary-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
.summary-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 14px; text-align: center; }
.summary-number { font-size: 1.5rem; font-weight: 700; display: block; }
.summary-label { font-size: 0.75rem; color: #6b7280; }
.text-yellow { color: #eab308; }
.text-green { color: #10b981; }
.text-red { color: #ef4444; }
.text-blue { color: #3b82f6; }
.text-purple { color: #8b5cf6; }
.text-gray { color: #6b7280; }
</style>
