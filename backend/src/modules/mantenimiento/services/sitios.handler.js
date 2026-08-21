/**
 * Handler del scheduler para los sitios web (tick por minuto, trabajo cada 5).
 *
 *  1. **Disponibilidad** (cada 5 min): descarga cada sitio activo y busca el marcador del
 *     footer. La alerta espera al SEGUNDO fallo seguido (10 minutos) para no avisar por un
 *     microcorte de red; la recuperación, en cambio, avisa enseguida.
 *  2. **Certificado TLS**: se lee en el mismo chequeo (viene del handshake, sin costo extra).
 *  3. **Dominios** (una vez por día): refresco por RDAP y aviso de próximos a vencer.
 *  4. **Rollup + purga** (una vez por día): se consolida la velocidad del día que se va a
 *     perder ANTES de borrar su detalle. El orden importa: purgar primero borraría el dato
 *     sin resumirlo, y ese resumen es lo único que sobrevive para las series de mes y año.
 *
 * Corre dentro del proceso del backend, así que sigue activo aunque nadie use la app.
 */

import { Op } from 'sequelize';
import { getAppConfigNumber } from '../../../kernel/index.js';
import { avisar } from './alerta.service.js';
import { chequearSitio } from './chequeo.service.js';
import { vencimientoDominio } from './rdap.service.js';
import { estadoVencimiento } from './sitio.service.js';
import { urlDeVista, marcadorDeVista } from './vista.service.js';
import { consolidarDia } from './velocidad.service.js';

/** Cada cuánto se chequea la disponibilidad. */
const MINUTOS_CHEQUEO = 5;
/** Días de historial de chequeos que se conservan (después queda solo el resumen diario). */
const DIAS_HISTORIAL = 30;
/**
 * Cuántos días hacia atrás se consolidan en cada corrida diaria.
 *
 * Con 1 alcanzaría si el proceso nunca se detuviera. Con 7 se recupera solo de un apagado de
 * una semana: los días que quedaron sin resumir se resumen antes de que la purga los borre.
 */
const DIAS_A_CONSOLIDAR = 7;
/** Marca de la última corrida diaria (dominios + purga). */
const CONFIG_DIARIO = 'MANTENIMIENTO_SITIOS_ULTIMO_DIARIO';
/** Capability cuyos titulares reciben las alertas de sitios. */
const CAPABILITY = 'sitios:read';

/**
 * Nombre de una vista para los avisos. La home no se nombra (sería ruido: «Sitio X /» ),
 * el resto sí, porque saber QUÉ ruta se cayó es la mitad del aviso.
 * @param {object|null} vista - Vista afectada (o null: dominio y TLS son del sitio).
 * @returns {string} Sufijo para el título, vacío si es la home o no hay vista.
 */
const etiquetaVista = (vista) => {
    if (!vista || vista.ruta === '/') return '';
    return ` (${vista.nombre || vista.ruta})`;
};

/** Etiquetas legibles por tipo de incidente. */
const TITULOS = {
    offline: (s, v) => `🔴 ${s.nombre}${etiquetaVista(v)} está caído`,
    sin_marcador: (s, v) => `⚠️ ${s.nombre}${etiquetaVista(v)} responde pero no es nuestro sitio`,
    dominio: (s) => `📅 Dominio de ${s.nombre} por vencer`,
    tls: (s) => `🔒 Certificado de ${s.nombre} por vencer`,
};

/**
 * Abre un incidente del sitio si no había uno abierto de ese tipo, y avisa una sola vez.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @param {object} sitio - Sitio afectado.
 * @param {string} tipo - Tipo de incidente.
 * @param {string} detalle - Texto del problema.
 * @param {object|null} [vista] - Vista afectada (null para dominio y TLS, que son del sitio).
 * @returns {Promise<boolean>} true si abrió y avisó.
 */
const abrir = async (models, io, sitio, tipo, detalle, vista = null) => {
    const { SitioIncidente } = models;
    // El anti-spam es por (sitio, VISTA, tipo): si se cayeron la home y la tienda, son dos
    // problemas distintos y hay que avisar los dos. Con la clave solo por sitio, el segundo
    // quedaría silenciado por el primero.
    const vistaId = vista?.id ?? null;
    const abierto = await SitioIncidente.findOne({ where: { sitioId: sitio.id, vistaId, tipo, resueltoAt: null } });
    if (abierto) return false;

    await SitioIncidente.create({ sitioId: sitio.id, vistaId, tipo, detalle: detalle?.slice(0, 255) ?? null, createdAt: new Date() });
    await avisar(models, io, {
        tipo: `sitio-${tipo}`,
        titulo: (TITULOS[tipo] ?? ((s, v) => `Alerta en ${s.nombre}${etiquetaVista(v)}`))(sitio, vista),
        cuerpo: `${vista ? urlDeVista(sitio.url, vista.ruta) : sitio.url} — ${detalle}`,
        url: `/mantenimiento/sitios`,
    }, CAPABILITY);
    return true;
};

/**
 * Cierra el incidente abierto de ese tipo (si hay) y avisa la recuperación.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @param {object} sitio - Sitio.
 * @param {string} tipo - Tipo de incidente.
 * @param {boolean} [avisarRecuperacion] - Si manda el aviso (los vencimientos no lo necesitan).
 * @param {object|null} [vista] - Vista afectada (null para los incidentes del sitio).
 * @returns {Promise<boolean>} true si había uno abierto.
 */
const cerrar = async (models, io, sitio, tipo, avisarRecuperacion = true, vista = null) => {
    const { SitioIncidente } = models;
    const vistaId = vista?.id ?? null;
    const abierto = await SitioIncidente.findOne({ where: { sitioId: sitio.id, vistaId, tipo, resueltoAt: null } });
    if (!abierto) return false;

    const ahora = new Date();
    await abierto.update({ resueltoAt: ahora });
    if (!avisarRecuperacion) return true;

    const minutos = Math.max(1, Math.round((ahora - new Date(abierto.createdAt)) / 60000));
    await avisar(models, io, {
        tipo: 'sitio-ok',
        titulo: `✅ ${sitio.nombre}${etiquetaVista(vista)} volvió a estar en línea`,
        cuerpo: `${vista ? urlDeVista(sitio.url, vista.ruta) : sitio.url} — estuvo con problemas ${minutos} minuto(s).`,
        url: '/mantenimiento/sitios',
    }, CAPABILITY);
    return true;
};

/**
 * Chequea todos los sitios activos y actualiza su estado.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @returns {Promise<void>}
 */
const chequearSitios = async (models, io) => {
    const { SitioWeb, SitioVista, SitioChequeo } = models;
    const sitios = await SitioWeb.findAll({ where: { activo: true } });
    const minimoFallos = await getAppConfigNumber(models, 'MANTENIMIENTO_FALLOS_PARA_ALERTA');
    const diasTls = await getAppConfigNumber(models, 'MANTENIMIENTO_DIAS_AVISO_TLS');

    // Orden de gravedad para resumir las vistas en la columna `estado` del sitio.
    const GRAVEDAD = { offline: 3, sin_marcador: 2, desconocido: 1, online: 0 };

    for (const sitio of sitios) {
        const vistas = await SitioVista.findAll({ where: { sitioId: sitio.id, activo: true }, order: [['orden', 'ASC']] });
        // Un sitio sin vistas activas no se chequea: es el equivalente a tenerlo apagado.
        if (!vistas.length) continue;

        let peorEstado = 'online';
        let peorTiempo = null;
        let tlsLeido = null;

        for (const vista of vistas) {
            const url = urlDeVista(sitio.url, vista.ruta);
            const marcador = await marcadorDeVista(models, vista);
            const r = await chequearSitio(url, vista.verificaMarcador, marcador);

            await SitioChequeo.create({
                sitioId: sitio.id,
                vistaId: vista.id,
                estado: r.estado,
                httpStatus: r.httpStatus,
                tiempoMs: r.tiempoMs,
                motivo: r.motivo?.slice(0, 200) ?? null,
                createdAt: new Date(),
            });

            const fallo = r.estado !== 'online';
            const fallosSeguidos = fallo ? vista.fallosSeguidos + 1 : 0;

            await vista.update({
                estado: r.estado,
                ultimoChequeoAt: new Date(),
                ultimoCodigo: r.httpStatus,
                tiempoMs: r.tiempoMs,
                fallosSeguidos,
            });

            // Alerta recién al N-ésimo fallo consecutivo (default 2 = 10 minutos), y POR VISTA:
            // la home caída y la tienda caída son dos avisos, no uno.
            if (fallo && fallosSeguidos >= minimoFallos) {
                await abrir(models, io, sitio, r.estado === 'offline' ? 'offline' : 'sin_marcador', r.motivo ?? 'Sin detalle', vista);
            }
            if (!fallo) {
                await cerrar(models, io, sitio, 'offline', true, vista);
                await cerrar(models, io, sitio, 'sin_marcador', true, vista);
            }

            if (GRAVEDAD[r.estado] > GRAVEDAD[peorEstado]) peorEstado = r.estado;
            if (r.tiempoMs != null && (peorTiempo == null || r.tiempoMs > peorTiempo)) peorTiempo = r.tiempoMs;
            // El certificado es del HOST, así que alcanza con el primero que se pueda leer:
            // todas las vistas de un sitio comparten el mismo handshake.
            if (!tlsLeido && r.tlsVenceAt) tlsLeido = r.tlsVenceAt;
        }

        // La columna `estado` del sitio queda sincronizada con el peor de sus vistas. Está
        // duplicada a propósito: el panel y los filtros por estado la consultan directo, sin
        // tener que agregar las vistas en cada pedido.
        await sitio.update({
            estado: peorEstado,
            ultimoChequeoAt: new Date(),
            tiempoMs: peorTiempo,
            // El TLS solo se pisa si se pudo leer: un error de red no debe borrar la fecha.
            ...(tlsLeido ? { tlsVenceAt: tlsLeido } : {}),
        });

        // Certificado por vencer: es del sitio (no de la ruta), así que el incidente va sin vista.
        const tls = estadoVencimiento(tlsLeido ?? sitio.tlsVenceAt, diasTls);
        if (tls.estado === 'por_vencer' || tls.estado === 'vencido') {
            const vence = tlsLeido ?? sitio.tlsVenceAt;
            await abrir(models, io, sitio, 'tls', tls.estado === 'vencido'
                ? `El certificado venció el ${vence}.`
                : `El certificado vence el ${vence} (en ${tls.dias} días).`);
        } else if (tls.estado === 'ok') {
            await cerrar(models, io, sitio, 'tls', false);
        }
    }
};

/**
 * Refresca los vencimientos de dominio por RDAP y avisa los que están por vencer.
 * @param {object} models - Modelos de la app.
 * @param {object|null} io - Socket.IO.
 * @returns {Promise<void>}
 */
const revisarDominios = async (models, io) => {
    const { SitioWeb } = models;
    const sitios = await SitioWeb.findAll({ where: { activo: true } });
    const diasAviso = await getAppConfigNumber(models, 'MANTENIMIENTO_DIAS_AVISO_DOMINIO');

    for (const sitio of sitios) {
        // RDAP no pisa una fecha cargada A MANO. Ojo con la condición: `dominioAuto = false`
        // significa dos cosas distintas —«la puso una persona» y «todavía nunca se consultó»—
        // y solo la primera debe frenar el refresco. Distinguirlas por la fecha: sin fecha,
        // no hay nada que respetar. (Antes se miraba solo `dominioAuto` y un sitio nuevo, que
        // nace en false, no se consultaba NUNCA.)
        const fechaManual = !!sitio.dominioVenceAt && sitio.dominioAuto === false;
        if (sitio.dominio && !fechaManual) {
            const r = await vencimientoDominio(sitio.dominio);
            if (r.ok && r.venceAt) {
                // Se guarda el dominio REGISTRABLE que resolvió RDAP: es el que vence.
                await sitio.update({ dominio: r.dominio, dominioVenceAt: r.venceAt, dominioAuto: true, dominioConsultadoAt: new Date() });
            } else {
                // Falla de RDAP o TLD sin soporte: se deja la fecha que hubiera (no se borra).
                await sitio.update({ dominioConsultadoAt: new Date() });
            }
        }

        const dom = estadoVencimiento(sitio.dominioVenceAt, diasAviso);
        if (dom.estado === 'por_vencer' || dom.estado === 'vencido') {
            await abrir(models, io, sitio, 'dominio', dom.estado === 'vencido'
                ? `El dominio ${sitio.dominio} venció el ${sitio.dominioVenceAt}.`
                : `El dominio ${sitio.dominio} vence el ${sitio.dominioVenceAt} (en ${dom.dias} días).`);
        } else if (dom.estado === 'ok') {
            await cerrar(models, io, sitio, 'dominio', false);
        }
    }
};

/** Momento del último chequeo de disponibilidad. */
let ultimoChequeo = 0;

/**
 * Handler del scheduler: monitoreo de sitios web.
 * @type {{name: string, run: (ctx: {models: object, io: object}) => Promise<void>}}
 */
export const sitiosHandler = {
    name: 'monitoreo-sitios',
    /**
     * Corre en cada tick del scheduler (1 minuto) pero trabaja cada 5.
     * @param {{models: object, io: object}} ctx - Contexto del scheduler.
     * @returns {Promise<void>}
     */
    run: async ({ models, io }) => {
        if (!models.SitioWeb) return; // módulo no montado

        const ahora = Date.now();
        if (ahora - ultimoChequeo >= MINUTOS_CHEQUEO * 60 * 1000) {
            ultimoChequeo = ahora;
            await chequearSitios(models, io);
        }

        // Dominios + purga: una vez por día (RDAP no cambia de un minuto al otro).
        const { Config, SitioChequeo } = models;
        const hoy = new Date().toISOString().slice(0, 10);
        const marca = await Config.findOne({ where: { name: CONFIG_DIARIO } });
        if (marca?.value === hoy) return;

        await revisarDominios(models, io);

        // Rollup ANTES de purgar. Se consolidan los últimos días y no solo ayer: si el proceso
        // estuvo apagado el fin de semana, esos días igual se resumen antes de perderse. Es
        // idempotente (único por vista+fecha), así que re-consolidar un día ya hecho no duplica.
        let resumidos = 0;
        for (let atras = 1; atras <= DIAS_A_CONSOLIDAR; atras += 1) {
            const dia = new Date(Date.now() - atras * 24 * 3600 * 1000).toISOString().slice(0, 10);
            resumidos += await consolidarDia(models, dia);
        }

        const corte = new Date(Date.now() - DIAS_HISTORIAL * 24 * 3600 * 1000);
        const borrados = await SitioChequeo.destroy({ where: { createdAt: { [Op.lt]: corte } } });

        if (marca) await marca.update({ value: hoy });
        else await Config.create({ name: CONFIG_DIARIO, value: hoy, description: 'Última revisión diaria de dominios de sitios (interno).' });

        console.log(`🌐 [SITIOS] Dominios revisados; ${resumidos} resumen(es) de velocidad; ${borrados} chequeo(s) viejos purgados`);
    },
};
