<script setup lang="ts">
/**
 * Clientes — ABM sobre la página genérica de catálogo.
 *
 * Lo del PORTAL (mails de aviso, de qué se avisa y quiénes entran) no cabe en el form genérico
 * —solo sabe de campos escalares— así que va en su propio modal, al que se llega desde una
 * columna de la tabla. Así no hay que tocar `CatalogoPage`, que comparten los otros catálogos.
 */
import { ref } from 'vue'
import { IonIcon } from '@ionic/vue'
import { peopleOutline, notificationsOffOutline } from 'ionicons/icons'
import CatalogoPage from '@/components/shared/CatalogoPage.vue'
import type { CampoDef, ColumnaDef } from '@/components/shared/CatalogoPage.vue'
import ClientePortalModal from '@/components/clientes/ClientePortalModal.vue'
import { useMeStore } from '@/stores/me'

const meStore = useMeStore()
const catalogo = ref<InstanceType<typeof CatalogoPage> | null>(null)
const modalPortal = ref(false)
const clienteElegido = ref<{ id: number; nombre: string } | null>(null)

const campos: CampoDef[] = [
  { key: 'nombre', label: 'Nombre', required: true, full: true },
  { key: 'contacto', label: 'Contacto' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'email', label: 'Email', type: 'email', full: true },
  { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
]

const columnas: ColumnaDef[] = [
  { key: 'nombre', label: 'Cliente' },
  { key: 'contacto', label: 'Contacto' },
  { key: 'email', label: 'Email' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'portal', label: 'Portal' },
]

/** Los cinco campos de aviso. Si están todos apagados, el cliente no recibe nada. */
const CAMPOS_AVISO = ['avisaCreada', 'avisaNueva', 'avisaEnProgreso', 'avisaResuelta']
const mudo = (row: Record<string, unknown>): boolean => CAMPOS_AVISO.every(c => row[c] === false)
const sinMails = (row: Record<string, unknown>): boolean => !String(row.emailsNotificacion || '').trim()

function abrirPortal(row: Record<string, unknown>): void {
  clienteElegido.value = { id: Number(row.id), nombre: String(row.nombre) }
  modalPortal.value = true
}
</script>

<template>
  <CatalogoPage
    ref="catalogo"
    titulo="Clientes"
    subtitulo="La base de abonos, proyectos e incidencias."
    endpoint="clientes"
    sustantivo="el cliente"
    :campos="campos"
    :columnas="columnas"
  >
    <template #cell-portal="{ row }">
      <button class="ds-btn-ghost h-7 px-2 text-xs" @click="abrirPortal(row)">
        <IonIcon :icon="peopleOutline" class="text-[13px]" /> Portal y avisos
      </button>
      <!--
        Se avisa en la fila y no solo adentro del modal: el día que un cliente diga «no me
        llegó nada», la explicación tiene que estar a la vista.
      -->
      <span
        v-if="mudo(row) || sinMails(row)" class="ds-badge-warn ml-1"
        :title="mudo(row) ? 'Tiene todos los avisos apagados' : 'No tiene mails de aviso cargados'"
      >
        <IonIcon :icon="notificationsOffOutline" class="text-[11px]" /> sin aviso
      </span>
    </template>

    <template #extra>
      <ClientePortalModal
        v-if="meStore.can('clientes:update')"
        :open="modalPortal"
        :cliente="clienteElegido"
        @cerrar="modalPortal = false"
        @guardado="catalogo?.reload()"
      />
    </template>
  </CatalogoPage>
</template>
