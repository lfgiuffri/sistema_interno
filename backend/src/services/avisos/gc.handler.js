/**
 * GC de archivos huérfanos (mejora PRD §6.6 — el legado no borraba imágenes nunca):
 * corre en el scheduler, una vez por día.
 *
 * Un huérfano es un archivo subido que nunca quedó ligado a nada (`tareaId`/`documentoId` en
 * null): una imagen pegada en el editor y descartada sin guardar, o un adjunto cargado
 * durante un alta que después se canceló. El null es legítimo mientras se está creando —por
 * eso las 48 h de gracia— pero pasado ese plazo es basura: se borra el binario y el registro.
 */

import fs from 'fs/promises';
import path from 'path';
import { Op } from 'sequelize';

const CONFIG_KEY = 'GC_ULTIMA_CORRIDA';
const HORAS_GRACIA = 48;

/**
 * Qué se limpia. Un origen por módulo que sube archivos: mismo criterio, distinta tabla.
 * @type {Array<{modelo: string, fk: string, dir: () => string, etiqueta: string}>}
 */
const ORIGENES = [
    {
        modelo: 'TareaArchivo',
        fk: 'tareaId',
        dir: () => path.resolve(process.cwd(), process.env.TAREAS_STORAGE_DIR || 'storage/tareas'),
        etiqueta: 'tareas',
    },
    {
        modelo: 'DocumentoArchivo',
        fk: 'documentoId',
        dir: () => path.resolve(process.cwd(), process.env.DOCUMENTACION_STORAGE_DIR || 'storage/documentacion'),
        etiqueta: 'documentación',
    },
];

/**
 * Handler del scheduler: limpieza diaria de huérfanos.
 * @type {{name: string, run: (ctx: {db: object, models: object}) => Promise<void>}}
 */
export const gcHandler = {
    name: 'gc-archivos-huerfanos',
    /**
     * Corre una vez por día (marca en Config).
     * @param {{models: object}} ctx - Contexto del scheduler.
     * @returns {Promise<void>}
     */
    run: async ({ models }) => {
        const { Config } = models;
        if (!Config) return;

        const hoy = new Date().toISOString().slice(0, 10);
        const marca = await Config.findOne({ where: { name: CONFIG_KEY } });
        if (marca?.value === hoy) return;
        if (marca) await marca.update({ value: hoy });
        else await Config.create({ name: CONFIG_KEY, value: hoy, description: 'Última corrida del GC de archivos huérfanos (interno).' });

        const limite = new Date(Date.now() - HORAS_GRACIA * 3600 * 1000);

        for (const origen of ORIGENES) {
            const Modelo = models[origen.modelo];
            if (!Modelo) continue; // módulo no montado

            const huerfanos = await Modelo.findAll({
                where: { [origen.fk]: null, createdAt: { [Op.lt]: limite } },
            });
            if (!huerfanos.length) continue;

            const dir = origen.dir();
            for (const archivo of huerfanos) {
                await fs.unlink(path.join(dir, archivo.nombre)).catch(() => null);
                await archivo.destroy();
            }
            console.log(`🧹 [GC] ${huerfanos.length} archivo(s) huérfano(s) de ${origen.etiqueta} eliminados`);
        }
    }
};
