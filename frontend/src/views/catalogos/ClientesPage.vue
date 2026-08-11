<script setup lang="ts">
/**
 * Clientes — ABM sobre la página genérica de catálogo.
 */
import CatalogoPage from '@/components/shared/CatalogoPage.vue'
import type { CampoDef, ColumnaDef } from '@/components/shared/CatalogoPage.vue'

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
]
</script>

<template>
  <CatalogoPage
    titulo="Clientes"
    subtitulo="La base de abonos y proyectos."
    endpoint="clientes"
    sustantivo="el cliente"
    :campos="campos"
    :columnas="columnas"
  />
</template>
