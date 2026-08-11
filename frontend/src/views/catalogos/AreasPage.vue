<script setup lang="ts">
/**
 * Áreas de la empresa — ABM sobre la página genérica de catálogo.
 * Columna extra: cantidad de servicios (la protección de borrado a la vista).
 */
import CatalogoPage from '@/components/shared/CatalogoPage.vue'
import type { CampoDef, ColumnaDef } from '@/components/shared/CatalogoPage.vue'

const campos: CampoDef[] = [
  { key: 'nombre', label: 'Nombre', required: true, full: true },
  { key: 'descripcion', label: 'Descripción', type: 'textarea' },
  { key: 'orden', label: 'Orden', type: 'number', hint: 'Rige el orden en listados y estadísticas.' },
]

const columnas: ColumnaDef[] = [
  { key: 'nombre', label: 'Área' },
  { key: 'descripcion', label: 'Descripción' },
  { key: 'orden', label: 'Orden' },
  { key: 'serviciosCount', label: 'Servicios' },
]
</script>

<template>
  <CatalogoPage
    titulo="Áreas"
    subtitulo="Agrupan servicios y empleados, y clasifican la facturación."
    endpoint="areas"
    sustantivo="el área"
    :campos="campos"
    :columnas="columnas"
  >
    <template #cell-serviciosCount="{ row }">
      <span class="tnum text-ink-soft">{{ row.serviciosCount || '—' }}</span>
    </template>
  </CatalogoPage>
</template>
