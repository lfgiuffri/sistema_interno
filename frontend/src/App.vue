<template>
  <ion-app>
    <ion-router-outlet />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue'
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { setupNativeBackButton } from '@/composables/useNativeBackButton'
import { Capacitor } from '@capacitor/core'

const authStore = useAuthStore()
const router = useRouter()

// Registrar el handler del back-button hardware (Android).
// Debe correr en setup, no en onMounted, para que `useBackButton` se enganche correctamente.
setupNativeBackButton(router)

onMounted(async () => {
  await authStore.init()

  if (Capacitor.isNativePlatform()) {
    // Marcar el body para que CSS pueda diferenciar native vs web
    // (ej: padding-top compacto en chat, sin sumar safe-area-inset-top).
    document.body.classList.add('platform-native')

    // StatusBar: NO overlay del WebView para que ion-header no quede oculto
    // tras la status bar del sistema.
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar')
      await StatusBar.setOverlaysWebView({ overlay: false })
      await StatusBar.setStyle({ style: Style.Dark })
      await StatusBar.setBackgroundColor({ color: '#1e293b' })
    } catch (err) {
      console.warn('[StatusBar] config failed:', err)
    }

    // Keyboard: modo Ionic — resize del área Ionic. Además desactivamos el scroll
    // nativo del WebView: Android intenta scrollear la página completa para enfocar
    // el textarea y eso termina sacando el header del top. El chat ya usa ion-content
    // para el scroll interno, así que el auto-scroll nativo sobra.
    try {
      const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard')
      await Keyboard.setResizeMode({ mode: KeyboardResize.Ionic })
      await Keyboard.setScroll({ isDisabled: true })
    } catch (err) {
      console.warn('[Keyboard] config failed:', err)
    }
  }
})
</script>
