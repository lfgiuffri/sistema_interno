<script setup lang="ts">
/**
 * Login del Sistema Interno: usuario/contraseña + segundo factor (TOTP) opcional.
 *
 * Split-screen en desktop (panel de marca a la izquierda, form a la derecha);
 * columna única en mobile. Estados completos: cargando, error inline y paso MFA.
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { IonPage, IonContent, IonIcon } from '@ionic/vue'
import { arrowForwardOutline, keyOutline, chevronBackOutline } from 'ionicons/icons'
import { useAuthStore } from '@/stores/auth'
import { useMeStore } from '@/stores/me'

const router = useRouter()
const authStore = useAuthStore()
const meStore = useMeStore()

const username = ref('')
const password = ref('')
const mfaCode = ref('')
const mfaToken = ref('')
const step = ref<'credentials' | 'mfa'>('credentials')

const canSubmit = computed(() =>
  step.value === 'credentials'
    ? username.value.trim().length > 0 && password.value.length > 0
    : mfaCode.value.trim().length >= 6
)

/** Entra al área de trabajo tras una sesión emitida. */
async function enter(): Promise<void> {
  await meStore.loadContext()
  router.replace('/panel')
}

async function submit(): Promise<void> {
  if (!canSubmit.value || authStore.loading) return

  if (step.value === 'credentials') {
    const result = await authStore.login(username.value.trim(), password.value)
    if (result.status === 'ok') return enter()
    if (result.status === 'mfa') {
      mfaToken.value = result.mfaToken
      step.value = 'mfa'
    }
    return
  }

  const ok = await authStore.verifyMfa(mfaToken.value, mfaCode.value.trim())
  if (ok) return enter()
}

function backToCredentials(): void {
  step.value = 'credentials'
  mfaCode.value = ''
  authStore.error = ''
}
</script>

<template>
  <IonPage>
    <IonContent :scroll-y="false" class="login-content">
      <div class="min-h-full grid lg:grid-cols-[5fr_4fr] bg-canvas">

        <!-- Panel de marca (solo desktop) -->
        <aside class="hidden lg:flex flex-col justify-between p-10 bg-surface border-r border-line">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-md bg-accent grid place-items-center">
              <span class="text-white text-sm font-semibold tracking-tight">PM</span>
            </div>
            <span class="text-sm font-semibold text-ink">Positive Media</span>
          </div>

          <div class="max-w-md">
            <h1 class="text-3xl font-semibold tracking-tight text-ink leading-tight">
              Sistema Interno
            </h1>
            <p class="mt-3 text-sm text-ink-soft leading-relaxed">
              Clientes, abonos, proyectos, tareas y sueldos de la empresa,
              en un solo lugar.
            </p>
          </div>

          <p class="text-2xs text-ink-faint">
            © {{ new Date().getFullYear() }} Positive Media
          </p>
        </aside>

        <!-- Formulario -->
        <main class="flex items-center justify-center p-6">
          <div class="w-full max-w-sm ds-enter">
            <!-- Marca en mobile -->
            <div class="lg:hidden flex items-center gap-2.5 mb-8">
              <div class="w-8 h-8 rounded-md bg-accent grid place-items-center">
                <span class="text-white text-sm font-semibold">PM</span>
              </div>
              <span class="text-sm font-semibold text-ink">Sistema Interno</span>
            </div>

            <template v-if="step === 'credentials'">
              <h2 class="text-xl font-semibold tracking-tight text-ink">Ingresá a tu cuenta</h2>
              <p class="mt-1 text-sm text-ink-soft">Usá tu usuario o email del sistema.</p>

              <form class="mt-7 space-y-4" @submit.prevent="submit">
                <div>
                  <label class="ds-label" for="login-user">Usuario o email</label>
                  <input
                    id="login-user"
                    v-model="username"
                    class="ds-input"
                    type="text"
                    autocomplete="username"
                    autocapitalize="off"
                    spellcheck="false"
                    autofocus
                  />
                </div>
                <div>
                  <label class="ds-label" for="login-pass">Contraseña</label>
                  <input
                    id="login-pass"
                    v-model="password"
                    class="ds-input"
                    type="password"
                    autocomplete="current-password"
                  />
                </div>

                <p v-if="authStore.error" class="ds-error" role="alert">{{ authStore.error }}</p>

                <button
                  type="submit"
                  class="ds-btn-primary w-full h-10"
                  :disabled="!canSubmit || authStore.loading"
                >
                  <span v-if="!authStore.loading">Ingresar</span>
                  <span v-else>Ingresando…</span>
                  <IonIcon v-if="!authStore.loading" :icon="arrowForwardOutline" class="text-[15px]" />
                </button>
              </form>
            </template>

            <template v-else>
              <div class="flex items-center gap-2 text-accent-ink">
                <IonIcon :icon="keyOutline" class="text-[18px]" />
                <h2 class="text-xl font-semibold tracking-tight text-ink">Segundo factor</h2>
              </div>
              <p class="mt-1 text-sm text-ink-soft">
                Ingresá el código de tu app de autenticación (o un código de respaldo).
              </p>

              <form class="mt-7 space-y-4" @submit.prevent="submit">
                <div>
                  <label class="ds-label" for="login-mfa">Código</label>
                  <input
                    id="login-mfa"
                    v-model="mfaCode"
                    class="ds-input font-mono tracking-[0.3em] text-center"
                    type="text"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="10"
                    autofocus
                  />
                </div>

                <p v-if="authStore.error" class="ds-error" role="alert">{{ authStore.error }}</p>

                <button
                  type="submit"
                  class="ds-btn-primary w-full h-10"
                  :disabled="!canSubmit || authStore.loading"
                >
                  {{ authStore.loading ? 'Verificando…' : 'Verificar' }}
                </button>
                <button type="button" class="ds-btn-ghost w-full" @click="backToCredentials">
                  <IonIcon :icon="chevronBackOutline" class="text-[14px]" />
                  Volver
                </button>
              </form>
            </template>
          </div>
        </main>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.login-content {
  --background: rgb(var(--s-canvas));
}
</style>
