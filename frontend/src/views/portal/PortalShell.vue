<script setup lang="ts">
/**
 * Shell del PORTAL DE CLIENTES: solo el contenedor del outlet.
 *
 * Sin split-pane, sin menú y sin header — el portal son dos pantallas, y clonar la maquinaria
 * de `AppShell.vue` (menú por capabilities, campana, presencia) sería traerle al portal cosas
 * que no tiene ni debe tener. La barra superior la pone cada página con `PortalHeader`, que es
 * como Ionic espera que se arme una vista ruteada.
 *
 * ⚠️ El `IonRouterOutlet` lleva un `id` distinto de `"main"`: dos outlets con el mismo id
 * conviven mal y Ionic termina mostrando la vista equivocada.
 */
import { onMounted } from 'vue'
import { IonPage, IonRouterOutlet } from '@ionic/vue'
import { usePortalAuthStore } from '@/stores/portal/auth'

const auth = usePortalAuthStore()
onMounted(() => { if (!auth.usuario) void auth.cargarContexto() })
</script>

<template>
  <IonPage>
    <IonRouterOutlet id="portal" />
  </IonPage>
</template>
