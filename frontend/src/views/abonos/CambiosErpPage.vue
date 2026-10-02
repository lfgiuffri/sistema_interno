<script setup lang="ts">
/**
 * «Cambios para el ERP» — qué se movió en los abonos desde la última facturación.
 *
 * El caso de uso es concreto: durante el mes se crean abonos, se cambian precios y se dan de
 * baja; antes de facturar en el ERP hay que saber QUÉ registrar. La pantalla muestra solo lo
 * accionable, en tres cubetas (nuevo / modificado / baja), y lo exporta a CSV.
 *
 * No hay bitácora detrás: el backend compara el estado actual contra el SNAPSHOT congelado de
 * la última facturación de cada abono. Eso da la diferencia NETA —un precio que subió y volvió
 * a bajar no genera dos renglones— y funciona con la historia que ya existe.
 *
 * Ojo con la lectura: el criterio es el monto EN PESOS, que es lo que termina en la factura.
 * Entonces un abono en USD aparece aunque su precio en dólares no se haya tocado, si se movió
 * la cotización. Por eso cada fila dice POR QUÉ cambió y hay un filtro para esconder las que
 * solo se movieron por el dólar: sin eso, con decenas de abonos en USD el listado sería una
 * pared de filas donde lo importante no se ve.
 */
import { ref, computed } from 'vue'
import {
  onIonViewWillEnter, IonPage, IonContent, IonHeader, IonToolbar, IonButtons,
  IonMenuButton, IonIcon,
} from '@ionic/vue'
import {
  downloadOutline, refreshOutline, addCircleOutline, createOutline, removeCircleOutline,
  copyOutline, checkmarkCircle, ellipseOutline,
} from 'ionicons/icons'
import { useAbonosStore, type CambiosErp, type CambioErp } from '@/stores/abonos'
import { useMeStore } from '@/stores/me'
import { useToast } from '@/composables/useToast'
import { descargarCsv } from '@/composables/useCsv'
import { moneda as fmtMoneda, fechaHora as fmtFechaHora, MESES } from '@/composables/useFormato'

const store = useAbonosStore()
const meStore = useMeStore()
const toast = useToast()

const datos = ref<CambiosErp | null>(null)
const cargando = ref(false)
const error = ref('')
/** Esconder las filas que solo cambiaron por la cotización (ver el comentario del encabezado). */
const soloDeNegocio = ref(false)

/** ¿Esta fila existe únicamente porque se movió el dólar? */
const esSoloCotizacion = (f: CambioErp): boolean =>
  f.cambios.length > 0 && f.cambios.every(c => c === 'cotizacion' || c === 'montoPesos')

const modificados = computed(() =>
  (datos.value?.modificados ?? []).filter(f => !soloDeNegocio.value || !esSoloCotizacion(f)))

/** Las tres cubetas, en el orden en que se cargan en un ERP: altas, cambios, bajas. */
const grupos = computed(() => [
  { clave: 'nuevos', titulo: 'Nuevos', ayuda: 'Nunca se facturaron: hay que darlos de alta.', icono: addCircleOutline, filas: datos.value?.nuevos ?? [] },
  { clave: 'modificados', titulo: 'Modificados', ayuda: 'Cambió algo contra lo último facturado.', icono: createOutline, filas: modificados.value },
  { clave: 'bajas', titulo: 'Bajas', ayuda: 'Estaban facturados y hay que dejar de facturarlos.', icono: removeCircleOutline, filas: datos.value?.bajas ?? [] },
])

const hayAlgo = computed(() => grupos.value.some(g => g.filas.length > 0))
/** Avance de la carga en el ERP, sobre lo que se está viendo. */
const avance = computed(() => {
  const todas = grupos.value.flatMap(g => g.filas)
  return { hechas: todas.filter(f => f.marcado).length, total: todas.length }
})
const ocultas = computed(() =>
  soloDeNegocio.value ? (datos.value?.modificados.filter(esSoloCotizacion).length ?? 0) : 0)

const periodo = computed(() => {
  const p = datos.value?.periodo
  return p ? `${MESES[p.mes - 1]} ${p.anio}` : null
})

/**
 * Copia el monto EN PESOS al portapapeles, sin separador de miles: va a pegarse en el ERP,
 * que lo quiere como número y no como texto formateado. El ERP trabaja todo en pesos, así que
 * el botón nunca copia el precio en dólares aunque el abono esté en USD.
 * @param f - Fila del parte.
 */
async function copiarMonto(f: CambioErp): Promise<void> {
  const crudo = String(f.montoPesos)
  try {
    await navigator.clipboard.writeText(crudo)
  } catch {
    // Sin permiso de portapapeles (o HTTP sin TLS): se copia con el método viejo.
    const ta = document.createElement('textarea')
    ta.value = crudo
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  copiado.value = f.abonoId
  window.setTimeout(() => { if (copiado.value === f.abonoId) copiado.value = null }, 1400)
}

/** Última fila copiada, para confirmarlo sin un toast por cada copia. */
const copiado = ref<number | null>(null)
/** Filas con el marcado en vuelo (para no dejar apretar dos veces). */
const marcando = ref<Set<number>>(new Set())

/**
 * Tacha o destacha una fila. Se actualiza el estado local al volver en vez de recargar todo:
 * recargar reordenaría el listado debajo del dedo justo cuando se está yendo fila por fila.
 * @param f - Fila del parte.
 */
async function alternarMarca(f: CambioErp): Promise<void> {
  if (marcando.value.has(f.abonoId)) return
  marcando.value = new Set(marcando.value).add(f.abonoId)
  const r = await store.marcarErp(f.abonoId, !f.marcado)
  marcando.value = new Set([...marcando.value].filter(id => id !== f.abonoId))
  if (!r.ok) { toast.error(r.message); return }
  f.marcado = !f.marcado
  f.marcadoAt = f.marcado ? new Date().toISOString() : null
}

/** Etiqueta legible de cada tipo de cambio. */
const ETIQUETA: Record<string, string> = {
  precio: 'precio', moneda: 'moneda', cliente: 'cliente',
  servicio: 'servicio', cotizacion: 'cotización', montoPesos: 'monto en $',
}

async function load(): Promise<void> {
  cargando.value = true
  error.value = ''
  const d = await store.fetchCambios()
  cargando.value = false
  if (!d) { error.value = 'No se pudieron traer los cambios'; return }
  datos.value = d
}

onIonViewWillEnter(load)

/**
 * Exporta TODO lo que se ve, con una columna que dice a qué cubeta pertenece cada fila: el
 * ERP se carga de una sola pasada y un archivo por cubeta sería tres veces el trabajo.
 */
function exportar(): void {
  const filas: unknown[][] = []
  for (const g of grupos.value) {
    for (const f of g.filas) {
      filas.push([
        g.titulo, f.abonoId, f.cliente, f.servicio, f.descripcion, f.formaFacturacion,
        f.moneda, f.precio, f.montoPesos,
        f.anterior ? `${String(f.anterior.mes).padStart(2, '0')}/${f.anterior.anio}` : '',
        f.anterior ? f.anterior.precio : '',
        f.anterior ? f.anterior.montoPesos : '',
        f.cambios.map(c => ETIQUETA[c] ?? c).join(' + ') || (f.motivoBaja ?? ''),
        f.marcado ? 'sí' : 'no',
      ])
    }
  }
  if (!filas.length) { toast.error('No hay cambios para exportar'); return }
  descargarCsv('cambios-erp', [
    'Tipo', 'Abono', 'Cliente', 'Servicio', 'Descripción', 'Forma de facturación',
    'Moneda', 'Precio actual', 'Monto en $ actual',
    'Período facturado', 'Precio facturado', 'Monto en $ facturado', 'Qué cambió', 'Cargado en el ERP',
  ], filas)
}
</script>

<template>
  <IonPage>
    <IonHeader class="ion-no-border">
      <IonToolbar class="app-toolbar">
        <IonButtons slot="start"><IonMenuButton /></IonButtons>
      </IonToolbar>
    </IonHeader>

    <IonContent class="page-content">
      <div class="px-4 pb-10 pt-1 max-w-6xl mx-auto">
        <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h1 class="text-lg font-semibold text-ink">Cambios para el ERP</h1>
            <p class="mt-0.5 text-sm text-ink-soft">
              Lo que se movió en los abonos desde que se facturó<span v-if="periodo"> en {{ periodo }}</span>.
              Solo aparece lo que hay que registrar.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button class="ds-btn-secondary" :disabled="cargando" @click="load">
              <IonIcon :icon="refreshOutline" class="text-[15px]" /> Actualizar
            </button>
            <button class="ds-btn-primary" :disabled="!hayAlgo" @click="exportar">
              <IonIcon :icon="downloadOutline" class="text-[15px]" /> Exportar CSV
            </button>
          </div>
        </header>

        <div v-if="cargando && !datos" class="space-y-2">
          <div v-for="i in 5" :key="i" class="ds-skeleton h-16"></div>
        </div>

        <p v-else-if="error" class="ds-error" role="alert">{{ error }}</p>

        <template v-else-if="datos">
          <!-- Contadores + el filtro del dólar, que es lo que hace usable la cubeta del medio. -->
          <div class="ds-card p-3 mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <span class="text-2xs text-ink-faint">
              Cotización de hoy <strong class="text-ink tnum">{{ fmtMoneda(datos.cotizacion) }}</strong>
            </span>
            <span v-for="g in grupos" :key="g.clave" class="text-2xs text-ink-soft">
              {{ g.titulo }} <strong class="text-ink tnum">{{ g.filas.length }}</strong>
            </span>
            <span v-if="avance.total" class="text-2xs text-ink-soft">
              Cargado en el ERP
              <strong class="tnum" :class="avance.hechas === avance.total ? 'text-ok' : 'text-ink'">
                {{ avance.hechas }}/{{ avance.total }}
              </strong>
            </span>
            <label class="ml-auto flex items-center gap-2 text-2xs text-ink-soft cursor-pointer">
              <input v-model="soloDeNegocio" type="checkbox" class="accent-accent" />
              Esconder los que solo cambiaron por la cotización
              <span v-if="ocultas" class="text-ink-faint">({{ ocultas }} ocultos)</span>
            </label>
          </div>

          <p v-if="!hayAlgo" class="ds-card p-6 text-center text-sm text-ink-soft">
            No hay diferencias contra lo facturado. El ERP está al día.
          </p>

          <section v-for="g in grupos" :key="g.clave" class="mb-6">
            <template v-if="g.filas.length">
              <h2 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint mb-1">
                <IonIcon :icon="g.icono" class="text-[14px]" />
                {{ g.titulo }} <span class="tnum">· {{ g.filas.length }}</span>
              </h2>
              <p class="text-2xs text-ink-faint mb-2">{{ g.ayuda }}</p>

              <!-- Tabla ancha: se RECORRE, no se comprime (regla responsive del proyecto). -->
              <div class="ds-card overflow-x-auto">
                <table class="ds-table min-w-[860px]">
                  <thead>
                    <tr>
                      <th class="sticky left-0 bg-surface z-10">Cliente</th>
                      <th>Servicio</th>
                      <th class="text-right">Antes</th>
                      <th class="text-right">Ahora</th>
                      <th>Qué cambió</th>
                      <th class="text-center whitespace-nowrap">En el ERP</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="f in g.filas" :key="f.abonoId" :class="{ 'opacity-45': f.marcado }">
                      <td class="sticky left-0 bg-surface z-10">
                        <span class="font-medium text-ink">{{ f.cliente ?? '—' }}</span>
                        <span v-if="f.descripcion" class="block text-2xs text-ink-faint truncate max-w-[220px]">
                          {{ f.descripcion }}
                        </span>
                      </td>
                      <td class="text-ink-soft">{{ f.servicio ?? '—' }}</td>
                      <td class="text-right tnum text-ink-soft">
                        <template v-if="f.anterior">
                          {{ fmtMoneda(f.anterior.precio, f.anterior.moneda as 'ARS' | 'USD') }}
                          <span class="block text-2xs text-ink-faint">{{ fmtMoneda(f.anterior.montoPesos) }}</span>
                        </template>
                        <span v-else class="text-ink-faint">sin facturar</span>
                      </td>
                      <td class="text-right tnum">
                        <template v-if="g.clave !== 'bajas'">
                          <div class="flex items-center justify-end gap-1.5">
                            <div>
                              {{ fmtMoneda(f.precio, f.moneda as 'ARS' | 'USD') }}
                              <span class="block text-2xs text-ink-faint">{{ fmtMoneda(f.montoPesos) }}</span>
                            </div>
                            <!--
                              Copia el monto EN PESOS y sin separador de miles: se pega en el
                              ERP, que lo quiere como número. Nunca copia el precio en USD —
                              el ERP trabaja todo en pesos.
                            -->
                            <button
                              type="button" class="row-action shrink-0"
                              :title="`Copiar ${f.montoPesos} (monto en pesos, sin puntos)`"
                              :aria-label="`Copiar el monto en pesos de ${f.cliente ?? 'este abono'}`"
                              @click="copiarMonto(f)"
                            >
                              <IonIcon
                                :icon="copiado === f.abonoId ? checkmarkCircle : copyOutline"
                                class="text-[15px]"
                                :class="copiado === f.abonoId ? 'text-ok' : ''"
                              />
                            </button>
                          </div>
                        </template>
                        <span v-else class="text-ink-faint">—</span>
                      </td>
                      <td>
                        <span v-if="f.motivoBaja" class="ds-badge-warn">{{ f.motivoBaja }}</span>
                        <span v-else-if="!f.cambios.length" class="ds-badge-ok">alta</span>
                        <span v-else class="flex flex-wrap gap-1">
                          <span
                            v-for="c in f.cambios" :key="c"
                            :class="c === 'cotizacion' || c === 'montoPesos' ? 'ds-badge-neutral' : 'ds-badge-warn'"
                          >{{ ETIQUETA[c] ?? c }}</span>
                        </span>
                      </td>
                      <td class="text-center">
                        <button
                          v-if="meStore.can('abonos:update')"
                          type="button" class="row-action mx-auto"
                          :disabled="marcando.has(f.abonoId)"
                          :title="f.marcado
                            ? `Cargado en el ERP${f.marcadoAt ? ' el ' + fmtFechaHora(f.marcadoAt) : ''} — clic para destildar`
                            : 'Marcar como cargado en el ERP'"
                          :aria-label="f.marcado ? 'Destildar' : 'Marcar como cargado en el ERP'"
                          :aria-pressed="f.marcado"
                          @click="alternarMarca(f)"
                        >
                          <IonIcon
                            :icon="f.marcado ? checkmarkCircle : ellipseOutline"
                            class="text-[17px]"
                            :class="f.marcado ? 'text-ok' : 'text-ink-faint'"
                          />
                        </button>
                        <IonIcon
                          v-else-if="f.marcado" :icon="checkmarkCircle" class="text-[17px] text-ok"
                          title="Cargado en el ERP"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </section>
        </template>
      </div>
    </IonContent>
  </IonPage>
</template>

<style scoped>
.page-content { --background: rgb(var(--s-canvas)); }
.app-toolbar { --background: rgb(var(--s-canvas)); --border-width: 0; --min-height: 44px; }

/* Misma definición que el resto de las pantallas con acciones por fila. */
.row-action {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px;
  color: rgb(var(--s-ink-faint)); transition: background-color 0.12s ease, color 0.12s ease;
}
.row-action:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
.row-action:disabled { opacity: 0.5; }
</style>
