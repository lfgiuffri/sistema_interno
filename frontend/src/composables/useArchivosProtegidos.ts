/**
 * Archivos protegidos (tareas y documentación): se sirven con auth (header x-access-token),
 * así que un <img src> plano no funciona. Este composable baja el binario con axios y
 * devuelve un object URL cacheado por sesión (el mismo blob sirve para editor y vistas).
 */
import api from '@/services/api'

const cache = new Map<string, string>()

/** ¿La URL apunta a alguno de nuestros endpoints autenticados de archivos? */
export function esArchivoProtegido(url: string): boolean {
  return /(^|\/)api\/(tareas|documentacion)\/archivos\//.test(url)
}

/**
 * Resuelve una URL de archivo protegido a un object URL (cacheado). Cualquier otra URL
 * se devuelve tal cual.
 * @param url - src original (ej. /api/tareas/archivos/202608_ab12....png).
 * @returns URL usable en <img>/<a>.
 */
export async function resolverArchivo(url: string): Promise<string> {
  if (!esArchivoProtegido(url)) return url
  const hit = cache.get(url)
  if (hit) return hit
  try {
    // El axios de la app ya tiene baseURL /api: recortamos el prefijo.
    const path = url.replace(/^.*\/api\//, '/')
    const res = await api.get(path, { responseType: 'blob' })
    const objectUrl = URL.createObjectURL(res.data)
    cache.set(url, objectUrl)
    return objectUrl
  } catch {
    return url // roto: que el <img> muestre su fallback
  }
}

/**
 * Post-procesa un contenedor ya renderizado (v-html) reemplazando los src de imágenes
 * protegidas por sus blobs.
 * @param el - Contenedor con el HTML saneado.
 */
export async function hidratarImagenes(el: HTMLElement | null): Promise<void> {
  if (!el) return
  const imgs = [...el.querySelectorAll('img')]
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src') || ''
    if (!esArchivoProtegido(src)) return
    img.src = await resolverArchivo(src)
  }))
}

/**
 * Descarga un archivo protegido disparando el download del browser con su nombre real.
 * @param url - URL del archivo.
 * @param nombre - Nombre de descarga.
 */
export async function descargarArchivo(url: string, nombre: string): Promise<void> {
  const resuelta = await resolverArchivo(url)
  const a = document.createElement('a')
  a.href = resuelta
  a.download = nombre
  a.click()
}
