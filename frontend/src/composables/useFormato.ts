/**
 * Formato de números y moneda del sistema (es-AR, sin decimales — regla del legado).
 */

/** "$ 1.234.567" (ARS) o "US$ 300" (USD). */
export const moneda = (monto: number | string, mon: 'ARS' | 'USD' = 'ARS'): string => {
  const simbolo = mon === 'USD' ? 'US$' : '$'
  return `${simbolo} ${Math.round(Number(monto)).toLocaleString('es-AR')}`
}

/** "12,5" — porcentaje sin ceros sobrantes. */
export const porcentaje = (pct: number | string): string =>
  Number(pct).toLocaleString('es-AR', { maximumFractionDigits: 2 })

/** "10/08/2026" desde una fecha ISO. */
export const fecha = (iso?: string | null): string => {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/** Duración legible (regla del legado): "N s" / "N m" / "H h M m" / "D d H h". */
export const duracion = (segundos: number): string => {
  const s = Math.max(0, Math.round(segundos))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ${m % 60} m`
  return `${Math.floor(h / 24)} d ${h % 24} h`
}

/** Fecha y hora cortas es-AR (dd/mm/aaaa HH:MM). */
export const fechaHora = (iso?: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.toLocaleDateString('es-AR')} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
}
