<script setup lang="ts">
/**
 * Formas de facturación — ABM sobre la página genérica de catálogo.
 *
 * Además del conteo de abonos, cada fila muestra cuánto factura: los totales van **separados
 * por moneda** y no convertidos a un único número, porque un abono es ARS o USD y «esta forma
 * factura US$ 2.190» es justamente el dato que se quiere ver; el total convertido siempre se
 * puede sacar de esos dos, al revés no.
 *
 * El «Total general» sí los junta, pasando los dólares por la cotización de hoy. Lo calcula el
 * backend redondeando CADA abono al convertirlo (`REDONDEO_ABONOS`) y sumando después, que es
 * lo que hace el tile «total mensual» del listado de abonos: sumando primero y redondeando al
 * final, la misma empresa daría dos números distintos en dos pantallas.
 *
 * Los totales suman solo los abonos ACTIVOS —uno pausado no se factura—, y por eso la columna
 * de abonos muestra también cuántos están activos: sin ese número, una forma con 12 abonos y
 * un total que cubre 11 parece un error de cálculo.
 */
import { ref, computed, onMounted } from 'vue'
import CatalogoPage from '@/components/shared/CatalogoPage.vue'
import type { CampoDef, ColumnaDef } from '@/components/shared/CatalogoPage.vue'
import { moneda as fmtMoneda } from '@/composables/useFormato'
import api from '@/services/api'

/** Cotización vigente, para poder decir a qué cambio se convirtió el total general. */
const cotizacion = ref(0)
onMounted(async () => {
  const { data } = await api.get('/app-config').catch(() => ({ data: { success: false } }))
  if (!data.success) return
  cotizacion.value = Number(data.data.find((c: { name: string }) => c.name === 'COTIZACION_DOLAR')?.value ?? 0)
})

// Un total convertido sin decir a qué cambio no se puede verificar.
const subtitulo = computed(() => cotizacion.value
  ? `Cómo se factura cada abono (SRL, monotributos, etc.). Total general al dólar ${fmtMoneda(cotizacion.value)}.`
  : 'Cómo se factura cada abono (SRL, monotributos, etc.).')

const campos: CampoDef[] = [
  { key: 'nombre', label: 'Nombre', required: true, full: true },
]

const columnas: ColumnaDef[] = [
  { key: 'nombre', label: 'Forma de facturación' },
  { key: 'abonosCount', label: 'Abonos' },
  { key: 'totalArs', label: 'Total en pesos' },
  { key: 'totalUsd', label: 'Total en dólares' },
  { key: 'totalEnPesos', label: 'Total general' },
]
</script>

<template>
  <CatalogoPage
    titulo="Formas de facturación"
    :subtitulo="subtitulo"
    endpoint="formas-facturacion"
    sustantivo="la forma de facturación"
    :campos="campos"
    :columnas="columnas"
  >
    <template #cell-abonosCount="{ row }">
      <span class="tnum text-ink-soft">{{ row.abonosCount || '—' }}</span>
      <span
        v-if="row.abonosCount && row.abonosActivos !== row.abonosCount"
        class="block text-2xs text-ink-faint tnum"
      >{{ row.abonosActivos }} activos</span>
    </template>

    <!-- Los totales son de los abonos ACTIVOS (ver el comentario del encabezado). -->
    <template #cell-totalArs="{ row }">
      <span v-if="row.totalArs" class="tnum text-ink">{{ fmtMoneda(Number(row.totalArs)) }}</span>
      <span v-else class="text-ink-faint">—</span>
    </template>

    <template #cell-totalUsd="{ row }">
      <span v-if="row.totalUsd" class="tnum text-ink">{{ fmtMoneda(Number(row.totalUsd), 'USD') }}</span>
      <span v-else class="text-ink-faint">—</span>
    </template>

    <!-- Pesos + dólares al cambio de hoy. Es el único que se puede comparar entre formas. -->
    <template #cell-totalEnPesos="{ row }">
      <span v-if="row.totalEnPesos" class="tnum font-medium text-ink">{{ fmtMoneda(Number(row.totalEnPesos)) }}</span>
      <span v-else class="text-ink-faint">—</span>
    </template>
  </CatalogoPage>
</template>
