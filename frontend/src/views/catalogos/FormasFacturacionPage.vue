<script setup lang="ts">
/**
 * Formas de facturación — ABM sobre la página genérica de catálogo.
 */
import CatalogoPage from '@/components/shared/CatalogoPage.vue'
import type { CampoDef, ColumnaDef } from '@/components/shared/CatalogoPage.vue'

const campos: CampoDef[] = [
  { key: 'nombre', label: 'Nombre', required: true, full: true },
]

const columnas: ColumnaDef[] = [
  { key: 'nombre', label: 'Forma de facturación' },
  { key: 'abonosCount', label: 'Abonos' },
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
    </template>
  </CatalogoPage>
</template>
