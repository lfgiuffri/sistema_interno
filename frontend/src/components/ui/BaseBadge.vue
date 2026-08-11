<template>
  <span class="z-badge" :class="`t-${tone}`">
    <span v-if="dot" class="z-badge-dot" />
    <slot />
  </span>
</template>

<script setup lang="ts">
/** Badge/pill de estado reutilizable. Tono semántico + punto opcional. */
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
    dot?: boolean
  }>(),
  { tone: 'neutral' },
)
</script>

<style scoped>
.z-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; border-radius: var(--z-r-pill);
  font-size: 0.7rem; font-weight: 600; letter-spacing: 0.02em;
  text-transform: capitalize; white-space: nowrap;
  border: 1px solid transparent;
}
.z-badge-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

.t-neutral { background: rgba(148, 163, 184, 0.12); color: var(--z-text-dim); }
.t-accent  { background: var(--z-accent-soft); color: var(--z-accent-text); }
.t-success { background: var(--z-success-soft); color: var(--z-success-text); }
.t-warning { background: var(--z-warning-soft); color: var(--z-warning-text); }
.t-danger  { background: var(--z-danger-soft); color: var(--z-danger-text); }
.t-info    { background: rgba(99, 102, 241, 0.14); color: #818cf8; }
</style>
