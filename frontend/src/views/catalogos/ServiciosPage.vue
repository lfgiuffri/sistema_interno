<script setup lang="ts">
/**
 * Servicios — ABM sobre la página genérica de catálogo.
 * El select de área carga TODAS las áreas (las inactivas marcadas): el valor actual
 * nunca se pierde por estar inactivo (corrección del PRD sobre el legado).
 */
import { ref, onMounted } from 'vue'
import api from '@/services/api'
import CatalogoPage from '@/components/shared/CatalogoPage.vue'
import type { CampoDef, ColumnaDef } from '@/components/shared/CatalogoPage.vue'

const campos = ref<CampoDef[]>([
  { key: 'nombre', label: 'Nombre', required: true, full: true },
  { key: 'descripcion', label: 'Descripción', type: 'textarea' },
  { key: 'areaId', label: 'Área', type: 'select', options: [], full: true, hint: 'Define en qué área suma la facturación de este servicio.' },
])

const columnas: ColumnaDef[] = [
  { key: 'nombre', label: 'Servicio' },
  { key: 'descripcion', label: 'Descripción' },
  { key: 'area', label: 'Área' },
]

/** Carga las opciones de área (todas, con las inactivas señaladas). */
async function loadAreas(): Promise<void> {
  try {
    const { data } = await api.get('/areas', { params: { limit: 200 } })
    if (data.success) {
      const campo = campos.value.find(c => c.key === 'areaId')
      if (campo) {
        campo.options = data.data.map((a: { id: number; nombre: string; activo: boolean }) => ({
          value: a.id,
          label: a.activo ? a.nombre : `${a.nombre} (inactiva)`,
        }))
      }
    }
  } catch { /* el select queda sin opciones; el backend valida igual */ }
}

onMounted(() => { void loadAreas() })
</script>

<template>
  <CatalogoPage
    titulo="Servicios"
    subtitulo="El catálogo de servicios; su área clasifica la facturación."
    endpoint="servicios"
    sustantivo="el servicio"
    :campos="campos"
    :columnas="columnas"
    @loaded="loadAreas"
  >
    <template #cell-area="{ row }">
      <span v-if="row.area" class="ds-badge-neutral">{{ (row.area as { nombre: string }).nombre }}</span>
      <span v-else class="ds-badge-neutral !text-ink-faint">Sin área</span>
    </template>
  </CatalogoPage>
</template>
