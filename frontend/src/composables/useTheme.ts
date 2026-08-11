/**
 * Tema claro/oscuro del design system.
 *
 * El tema se materializa como la clase `.dark` en <html> (Tailwind darkMode: 'class').
 * Preferencia persistida en localStorage; sin preferencia guardada se sigue al sistema
 * (prefers-color-scheme) y se reacciona en vivo si el sistema cambia.
 */
import { ref } from 'vue'

type ThemePref = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'tema'

const pref = ref<ThemePref>((localStorage.getItem(STORAGE_KEY) as ThemePref) || 'system')
const isDark = ref(false)

const media = window.matchMedia('(prefers-color-scheme: dark)')

/** Aplica la preferencia actual al DOM. */
const apply = (): void => {
  const dark = pref.value === 'dark' || (pref.value === 'system' && media.matches)
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
}

// Seguir al sistema en vivo solo mientras la preferencia sea 'system'.
media.addEventListener('change', () => { if (pref.value === 'system') apply() })
apply()

/**
 * Composable de tema. Estado module-scoped: todas las instancias comparten la preferencia.
 * @returns { isDark, pref, setTheme, toggle }.
 */
export function useTheme() {
  /**
   * Fija la preferencia de tema y la persiste.
   * @param value - 'light' | 'dark' | 'system'.
   */
  const setTheme = (value: ThemePref): void => {
    pref.value = value
    localStorage.setItem(STORAGE_KEY, value)
    apply()
  }

  /** Alterna claro ↔ oscuro (fija preferencia explícita). */
  const toggle = (): void => setTheme(isDark.value ? 'light' : 'dark')

  return { isDark, pref, setTheme, toggle }
}
