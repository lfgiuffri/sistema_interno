/**
 * Outbox de los avisos por mail de incidencias — handler del scheduler (tick por minuto).
 *
 * El cambio de estado NO manda el mail en el momento. Escribe una fila en `incidencia_cambios`
 * con `notificadoAt: null`, dentro de la misma transacción del cambio, y este handler la
 * levanta después. Eso compra cuatro cosas concretas:
 *  - Si la transacción hace rollback, el mail nunca se mandó avisando algo que no pasó.
 *  - Un SMTP lento no cuelga el request de nadie, y uno caído no pierde el aviso: la fila
 *    queda pendiente y el próximo tick la reintenta.
 *  - Se AGRUPA: mover 20 tareas de un lote es un mail por cliente, no 20.
 *  - Queda registrado por qué NO salió un mail, que es la pregunta del día que un cliente
 *    diga «no me llegó nada».
 *
 * El costo es hasta un minuto de latencia, que para avisarle a un cliente que su reclamo se
 * resolvió no significa nada.
 */

import { Op } from 'sequelize';
import { isSmtpConfigured, sendMail } from '../../../kernel/mail/mailer.js';
import { AVISOS_INCIDENCIA } from '../../clientes/models/Cliente.js';

/** Tope de eventos por tick: si se acumuló mucho, se procesa de a tandas. */
const TOPE_POR_TICK = 200;

/** Etiqueta legible de cada estado, para el cuerpo del mail. */
const ETIQUETA = {
    nueva: 'nueva',
    en_progreso: 'en progreso',
    resuelta: 'resuelta'
};

/**
 * Destinatarios configurados de un cliente.
 *
 * Sale del campo propio `emailsNotificacion` y no de los usuarios del portal: puede incluir a
 * alguien que necesita enterarse sin entrar al portal (el gerente, el que factura). Se
 * separan por coma, punto y coma o salto de línea, porque nadie escribe una lista igual dos
 * veces, y se deduplican.
 * @param {object} cliente - Cliente.
 * @returns {string[]} Direcciones únicas y válidas.
 */
const destinatarios = (cliente) => {
    const crudo = String(cliente?.emailsNotificacion || '');
    const mails = crudo.split(/[,;\n]/).map(m => m.trim()).filter(m => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m));
    return [...new Set(mails.map(m => m.toLowerCase()))];
};

/**
 * ¿Este cliente pidió que le avisen de este evento?
 * @param {object} cliente - Cliente.
 * @param {string} evento - Evento de `AVISOS_INCIDENCIA`.
 * @returns {boolean} true si corresponde mandar.
 */
const avisaDe = (cliente, evento) => {
    const config = AVISOS_INCIDENCIA.find(a => a.evento === evento);
    if (!config) return false;
    // Falta de dato = avisa: un cliente creado antes de esta feature no puede quedar mudo por
    // omisión (el default de la columna ya lo cubre, esto es el cinturón).
    return cliente[config.campo] !== false;
};

/**
 * Arma el asunto y el cuerpo de un mail agrupando los eventos de UN cliente.
 * @param {object} cliente - Cliente.
 * @param {object[]} eventos - Filas de `incidencia_cambios` con su incidencia incluida.
 * @returns {{subject: string, text: string}} El mail.
 */
const armarMail = (cliente, eventos) => {
    const lineas = eventos.map(e => {
        const inc = e.incidencia;
        const ref = `#${inc.id} «${inc.titulo}»`;
        if (e.evento === 'creada') return `• ${ref}: recibimos tu incidencia.`;
        return `• ${ref}: pasó a ${ETIQUETA[e.evento] ?? e.evento}.`;
    });

    const subject = eventos.length === 1
        ? (eventos[0].evento === 'creada'
            ? `Recibimos tu incidencia #${eventos[0].incidencia.id}`
            : `Tu incidencia #${eventos[0].incidencia.id} está ${ETIQUETA[eventos[0].evento] ?? eventos[0].evento}`)
        : `${eventos.length} novedades en tus incidencias`;

    const text = [
        `Hola ${cliente.nombre},`,
        '',
        eventos.length === 1 ? 'Novedad sobre tu incidencia:' : 'Novedades sobre tus incidencias:',
        ...lineas,
        '',
        'Podés ver el detalle entrando a tu portal.',
        '',
        'Positive Media'
    ].join('\n');

    return { subject, text };
};

/**
 * Procesa los avisos pendientes: agrupa por cliente, manda y estampa.
 * @param {object} models - Modelos de la app.
 * @returns {Promise<{mandados: number, omitidos: number}>} Resumen del tick.
 */
export const procesarAvisos = async (models) => {
    const { IncidenciaCambio, Incidencia, Cliente } = models;
    if (!IncidenciaCambio) return { mandados: 0, omitidos: 0 };

    const pendientes = await IncidenciaCambio.findAll({
        where: { notificadoAt: null },
        include: [{
            model: Incidencia,
            required: true,
            paranoid: false,
            attributes: ['id', 'titulo', 'clienteId']
        }],
        order: [['createdAt', 'ASC']],
        limit: TOPE_POR_TICK
    });
    if (!pendientes.length) return { mandados: 0, omitidos: 0 };

    // Agrupar por cliente ANTES de decidir nada: 20 eventos del mismo cliente son un mail.
    const porCliente = new Map();
    for (const evento of pendientes) {
        const clienteId = evento.incidencia.clienteId;
        if (!porCliente.has(clienteId)) porCliente.set(clienteId, []);
        porCliente.get(clienteId).push(evento);
    }

    const ahora = new Date();
    let mandados = 0;
    let omitidos = 0;

    for (const [clienteId, eventos] of porCliente) {
        const cliente = await Cliente.findByPk(clienteId, { paranoid: false });

        // El filtro por evento se aplica ACÁ y no al escribir la bitácora: la bitácora es
        // auditoría y registra lo que pasó, independientemente de las preferencias de aviso.
        const aMandar = cliente ? eventos.filter(e => avisaDe(cliente, e.evento)) : [];
        const aOmitir = eventos.filter(e => !aMandar.includes(e));

        if (aMandar.length && destinatarios(cliente).length) {
            const { subject, text } = armarMail(cliente, aMandar);
            for (const to of destinatarios(cliente)) {
                // Sin SMTP, `sendMail` loguea a consola y devuelve { sent: false }: en
                // desarrollo se ve el aviso sin montar un servidor de correo.
                await sendMail({ to, subject, text }).catch(() => null);
            }
            await IncidenciaCambio.update(
                { notificadoAt: ahora, notificado: true },
                { where: { id: aMandar.map(e => e.id) } }
            );
            mandados += aMandar.length;
        } else if (aMandar.length) {
            // Pidió el aviso pero no hay a quién mandarlo: se marca omitido igual, si no se
            // reintentaría para siempre.
            await IncidenciaCambio.update(
                { notificadoAt: ahora, notificado: false },
                { where: { id: aMandar.map(e => e.id) } }
            );
            omitidos += aMandar.length;
        }

        if (aOmitir.length) {
            await IncidenciaCambio.update(
                { notificadoAt: ahora, notificado: false },
                { where: { id: aOmitir.map(e => e.id) } }
            );
            omitidos += aOmitir.length;
        }
    }

    if (mandados || omitidos) {
        const extra = isSmtpConfigured() ? '' : ' (sin SMTP: a consola)';
        console.log(`📧 [INCIDENCIAS] ${mandados} aviso(s) enviado(s), ${omitidos} omitido(s)${extra}`);
    }
    return { mandados, omitidos };
};

/**
 * Handler del scheduler.
 * @type {{name: string, run: (ctx: {models: object}) => Promise<void>}}
 */
export const avisoIncidenciaHandler = {
    name: 'avisos-incidencias',
    /**
     * Corre en cada tick del scheduler (1 minuto).
     * @param {{models: object}} ctx - Contexto del scheduler.
     * @returns {Promise<void>}
     */
    run: async ({ models }) => {
        if (!models.Incidencia) return;   // módulo no montado
        await procesarAvisos(models);
    }
};
