<script setup lang="ts">
/**
 * Gráfico de líneas del panel (Chart.js) — specs del legado (doc 03 §4.10):
 * línea monotone 2.5px, puntos solo en hover, relleno degradado si hay ≤ 2 series,
 * eje Y desde 0 con ticks "$Nk", tooltips es-AR, leyenda solo con >1 serie, paleta de 8
 * (slot `otros` gris) y RECONSTRUCCIÓN al cambiar el tema.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale,
  Filler, Tooltip, Legend,
} from 'chart.js'
import { useTheme } from '@/composables/useTheme'
import { MESES } from '@/composables/useFormato'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend)

export interface Serie { label: string; slot?: string | null; data: number[] }

const props = defineProps<{ series: Serie[]; alto?: number }>()

const PALETA_CLARO = ['#0F7660', '#2563eb', '#ea7317', '#7c3aed', '#e34948', '#b45309', '#0891b2', '#db2777']
const PALETA_OSCURO = ['#34d399', '#60a5fa', '#fb923c', '#a78bfa', '#f87171', '#fbbf24', '#22d3ee', '#f472b6']
const GRIS_OTROS = '#898781'

const canvas = ref<HTMLCanvasElement | null>(null)
const { isDark } = useTheme()
let chart: Chart | null = null

function color(i: number, slot?: string | null): string {
  if (slot === 'otros' || slot === 'sin-area') return GRIS_OTROS
  const paleta = isDark.value ? PALETA_OSCURO : PALETA_CLARO
  return paleta[i % paleta.length]
}

function construir(): void {
  if (!canvas.value) return
  chart?.destroy()
  const ctx = canvas.value.getContext('2d')
  if (!ctx) return

  const conRelleno = props.series.length <= 2
  const ink = isDark.value ? 'rgba(228,228,231,0.75)' : 'rgba(63,63,70,0.85)'
  const linea = isDark.value ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: MESES.map(m => m.slice(0, 3)),
      datasets: props.series.map((s, i) => {
        const c = color(i, s.slot)
        let fondo: string | CanvasGradient = 'transparent'
        if (conRelleno) {
          const grad = ctx.createLinearGradient(0, 0, 0, props.alto ?? 220)
          grad.addColorStop(0, `${c}3d`) // 0.24
          grad.addColorStop(1, `${c}00`)
          fondo = grad
        } else {
          fondo = `${c}14` // 8%
        }
        return {
          label: s.label,
          data: s.data,
          borderColor: c,
          backgroundColor: fondo,
          borderWidth: 2.5,
          cubicInterpolationMode: 'monotone' as const,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: c,
        }
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: props.series.length > 1,
          labels: { color: ink, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: $ ${Number(item.parsed.y).toLocaleString('es-AR')}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: ink, font: { size: 10 } }, grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: {
            color: ink,
            font: { size: 10 },
            callback: (v) => `$${Math.round(Number(v) / 1000).toLocaleString('es-AR')}k`,
          },
          grid: { color: linea },
        },
      },
    },
  })
}

onMounted(construir)
// Tema o datos nuevos → destruir y reconstruir (regla del legado para el cambio de tema).
watch([isDark, () => props.series], construir, { deep: true })
onBeforeUnmount(() => chart?.destroy())
</script>

<template>
  <div :style="{ height: `${alto ?? 220}px` }">
    <canvas ref="canvas"></canvas>
  </div>
</template>
