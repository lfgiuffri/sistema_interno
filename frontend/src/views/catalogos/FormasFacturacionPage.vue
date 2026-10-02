<script setup lang="ts">
/**
 * Formas de facturación — ABM sobre la página genérica de catálogo.
 *
 * Además del conteo de abonos, cada fila muestra cuánto factura: los totales van **separados
 * por moneda** y no convertidos a un único número, porque un abono es ARS o USD y «esta forma
 * factura US$ 2.190» es justamente el dato que se quiere ver; el total convertido siempre se
 * puede sacar de esos dos, al revés no.
 *
 * Los totales suman solo los abonos ACTIVOS —uno pausado no se factura—, y por eso la columna
 * de abonos muestra también cuántos están activos: sin ese número, una forma con 12 abonos y
 * un total que cubre 11 parece un error de cálculo.
 */
import CatalogoPage from '@/components/shared/CatalogoPage.vue'
import type { CampoDef, ColumnaDef } from '@/components/shared/CatalogoPage.vue'
import { moneda as fmtMoneda } from '@/composables/useFormato'

const campos: CampoDef[] = [
  { key: 'nombre', label: 'Nombre', required: true, full: true },
]

const columnas: ColumnaDef[] = [
  { key: 'nombre', label: 'Forma de facturación' },
  { key: 'abonosCount', label: 'Abonos' },
  { key: 'totalArs', label: 'Total en pesos' },
  { key: 'totalUsd', label: 'Total en dólares' },
]
</script>

<template>
  <CatalogoPage
    titulo="Formas de facturación"
    subtitulo="Cómo se factura cada abono (SRL, monotributos, etc.)."
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
  </CatalogoPage>
</template>
