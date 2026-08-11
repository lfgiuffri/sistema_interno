/**
 * Export CSV en el cliente (mejora §10.8): genera el archivo desde los datos ya cargados.
 * Separador `;` (Excel es-AR lo abre bien) + BOM UTF-8 para los acentos.
 */

/** Escapa un valor para CSV (comillas, separadores y saltos de línea). */
function celda(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Descarga un CSV a partir de columnas + filas.
 * @param nombre - Nombre de archivo (sin extensión).
 * @param columnas - Encabezados en orden.
 * @param filas - Matriz de valores (mismo orden que columnas).
 */
export function descargarCsv(nombre: string, columnas: string[], filas: unknown[][]): void {
  const lineas = [columnas.map(celda).join(';'), ...filas.map(f => f.map(celda).join(';'))]
  const blob = new Blob([`﻿${lineas.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nombre}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
