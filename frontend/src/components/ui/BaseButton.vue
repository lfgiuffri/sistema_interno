<template>
  <button
    class="z-btn"
    :class="[`v-${variant}`, `s-${size}`, { block, loading }]"
    :type="type"
    :disabled="disabled || loading"
  >
    <ion-spinner v-if="loading" name="crescent" class="z-btn-spinner" />
    <ion-icon v-else-if="icon" :icon="icon" class="z-btn-icon" />
    <span v-if="$slots.default" class="z-btn-label"><slot /></span>
  </button>
</template>

<script setup lang="ts">
/**
 * Botón propio de Zero. Variantes: primary (acento sólido), ghost (outline),
 * danger (destructivo), soft (fondo tenue del acento), subtle (neutro).
 * Estados hover/active/focus/disabled/loading unificados vía tokens.
 */
import { IonIcon, IonSpinner } from '@ionic/vue'

withDefaults(
  defineProps<{
    variant?: 'primary' | 'ghost' | 'danger' | 'soft' | 'subtle'
    size?: 'sm' | 'md' | 'lg'
    icon?: string
    type?: 'button' | 'submit'
    block?: boolean
    disabled?: boolean
    loading?: boolean
  }>(),
  { variant: 'primary', size: 'md', type: 'button' },
)
</script>

<style scoped>
.z-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  font-family: inherit; font-weight: 600; letter-spacing: -0.005em;
  border-radius: var(--z-r-sm); border: 1px solid transparent;
  cursor: pointer; white-space: nowrap; line-height: 1.2;
  transition: background var(--z-t-fast), border-color var(--z-t-fast),
    color var(--z-t-fast), box-shadow var(--z-t-fast), transform var(--z-t-fast);
}
.z-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--z-accent-soft); }
.z-btn:active:not(:disabled) { transform: translateY(0.5px) scale(0.99); }
.z-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.z-btn.block { width: 100%; }
.z-btn-icon { font-size: 1.1em; flex-shrink: 0; }
.z-btn-spinner { width: 1.05em; height: 1.05em; }

/* Sizes — min-height cómodo para dedos (accesibilidad, WCAG 2.5.5) */
.s-sm { padding: 8px 14px; min-height: 38px; font-size: var(--z-text-sm); }
.s-md { padding: 11px 18px; min-height: var(--z-touch); font-size: var(--z-text-sm); }
.s-lg { padding: 14px 24px; min-height: 54px; font-size: var(--z-text-base); }

/* Primary — acento con sheen vertical del mismo tono + highlight interno.
   Sheen sutil (no gradiente de dos colores) para lucir físico, no "de plantilla". */
.v-primary {
  background: linear-gradient(180deg, color-mix(in srgb, #fff 13%, var(--z-accent)), var(--z-accent));
  color: #fff;
  border-color: color-mix(in srgb, #000 8%, var(--z-accent));
  box-shadow: var(--z-shadow-accent), inset 0 1px 0 rgba(255, 255, 255, 0.2);
}
.v-primary:hover:not(:disabled) {
  background: linear-gradient(180deg, color-mix(in srgb, #fff 10%, var(--z-accent-strong)), var(--z-accent-strong));
  border-color: var(--z-accent-strong);
  transform: translateY(-1px);
  box-shadow: var(--z-shadow-accent), inset 0 1px 0 rgba(255, 255, 255, 0.22);
}
.v-primary:active:not(:disabled) { transform: translateY(0.5px) scale(0.99); }

/* Soft — fondo tenue del acento */
.v-soft {
  background: var(--z-accent-soft); color: var(--z-accent-text);
  border-color: transparent;
}
.v-soft:hover:not(:disabled) { background: color-mix(in srgb, var(--z-accent) 22%, transparent); }

/* Ghost — outline neutro */
.v-ghost {
  background: transparent; color: var(--z-text-soft);
  border-color: var(--z-border-strong);
}
.v-ghost:hover:not(:disabled) { background: rgba(148, 163, 184, 0.08); color: var(--z-text); border-color: var(--z-text-dim); }

/* Subtle — neutro sin borde */
.v-subtle {
  background: rgba(148, 163, 184, 0.1); color: var(--z-text-soft);
}
.v-subtle:hover:not(:disabled) { background: rgba(148, 163, 184, 0.16); color: var(--z-text); }

/* Danger — destructivo (outline que se rellena) */
.v-danger {
  background: transparent; color: var(--z-danger-text);
  border-color: rgba(239, 68, 68, 0.35);
}
.v-danger:hover:not(:disabled) { background: var(--z-danger); border-color: var(--z-danger); color: #fff; }
</style>
