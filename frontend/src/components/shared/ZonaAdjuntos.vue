<script setup lang="ts">
/**
 * Zona para adjuntar archivos: botón + arrastrar y soltar, compartida por tareas y documentos.
 *
 * Detalles que hacen la diferencia entre que funcione y que moleste:
 *  - El contador de `dragenter`/`dragleave` es necesario: el navegador dispara `dragleave` al
 *    pasar sobre cada hijo, así que mirando solo el evento la zona parpadea sin parar.
 *  - `dragover` con `preventDefault()` en TODA la zona: sin eso el navegador abre el archivo
 *    en una pestaña nueva en vez de dejarlo soltar.
 *  - Acepta VARIOS archivos de una: se suben de a uno y se informa cuántos entraron, porque
 *    puede fallar solo alguno (tamaño, extensión) y hay que decir cuál.
 */
import { ref, computed } from 'vue'
import { IonIcon } from '@ionic/vue'
import { cloudUploadOutline } from 'ionicons/icons'

const props = defineProps<{
  /** Sube un archivo. Devuelve ok + mensaje de error si falla. */
  subir: (file: File) => Promise<{ ok: boolean; message: string }>
  /** Deshabilita la zona (sin permiso de edición). */
  deshabilitada?: boolean
  /** Texto de ayuda debajo (tipos y tamaños aceptados). */
  ayuda?: string
}>()
const emit = defineEmits<{
  /** Terminó una tanda: cuántos entraron y qué falló (el padre refresca y avisa). */
  (e: 'listo', resultado: { subidos: number; errores: string[] }): void
}>()

const arrastrando = ref(0)
const subiendo = ref(false)
const entrada = ref<HTMLInputElement | null>(null)

const activa = computed(() => arrastrando.value > 0 && !props.deshabilitada && !subiendo.value)

/**
 * Sube una lista de archivos, de a uno, y avisa el resultado.
 * @param archivos - Lo que eligió o soltó el usuario.
 */
async function procesar(archivos: FileList | File[] | null): Promise<void> {
  const lista = Array.from(archivos ?? [])
  if (!lista.length || props.deshabilitada) return

  subiendo.value = true
  let subidos = 0
  const errores: string[] = []
  try {
    // De a uno y sin cortar al primer error: si de tres archivos falla el segundo, los otros
    // dos tienen que entrar igual y el usuario tiene que saber cuál falló y por qué.
    for (const file of lista) {
      const r = await props.subir(file)
      if (r.ok) subidos++
      else errores.push(`${file.name}: ${r.message}`)
    }
  } finally {
    subiendo.value = false
    arrastrando.value = 0
  }
  emit('listo', { subidos, errores })
}

function onDrop(e: DragEvent): void {
  arrastrando.value = 0
  if (props.deshabilitada) return
  void procesar(e.dataTransfer?.files ?? null)
}

function onChange(e: Event): void {
  const input = e.target as HTMLInputElement
  void procesar(input.files).then(() => { input.value = '' })
}
</script>

<template>
  <div
    class="zona"
    :class="{ 'zona-activa': activa, 'zona-off': deshabilitada }"
    @dragenter.prevent="arrastrando++"
    @dragleave.prevent="arrastrando = Math.max(0, arrastrando - 1)"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <IonIcon :icon="cloudUploadOutline" class="text-[18px] text-ink-faint shrink-0" />
    <div class="min-w-0">
      <p class="text-xs text-ink">
        <template v-if="subiendo">Subiendo…</template>
        <template v-else-if="activa">Soltá los archivos acá</template>
        <template v-else>
          Arrastrá archivos o
          <button type="button" class="text-accent-ink underline" :disabled="deshabilitada" @click="entrada?.click()">
            elegilos
          </button>
        </template>
      </p>
      <p v-if="ayuda" class="text-2xs text-ink-faint">{{ ayuda }}</p>
    </div>
    <input ref="entrada" type="file" class="hidden" multiple :disabled="deshabilitada" @change="onChange" />
  </div>
</template>

<style scoped>
.zona {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 10px;
  border: 1px dashed rgb(var(--s-line));
  background: rgb(var(--s-surface-2) / 0.4);
  transition: border-color 0.12s ease, background-color 0.12s ease;
}
.zona-activa {
  border-color: rgb(var(--s-accent));
  background: rgb(var(--s-accent-soft));
}
.zona-off { opacity: 0.55; }
</style>
