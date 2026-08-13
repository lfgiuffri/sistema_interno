/**
 * Migración: `estadisticas:read` — la pantalla de Estadísticas pasa a tener capability propia.
 *
 * Antes se gateaba con `facturaciones:read` (los tres gráficos salen de facturación). Al
 * separarla, los roles que hoy ven los gráficos la perderían en silencio: esta migración se
 * la otorga a todos los que tengan `facturaciones:read`, para que nadie pierda un acceso que
 * ya tenía. Sacarla después es un clic en la pantalla de Roles.
 *
 * Idempotente: no duplica la fila si ya existe (índice único roleId+capability+deletedAt).
 */

import { QueryTypes } from 'sequelize';

/**
 * Aplica la migración.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @returns {Promise<void>}
 */
export const up = async (sequelize) => {
    const roles = await sequelize.query(
        `SELECT DISTINCT rc.roleId
           FROM role_capabilities rc
          WHERE rc.capability = 'facturaciones:read'
            AND rc.deletedAt IS NULL
            AND NOT EXISTS (
                SELECT 1 FROM role_capabilities x
                 WHERE x.roleId = rc.roleId AND x.capability = 'estadisticas:read' AND x.deletedAt IS NULL
            )`,
        { type: QueryTypes.SELECT },
    );

    for (const { roleId } of roles) {
        await sequelize.query(
            'INSERT INTO role_capabilities (roleId, capability, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())',
            { replacements: [roleId, 'estadisticas:read'] },
        );
    }
};
