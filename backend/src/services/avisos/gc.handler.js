/**
 * GC de archivos huérfanos (mejora PRD §6.6 — el legado no borraba imágenes nunca):
 * corre en el scheduler, una vez por día. Elimina los archivos de tareas subidos hace
 * más de 48 h que nunca se ligaron a una tarea (tareaId null: imágenes pegadas en el
 * editor y descartadas sin guardar). Binario + registro.
 */

import fs from 'fs/promises';
import path from 'path';
import { Op } from 'sequelize';

const CONFIG_KEY = 'GC_ULTIMA_CORRIDA';
const HORAS_GRACIA = 48;

/**
 * Handler del scheduler: limpieza diaria de huérfanos.
 * @type {{name: string, run: (ctx: {db: object, models: object}) => Promise<void>}}
 */
export const gcHandler = {
    name: 'gc-archivos-huerfanos',
    run: async ({ models }) => {
        const { Config, TareaArchivo } = models;
        if (!Config || !TareaArchivo) return;

        const hoy = new Date().toISOString().slice(0, 10);
        const marca = await Config.findOne({ where: { name: CONFIG_KEY } });
        if (marca?.value === hoy) return;
        if (marca) await marca.update({ value: hoy });
        else await Config.create({ name: CONFIG_KEY, value: hoy, description: 'Última corrida del GC de archivos huérfanos (interno).' });

        const limite = new Date(Date.now() - HORAS_GRACIA * 3600 * 1000);
        const huerfanos = await TareaArchivo.findAll({
            where: { tareaId: null, createdAt: { [Op.lt]: limite } }
        });
        if (!huerfanos.length) return;

        const dir = path.resolve(process.cwd(), process.env.TAREAS_STORAGE_DIR || 'storage/tareas');
        for (const archivo of huerfanos) {
            await fs.unlink(path.join(dir, archivo.nombre)).catch(() => null);
            await archivo.destroy();
        }
        console.log(`🧹 [GC] ${huerfanos.length} archivo(s) huérfano(s) de tareas eliminados`);
    }
};
