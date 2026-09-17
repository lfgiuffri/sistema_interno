<script setup lang="ts">
/**
 * Login del PORTAL DE CLIENTES.
 *
 * Mismo esqueleto que `LoginPage.vue` del sistema interno, pero con su propio store y su
 * propio destino. Dos diferencias que importan: entra con EMAIL (es lo que un tercero recuerda
 * sin que se lo expliquen) y no hay «olvidé mi contraseña» — las cuentas las administra el
 * equipo, que es lo que evita tener un flujo de recuperación expuesto a internet.
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { IonPage, IonContent } from '@ionic/vue'
import { usePortalAuthStore } from '@/stores/portal/auth'

const router = useRouter()
const auth = usePortalAuthStore()

const email = ref('')
const password = ref('')

const puedeEnviar = computed(() => !!email.value.trim() && !!password.value && !auth.cargando)

async function enviar(): Promise<void> {
  if (!puedeEnviar.value) return
  if (await auth.login(email.value.trim(), password.value)) {
    await router.replace('/portal')
  }
}
</script>

<template>
  <IonPage>
    <IonContent :scroll-y="false" class="portal-content">
      <div class="min-h-full grid lg:grid-cols-[5fr_4fr] bg-canvas">
        <aside class="hidden lg:flex flex-col justify-between p-10 bg-surface border-r border-line">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-9 grid place-items-center rounded bg-white">
              <img src="/icons/logo.png" alt="" class="w-6" />
            </div>
            <div>
              <p class="text-sm font-semibold text-ink">Positive Media</p>
              <p class="text-2xs text-ink-faint">Portal de clientes</p>
            </div>
          </div>
          <div class="max-w-md">
            <h1 class="text-2xl font-semibold tracking-tight text-ink">Tus incidencias, en un solo lugar</h1>
            <p class="mt-2 text-sm text-ink-soft">
              Cargá lo que necesites resolver, adjuntá lo que haga falta y seguí en qué estado está.
            </p>
          </div>
          <p class="text-2xs text-ink-faint">¿No tenés acceso? Escribinos y te damos de alta.</p>
        </aside>

        <main class="flex items-center justify-center p-6">
          <form class="w-full max-w-sm ds-enter" @submit.prevent="enviar">
            <div class="lg:hidden flex items-center gap-2.5 mb-8">
              <div class="w-8 h-9 grid place-items-center rounded bg-white">
                <img src="/icons/logo.png" alt="" class="w-6" />
              </div>
              <div>
                <p class="text-sm font-semibold text-ink">Positive Media</p>
                <p class="text-2xs text-ink-faint">Portal de clientes</p>
              </div>
            </div>

            <h2 class="text-lg font-semibold text-ink">Ingresá a tu portal</h2>
            <p class="mt-0.5 mb-6 text-sm text-ink-soft">Con el email que nos diste.</p>

            <div class="space-y-3">
              <div>
                <label class="ds-label" for="pt-email">Email</label>
                <input
                  id="pt-email" v-model="email" class="ds-input" type="email"
                  autocomplete="username" inputmode="email" placeholder="vos@tuempresa.com"
                />
              </div>
              <div>
                <label class="ds-label" for="pt-pass">Contraseña</label>
                <input
                  id="pt-pass" v-model="password" class="ds-input" type="password"
                  autocomplete="current-password"
                />
              </div>
            </div>

            <p v-if="auth.error" class="ds-error" role="alert">{{ auth.error }}</p>

            <button type="submit" class="ds-btn-primary w-full h-10 mt-5" :disabled="!puedeEnviar">
              {{ auth.cargando ? 'Ingresando…' : 'Ingresar' }}
            </button>

            <p class="mt-6 text-2xs text-ink-faint text-center">
              ¿Olvidaste tu contraseña? Escribinos y te la reseteamos.
            </p>
          </form>
        </main>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.portal-content { --background: rgb(var(--s-canvas)); }
</style>
