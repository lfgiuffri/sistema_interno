/**
 * Cierra un modal con la tecla Escape mientras esté abierto.
 * Escucha en window (el foco puede estar en cualquier campo del form) y se limpia sola.
 */
import { watch, onUnmounted, type Ref } from 'vue'

export function useEscapeToClose(isOpen: Ref<boolean>, close: () => void): void {
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') close()
  }

  watch(isOpen, (open) => {
    if (open) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  })

  onUnmounted(() => window.removeEventListener('keydown', onKey))
}
