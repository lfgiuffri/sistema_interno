<template>
  <div ref="rootEl" class="z-select" :class="[`size-${size}`, { open, disabled }]">
    <button
      ref="triggerEl"
      type="button"
      class="z-select-trigger"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span class="z-select-value" :class="{ placeholder: selectedLabel === null }">
        {{ selectedLabel ?? placeholder }}
      </span>
      <ion-icon :icon="chevronDownOutline" class="z-select-caret" />
    </button>

    <!-- Teleport para escapar de contenedores con overflow (tablas, cards). -->
    <teleport to="body">
      <transition name="z-pop">
        <ul
          v-if="open"
          ref="listEl"
          class="z-select-list"
          role="listbox"
          :style="floatStyle"
          @keydown="onListKeydown"
        >
          <li
            v-for="(opt, i) in normalizedOptions"
            :key="String(opt.value)"
            class="z-select-option"
            role="option"
            :aria-selected="opt.value === modelValue"
            :class="{ active: i === activeIndex, selected: opt.value === modelValue }"
            @mouseenter="activeIndex = i"
            @click="select(opt.value)"
          >
            <span class="z-select-option-label">{{ opt.label }}</span>
            <ion-icon v-if="opt.value === modelValue" :icon="checkmarkOutline" class="z-select-check" />
          </li>
        </ul>
      </transition>
    </teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * Select propio de Zero: dropdown accesible con teclado (flechas, Home/End,
 * Enter/Espacio, Escape), focus ring, opciones estilizadas y check en la
 * seleccionada. Reemplaza al <select> nativo en toda la app. El listado se
 * teleporta al body para no quedar recortado por contenedores con overflow.
 */
import { ref, computed, nextTick, onBeforeUnmount, watch } from 'vue'
import { IonIcon } from '@ionic/vue'
import { chevronDownOutline, checkmarkOutline } from 'ionicons/icons'

type Val = string | number
interface Option { value: Val; label: string }

const props = withDefaults(
  defineProps<{
    modelValue: Val | null
    options: Array<Option | string>
    placeholder?: string
    disabled?: boolean
    size?: 'sm' | 'md'
  }>(),
  { placeholder: 'Seleccionar…', disabled: false, size: 'md' },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: Val): void }>()

const rootEl = ref<HTMLElement>()
const triggerEl = ref<HTMLButtonElement>()
const listEl = ref<HTMLElement>()
const open = ref(false)
const activeIndex = ref(-1)
const floatStyle = ref<Record<string, string>>({})

const normalizedOptions = computed<Option[]>(() =>
  props.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)),
)

const selectedLabel = computed<string | null>(() => {
  const found = normalizedOptions.value.find((o) => o.value === props.modelValue)
  return found ? found.label : null
})

/** Posiciona el listado bajo (o sobre) el trigger, en coordenadas de viewport. */
function updatePosition() {
  const t = triggerEl.value
  if (!t) return
  const r = t.getBoundingClientRect()
  const spaceBelow = window.innerHeight - r.bottom
  const openUp = spaceBelow < 240 && r.top > spaceBelow
  floatStyle.value = {
    position: 'fixed',
    left: `${r.left}px`,
    minWidth: `${r.width}px`,
    ...(openUp
      ? { bottom: `${window.innerHeight - r.top + 6}px` }
      : { top: `${r.bottom + 6}px` }),
  }
}

function toggle() {
  if (props.disabled) return
  open.value ? close() : openList()
}

async function openList() {
  updatePosition()
  open.value = true
  activeIndex.value = Math.max(
    0,
    normalizedOptions.value.findIndex((o) => o.value === props.modelValue),
  )
  await nextTick()
  listEl.value?.focus()
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
  document.addEventListener('pointerdown', onDocPointer, true)
}

function close() {
  open.value = false
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
  document.removeEventListener('pointerdown', onDocPointer, true)
  triggerEl.value?.focus()
}

function select(v: Val) {
  emit('update:modelValue', v)
  close()
}

function onDocPointer(ev: PointerEvent) {
  const target = ev.target as Node
  if (rootEl.value?.contains(target) || listEl.value?.contains(target)) return
  close()
}

function onTriggerKeydown(ev: KeyboardEvent) {
  if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(ev.key)) {
    ev.preventDefault()
    openList()
  }
}

function onListKeydown(ev: KeyboardEvent) {
  const last = normalizedOptions.value.length - 1
  switch (ev.key) {
    case 'ArrowDown': ev.preventDefault(); activeIndex.value = Math.min(last, activeIndex.value + 1); break
    case 'ArrowUp': ev.preventDefault(); activeIndex.value = Math.max(0, activeIndex.value - 1); break
    case 'Home': ev.preventDefault(); activeIndex.value = 0; break
    case 'End': ev.preventDefault(); activeIndex.value = last; break
    case 'Enter':
    case ' ': {
      ev.preventDefault()
      const opt = normalizedOptions.value[activeIndex.value]
      if (opt) select(opt.value)
      break
    }
    case 'Escape': ev.preventDefault(); close(); break
    case 'Tab': close(); break
  }
}

// Si el modelo cambia desde afuera con el listado abierto, reposicionar.
watch(() => props.modelValue, () => open.value && updatePosition())

onBeforeUnmount(() => {
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
  document.removeEventListener('pointerdown', onDocPointer, true)
})
</script>

<style scoped>
.z-select { display: inline-block; width: 100%; }

.z-select-trigger {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; padding: 9px 12px;
  background: var(--z-inset);
  border: 1px solid var(--z-border);
  border-radius: var(--z-r-sm);
  color: var(--z-text);
  font-size: 0.875rem; font-family: inherit; font-weight: 500;
  cursor: pointer; outline: none; text-align: left;
  transition: border-color var(--z-t-fast), box-shadow var(--z-t-fast), background var(--z-t-fast);
}
.size-sm .z-select-trigger { padding: 6px 10px; font-size: 0.8rem; }
.z-select-trigger:hover:not(:disabled) { border-color: var(--z-border-strong); background: var(--z-surface-1); }
.z-select-trigger:focus-visible,
.z-select.open .z-select-trigger {
  border-color: var(--z-accent);
  box-shadow: 0 0 0 3px var(--z-accent-soft);
}
.z-select-trigger:disabled { opacity: 0.5; cursor: not-allowed; }

.z-select-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: capitalize; }
.z-select-value.placeholder { color: var(--z-text-mute); text-transform: none; }

.z-select-caret {
  font-size: 1rem; color: var(--z-text-dim); flex-shrink: 0;
  transition: transform var(--z-t), color var(--z-t-fast);
}
.z-select.open .z-select-caret { transform: rotate(180deg); color: var(--z-accent-text); }
</style>

<style>
/* Sin scope: el listado vive en <body> vía teleport. Prefijo z-select para aislar. */
.z-select-list {
  z-index: 3000;
  margin: 0; padding: 6px; list-style: none;
  max-height: 280px; overflow-y: auto;
  background: var(--z-surface-3, #212d45);
  border: 1px solid var(--z-border-strong, rgba(148, 163, 184, 0.22));
  border-radius: 12px;
  box-shadow: var(--z-shadow-lg, 0 24px 60px -18px rgba(2, 6, 23, 0.7));
  outline: none;
}
.z-select-option {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 9px 11px; border-radius: 8px;
  color: var(--z-text-soft, #cbd5e1); font-size: 0.875rem; cursor: pointer;
  transition: background 120ms cubic-bezier(0.32, 0.72, 0, 1);
}
.z-select-option-label { text-transform: capitalize; }
.z-select-option.active { background: rgba(148, 163, 184, 0.1); color: var(--z-text, #f1f5f9); }
.z-select-option.selected { color: var(--z-accent-text, #a5b4fc); font-weight: 600; }
.z-select-check { font-size: 1rem; color: var(--z-accent-text, #a5b4fc); flex-shrink: 0; }

.z-pop-enter-active, .z-pop-leave-active {
  transition: opacity 140ms cubic-bezier(0.32, 0.72, 0, 1), transform 140ms cubic-bezier(0.32, 0.72, 0, 1);
  transform-origin: top center;
}
.z-pop-enter-from, .z-pop-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }
</style>
