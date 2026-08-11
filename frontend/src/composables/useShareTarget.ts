/**
 * Share target de Android: recibe texto/URL compartido desde otras apps vía el
 * bridge nativo (MainActivity → window event "sistemaShareReceived").
 *
 * El shell genérico solo persiste el contenido compartido en localStorage para
 * que la app concreta lo consuma cuando lo necesite. No ejecuta acción de
 * dominio (eso lo define cada feature que quiera leer `sistema_pending_share`).
 */

const PENDING_KEY = 'sistema_pending_share'
let initialized = false

/** Registra el listener del bridge nativo. Llamar una vez al boot (post-mount). */
export function initShareTarget(): void {
  if (initialized) return
  initialized = true

  window.addEventListener('sistemaShareReceived', (ev: Event) => {
    const detail = ev as unknown as { text?: string; detail?: { text?: string } }
    const text = detail?.text || detail?.detail?.text || ''
    if (!text.trim()) return
    // Persistir para que la feature interesada lo procese al estar lista.
    localStorage.setItem(PENDING_KEY, text)
  })
}

/**
 * Lee y consume el contenido compartido pendiente, si lo hay.
 * @returns El texto compartido, o null si no hay nada pendiente.
 */
export function takePendingShare(): string | null {
  const text = localStorage.getItem(PENDING_KEY)
  if (text) localStorage.removeItem(PENDING_KEY)
  return text
}
