<template>
  <div class="z-stat" :class="`tone-${tone}`">
    <div class="z-stat-icon"><ion-icon :icon="icon" /></div>
    <div class="z-stat-body">
      <span class="z-stat-value z-num">{{ value }}</span>
      <span class="z-stat-label">{{ label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/** Tarjeta de métrica: ícono tonal + valor grande (tabular) + etiqueta. */
withDefaults(
  defineProps<{
    icon: string
    value: string | number
    label: string
    tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info'
  }>(),
  { tone: 'accent' },
)
</script>

<style scoped>
.z-stat {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 15px;
  padding: 18px 20px;
  background: var(--z-surface-2);
  border: 1px solid var(--z-border);
  border-radius: var(--z-r-md);
  transition: border-color var(--z-t), background var(--z-t), transform var(--z-t), box-shadow var(--z-t);
}
/* Hairline superior tonal: firma sutil de color por métrica. */
.z-stat::before {
  content: ''; position: absolute; inset: 0 0 auto 0; height: 1px;
  background: linear-gradient(90deg, transparent, var(--stat-tint, var(--z-accent)), transparent);
  opacity: 0.5; transition: opacity var(--z-t);
}
.z-stat:hover {
  border-color: var(--z-border-strong); background: var(--z-surface-3);
  transform: translateY(-2px); box-shadow: var(--z-shadow-md);
}
.z-stat:hover::before { opacity: 0.9; }

.z-stat-icon {
  width: 46px; height: 46px; border-radius: var(--z-r-sm); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 1.3rem;
  border: 1px solid transparent;
  transition: box-shadow var(--z-t), border-color var(--z-t);
}
.tone-accent  { --stat-tint: var(--z-accent); }
.tone-success { --stat-tint: var(--z-success); }
.tone-warning { --stat-tint: var(--z-warning); }
.tone-danger  { --stat-tint: var(--z-danger); }
.tone-info    { --stat-tint: #6366f1; }
.tone-accent  .z-stat-icon { background: var(--z-accent-soft); color: var(--z-accent-text); }
.tone-success .z-stat-icon { background: var(--z-success-soft); color: var(--z-success-text); }
.tone-warning .z-stat-icon { background: var(--z-warning-soft); color: var(--z-warning-text); }
.tone-danger  .z-stat-icon { background: var(--z-danger-soft); color: var(--z-danger-text); }
.tone-info    .z-stat-icon { background: rgba(99, 102, 241, 0.14); color: #818cf8; }
.z-stat:hover .z-stat-icon {
  border-color: color-mix(in srgb, var(--stat-tint) 40%, transparent);
  box-shadow: 0 0 18px -4px color-mix(in srgb, var(--stat-tint) 55%, transparent);
}

.z-stat-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.z-stat-value { font-size: 1.7rem; font-weight: 700; color: var(--z-text); line-height: 1; letter-spacing: -0.025em; }
.z-stat-label { font-size: 0.76rem; color: var(--z-text-dim); letter-spacing: 0.005em; }
</style>
