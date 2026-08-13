<script setup lang="ts">
/**
 * Home de Documentación: buscador global (título y contenido) + un tile por espacio al que
 * el usuario tiene acceso. Los espacios son propios del módulo y su administración vive en
 * /documentacion/espacios (capability `doc-espacios:*`).
 */
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import {
  libraryOutline, searchOutline, lockClosedOutline, documentTextOutline,
  settingsOutline, attachOutline,
} from 'ionicons/icons'
import { useDocumentacionStore, type DocumentoListado } from '@/stores/documentacion'
import { useMeStore } from '@/stores/me'
import { fecha as fmtFecha } from '@/composables/useFormato'

const store = useDocumentacionStore()
const meStore = useMeStore()
const router = useRouter()

const q = ref('')
const resultados = ref<DocumentoListado[]>([])
const buscando = ref(false)

// Buscador con debounce: no dispara una request por tecla.
let timer: ReturnType<typeof setTimeout> | undefined
watch(q, (valor) => {
  clearTimeout(timer)
  if (valor.trim().length < 2) { resultados.value = []; buscando.value = false; return }
  buscando.value = true
  timer = setTimeout(async () => {
    resultados.value = await store.buscar(valor)
    buscando.value = false
  }, 300)
})

function abrirDocumento(d: DocumentoListado): void {
  router.push(`/documentacion/espacios/${d.docEspacioId}/listas/${d.docListaId}?doc=${d.id}`)
}

let loadedOnce = false
onMounted(() => { loadedOnce = true; void store.fetchHome() })
onIonViewWillEnter(() => { if (loadedOnce) void store.fetchHome() })
</script>

<template>
  <IonPage>
    <IonHeader class="ion-no-border">
      <IonToolbar class="app-toolbar">
        <IonButtons slot="start" class="lg:hidden"><IonMenuButton /></IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent class="page-content">
      <div class="max-w-6xl mx-auto px-5 lg:px-8 py-6 ds-enter">

        <header class="flex flex-wrap items-center justify-between gap-3 pb-5">
          <div>
            <h1 class="text-xl font-semibold tracking-tight text-ink">Documentación</h1>
            <p class="mt-0.5 text-sm text-ink-soft">Procesos, instructivos y material de referencia del equipo.</p>
          </div>
          <button
            v-if="meStore.can('doc-espacios:read')"
            class="ds-btn-secondary flex items-center gap-1.5"
            @click="router.push('/documentacion/espacios')"
          >
            <IonIcon :icon="settingsOutline" class="text-[15px]" />
            Administrar espacios
          </button>
        </header>

        <!-- Buscador -->
        <div class="relative mb-6">
          <IonIcon :icon="searchOutline" class="absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-ink-faint" />
          <input
            v-model="q"
            class="ds-input pl-9"
            type="search"
            placeholder="Buscar en títulos y contenido…"
            aria-label="Buscar documentación"
          />
        </div>

        <!-- Resultados de búsqueda -->
        <section v-if="q.trim().length >= 2" class="mb-6">
          <h2 class="text-sm font-semibold text-ink mb-2">
            Resultados
            <span v-if="!buscando" class="text-ink-faint font-normal">({{ resultados.length }})</span>
          </h2>

          <div v-if="buscando" class="space-y-2">
            <div v-for="i in 3" :key="i" class="ds-skeleton h-14"></div>
          </div>

          <div v-else-if="resultados.length" class="ds-card divide-y divide-line-soft">
            <button
              v-for="r in resultados"
              :key="r.id"
              class="w-full text-left px-4 py-3 hover:bg-surface-2/50 transition-colors"
              @click="abrirDocumento(r)"
            >
              <div class="flex items-center gap-2">
                <IonIcon :icon="documentTextOutline" class="text-[15px] text-ink-faint shrink-0" />
                <span class="text-sm font-medium text-ink truncate">{{ r.titulo }}</span>
                <span v-if="r.archivosCount" class="ds-badge-neutral shrink-0">
                  <IonIcon :icon="attachOutline" class="text-[11px]" /> {{ r.archivosCount }}
                </span>
              </div>
              <p v-if="r.extracto" class="mt-1 text-xs text-ink-soft line-clamp-2">{{ r.extracto }}</p>
              <p class="mt-1 text-2xs text-ink-faint">
                {{ r.espacio?.nombre }} · {{ r.lista?.nombre }} · actualizado {{ fmtFecha(r.updatedAt) }}
              </p>
            </button>
          </div>

          <div v-else class="ds-card px-6 py-10 text-center">
            <p class="text-sm font-medium text-ink">Sin resultados para «{{ q }}».</p>
            <p class="text-xs text-ink-faint mt-1">Se busca en el título y en el texto de los espacios a los que tenés acceso.</p>
          </div>
        </section>

        <!-- Espacios -->
        <section v-show="q.trim().length < 2">
          <h2 class="text-sm font-semibold text-ink mb-2">Espacios</h2>

          <div v-if="store.loading && !store.espacios.length" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div v-for="i in 3" :key="i" class="ds-skeleton h-24"></div>
          </div>

          <div v-else-if="store.espacios.length" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <button
              v-for="e in store.espacios"
              :key="e.id"
              class="ds-card px-4 py-4 text-left hover:bg-surface-2/50 transition-colors group"
              :class="{ 'opacity-60': !e.activo }"
              @click="router.push(`/documentacion/espacios/${e.id}`)"
            >
              <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-lg bg-accent-soft grid place-items-center shrink-0">
                  <IonIcon :icon="libraryOutline" class="text-[15px] text-accent-ink" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="font-medium text-ink truncate group-hover:text-accent transition-colors">{{ e.nombre }}</p>
                  <p v-if="e.descripcion" class="text-2xs text-ink-faint truncate">{{ e.descripcion }}</p>
                </div>
                <IonIcon v-if="!e.puedeEditar" :icon="lockClosedOutline" class="text-[13px] text-ink-faint shrink-0" title="Solo lectura" />
              </div>
              <div class="flex items-baseline gap-3 mt-3">
                <span class="text-lg font-semibold tnum text-ink">{{ e.documentosCount }}</span>
                <span class="text-xs text-ink-faint">documento(s)</span>
                <span class="text-2xs text-ink-faint ml-auto">{{ e.listasCount }} lista(s)</span>
              </div>
            </button>
          </div>

          <div v-else class="ds-card px-6 py-12 text-center">
            <p class="text-sm font-medium text-ink">Todavía no tenés acceso a ningún espacio de documentación.</p>
            <p class="text-xs text-ink-faint mt-1">
              Pedile a un administrador que te lo habilite, o
              <button v-if="meStore.can('doc-espacios:create')" class="underline" @click="router.push('/documentacion/espacios')">creá el primero</button>
              <span v-else>esperá a que creen el primero</span>.
            </p>
          </div>
        </section>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
