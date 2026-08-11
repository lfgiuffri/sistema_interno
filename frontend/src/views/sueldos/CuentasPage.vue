<script setup lang="ts">
/**
 * Cuentas de pago — ABM sobre la página genérica de catálogo (endpoint anidado en
 * sueldos, capabilities propias `cuentas:*`). El orden rige las columnas de la
 * planificación; una cuenta con pagos no se elimina (409 del backend).
 */
import CatalogoPage from '@/components/shared/CatalogoPage.vue'
import type { CampoDef, ColumnaDef } from '@/components/shared/CatalogoPage.vue'

const campos: CampoDef[] = [
  { key: 'nombre', label: 'Nombre', required: true, full: true },
  { key: 'orden', label: 'Orden', type: 'number', hint: 'Rige el orden de columnas en la planificación.' },
]

const columnas: ColumnaDef[] = [
  { key: 'nombre', label: 'Cuenta' },
  { key: 'orden', label: 'Orden' },
  { key: 'pagosCount', label: 'Pagos' },
]
</script>

<template>
  <CatalogoPage
    titulo="Cuentas de pago"
    subtitulo="Desde dónde se pagan los sueldos; son las columnas de la planificación."
    endpoint="sueldos/cuentas"
    cap-prefix="cuentas"
    sustantivo="la cuenta"
    :campos="campos"
    :columnas="columnas"
  >
    <template #cell-pagosCount="{ row }">
      <span class="tnum text-ink-soft">{{ row.pagosCount || '—' }}</span>
    </template>
  </CatalogoPage>
</template>
