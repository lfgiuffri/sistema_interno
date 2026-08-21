/**
 * Migración: bitácora general de cambios de tareas.
 *
 * `tarea_estados` solo registraba el estado, así que de una tarea se sabía quién la creó y
 * nada más. Esta tabla registra CUALQUIER campo.
 *
 * Las filas viejas se copian con `campo = 'estado'` para no perder el historial existente —
 * de ahí sale también el tiempo de trabajo del panel de equipo.
 *
 * `tarea_estados` NO se elimina acá a propósito: queda como respaldo por si hay que volver.
 * Se puede borrar en una migración posterior, una vez comprobado que la nueva anda bien.
 */

/**
 * Aplica la migración.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @returns {Promise<void>}
 */
export const up = async (sequelize) => {
    const q = sequelize.getQueryInterface();
    // showAllTables() devuelve OBJETOS ({ tableName, schema }) en MariaDB, no strings.
    const existentes = (await q.showAllTables()).map(t => String(t?.tableName ?? t).toLowerCase());
    if (existentes.includes('tarea_cambios')) return;

    await sequelize.query(`CREATE TABLE tarea_cambios (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tareaId INT NOT NULL,
        campo VARCHAR(30) NOT NULL,
        valorAnterior TEXT NULL,
        valorNuevo TEXT NULL,
        userId INT NULL,
        createdAt DATETIME NOT NULL,
        INDEX tarea_cambios_tarea_created (tareaId, createdAt),
        INDEX tarea_cambios_tarea_campo (tareaId, campo),
        CONSTRAINT tarea_cambios_ibfk_1 FOREIGN KEY (tareaId) REFERENCES tareas (id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

    // Historial existente: se conserva tal cual, marcado como cambios de estado.
    if (existentes.includes('tarea_estados')) {
        await sequelize.query(`INSERT INTO tarea_cambios (tareaId, campo, valorAnterior, valorNuevo, userId, createdAt)
            SELECT tareaId, 'estado', estadoAnterior, estadoNuevo, userId, createdAt FROM tarea_estados;`);
    }
};
