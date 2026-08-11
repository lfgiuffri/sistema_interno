<script setup lang="ts">
/**
 * Editor de descripciones de tareas (TipTap) — reemplaza el contenteditable+execCommand
 * del legado. Mismo vocabulario que la lista blanca del servidor: formato básico, h3,
 * listas, checklist, tabla, enlace (http/https/mailto) e imágenes subidas al backend.
 * El servidor RE-SANEA siempre: este editor es UX, no seguridad.
 */
import { onBeforeUnmount, watch } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { IonIcon } from '@ionic/vue'
import {
  textOutline, linkOutline, imageOutline, gridOutline,
  listOutline, checkboxOutline, removeOutline,
} from 'ionicons/icons'
import { useTareasStore } from '@/stores/tareas'
import { useToast } from '@/composables/useToast'
import { resolverArchivo, esArchivoProtegido } from '@/composables/useArchivosProtegidos'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const tareasStore = useTareasStore()
const toast = useToast()

// Imagen con nodeView propio: los archivos se sirven con auth → el src real se
// reemplaza por un blob al renderizar, pero el atributo (y el HTML guardado) no cambia.
const ImagenProtegida = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img')
      img.alt = String(node.attrs.alt || '')
      const src = String(node.attrs.src || '')
      if (esArchivoProtegido(src)) void resolverArchivo(src).then((u) => { img.src = u })
      else img.src = src
      return { dom: img }
    }
  },
})

const editor = useEditor({
  content: props.modelValue || '',
  extensions: [
    StarterKit.configure({ heading: { levels: [3] } }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['http', 'https', 'mailto'],
    }),
    ImagenProtegida,
    // parseHTML extendido: reconoce también el markup por clase (contenido guardado
    // por versiones previas del editor o saneado sin data-type).
    TaskList.extend({
      parseHTML: () => [{ tag: 'ul[data-type="taskList"]' }, { tag: 'ul.checklist' }],
    }).configure({ HTMLAttributes: { class: 'checklist' } }),
    TaskItem.extend({
      parseHTML: () => [{ tag: 'li[data-type="taskItem"]' }, { tag: 'li.checklist-item' }],
    }).configure({ nested: false, HTMLAttributes: { class: 'checklist-item' } }),
    Table.configure({ resizable: false }),
    TableRow, TableCell, TableHeader,
  ],
  editorProps: {
    attributes: { class: 'editor-body' },
    // Pegar una imagen desde el portapapeles la sube (regla del legado).
    handlePaste: (_view, event) => {
      const item = [...(event.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'))
      if (!item) return false
      const file = item.getAsFile()
      if (file) void subirImagen(file)
      return true
    },
  },
  onUpdate: ({ editor: ed }) => emit('update:modelValue', ed.getHTML()),
})

watch(() => props.modelValue, (v) => {
  if (!editor.value) return
  if (v !== editor.value.getHTML()) editor.value.commands.setContent(v || '', { emitUpdate: false })
})

onBeforeUnmount(() => editor.value?.destroy())

async function subirImagen(file: File): Promise<void> {
  const r = await tareasStore.subirArchivo(file)
  if (!r.ok || !r.url) { toast.error(r.message); return }
  editor.value?.chain().focus().setImage({ src: r.url }).run()
}

function elegirImagen(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/gif,image/webp'
  input.onchange = () => { if (input.files?.[0]) void subirImagen(input.files[0]) }
  input.click()
}

function ponerEnlace(): void {
  const previa = editor.value?.getAttributes('link').href as string | undefined
  const url = window.prompt('URL del enlace (http, https o mailto):', previa || 'https://')
  if (url === null) return
  if (!url || url === 'https://') { editor.value?.chain().focus().unsetLink().run(); return }
  if (!/^(https?:\/\/|mailto:)/i.test(url)) { toast.error('Solo se permiten enlaces http, https o mailto'); return }
  editor.value?.chain().focus().setLink({ href: url }).run()
}

function insertarTabla(): void {
  const filas = Math.min(Math.max(Number(window.prompt('¿Cuántas filas?', '3')) || 0, 1), 50)
  const cols = Math.min(Math.max(Number(window.prompt('¿Cuántas columnas?', '3')) || 0, 1), 20)
  editor.value?.chain().focus().insertTable({ rows: filas, cols, withHeaderRow: true }).run()
}

interface Btn { title: string; accion: () => void; activo?: () => boolean; texto?: string; icono?: string }
const BOTONES: Btn[] = [
  { title: 'Negrita', texto: 'B', accion: () => editor.value?.chain().focus().toggleBold().run(), activo: () => !!editor.value?.isActive('bold') },
  { title: 'Cursiva', texto: 'I', accion: () => editor.value?.chain().focus().toggleItalic().run(), activo: () => !!editor.value?.isActive('italic') },
  { title: 'Subrayado', texto: 'U', accion: () => editor.value?.chain().focus().toggleUnderline().run(), activo: () => !!editor.value?.isActive('underline') },
  { title: 'Tachado', texto: 'S', accion: () => editor.value?.chain().focus().toggleStrike().run(), activo: () => !!editor.value?.isActive('strike') },
  { title: 'Título', texto: 'H3', accion: () => editor.value?.chain().focus().toggleHeading({ level: 3 }).run(), activo: () => !!editor.value?.isActive('heading', { level: 3 }) },
  { title: 'Lista', icono: listOutline, accion: () => editor.value?.chain().focus().toggleBulletList().run(), activo: () => !!editor.value?.isActive('bulletList') },
  { title: 'Checklist', icono: checkboxOutline, accion: () => editor.value?.chain().focus().toggleTaskList().run(), activo: () => !!editor.value?.isActive('taskList') },
  { title: 'Tabla', icono: gridOutline, accion: insertarTabla },
  { title: 'Enlace', icono: linkOutline, accion: ponerEnlace, activo: () => !!editor.value?.isActive('link') },
  { title: 'Imagen', icono: imageOutline, accion: elegirImagen },
  { title: 'Quitar formato', icono: removeOutline, accion: () => editor.value?.chain().focus().clearNodes().unsetAllMarks().run() },
]
void textOutline
</script>

<template>
  <div class="editor-wrap">
    <div class="editor-toolbar" role="toolbar" aria-label="Formato">
      <button
        v-for="b in BOTONES"
        :key="b.title"
        type="button"
        class="tb-btn"
        :class="{ 'tb-activo': b.activo?.() }"
        :title="b.title"
        :aria-label="b.title"
        @mousedown.prevent
        @click="b.accion()"
      >
        <IonIcon v-if="b.icono" :icon="b.icono" class="text-[15px]" />
        <span v-else class="text-xs font-semibold" :class="{ italic: b.title === 'Cursiva', underline: b.title === 'Subrayado', 'line-through': b.title === 'Tachado' }">{{ b.texto }}</span>
      </button>
    </div>
    <EditorContent :editor="editor" />
  </div>
</template>

<style>
/* Sin scoped: TipTap renderiza dentro y necesita alcanzar .editor-body */
.editor-wrap {
  border: 1px solid rgb(var(--s-line));
  border-radius: 10px;
  background: rgb(var(--s-surface));
  overflow: hidden;
}
.editor-toolbar {
  display: flex; flex-wrap: wrap; gap: 2px; padding: 6px 8px;
  border-bottom: 1px solid rgb(var(--s-line-soft));
  background: rgb(var(--s-surface-2) / 0.5);
}
.tb-btn {
  display: grid; place-items: center; min-width: 28px; height: 26px; padding: 0 6px;
  border-radius: 6px; color: rgb(var(--s-ink-soft));
  transition: background-color 0.12s ease, color 0.12s ease;
}
.tb-btn:hover { background: rgb(var(--s-surface-2)); color: rgb(var(--s-ink)); }
.tb-activo { background: rgb(var(--s-accent-soft)); color: rgb(var(--s-accent-ink)); }

.editor-body {
  min-height: 160px; max-height: 340px; overflow-y: auto;
  padding: 10px 12px; font-size: 14px; line-height: 1.55; color: rgb(var(--s-ink));
  outline: none;
}
/* Tipografía del contenido (editor y vista comparten .desc-html) */
.editor-body h3, .desc-html h3 { font-size: 15px; font-weight: 600; margin: 10px 0 4px; }
.editor-body p, .desc-html p { margin: 4px 0; }
.editor-body ul:not(.checklist), .desc-html ul:not(.checklist) { list-style: disc; padding-left: 22px; margin: 4px 0; }
.editor-body ol, .desc-html ol { list-style: decimal; padding-left: 22px; margin: 4px 0; }
.editor-body a, .desc-html a { color: rgb(var(--s-accent-ink)); text-decoration: underline; }
.editor-body img, .desc-html img { max-width: 100%; border-radius: 8px; margin: 6px 0; }
.editor-body blockquote, .desc-html blockquote {
  border-left: 3px solid rgb(var(--s-line)); padding-left: 10px; margin: 6px 0; color: rgb(var(--s-ink-soft));
}
.editor-body pre, .desc-html pre {
  background: rgb(var(--s-surface-2)); border-radius: 8px; padding: 8px 10px;
  font-size: 12.5px; overflow-x: auto; margin: 6px 0;
}
.editor-body table, .desc-html table { border-collapse: collapse; margin: 8px 0; width: 100%; }
.editor-body th, .editor-body td, .desc-html th, .desc-html td {
  border: 1px solid rgb(var(--s-line)); padding: 4px 8px; font-size: 13px; text-align: left;
}
.editor-body th, .desc-html th { background: rgb(var(--s-surface-2) / 0.6); font-weight: 600; }

/* Checklist (TaskList de TipTap + HTML legado) */
.editor-body ul.checklist, .desc-html ul.checklist { list-style: none; padding-left: 2px; margin: 4px 0; }
.editor-body li.checklist-item, .desc-html li.checklist-item { display: flex; align-items: flex-start; gap: 7px; margin: 2px 0; }
.editor-body li.checklist-item > label { flex-shrink: 0; margin-top: 2px; }
.editor-body li.checklist-item > div { flex: 1; }
.desc-html li.checklist-item::before {
  content: ''; width: 14px; height: 14px; margin-top: 3px; flex-shrink: 0;
  border: 1.5px solid rgb(var(--s-line-strong, var(--s-line))); border-radius: 4px;
}
.desc-html li.checklist-item[data-checked='true']::before,
.desc-html li.checklist-item[data-checked='1']::before {
  background: rgb(var(--s-accent)); border-color: rgb(var(--s-accent));
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' d='M3.5 8.5l3 3 6-7'/%3E%3C/svg%3E");
  background-size: 12px; background-position: center; background-repeat: no-repeat;
}
.desc-html li.checklist-item[data-checked='true'] > div,
.desc-html li.checklist-item[data-checked='1'] > div { text-decoration: line-through; color: rgb(var(--s-ink-faint)); }
</style>
