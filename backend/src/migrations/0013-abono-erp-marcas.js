/**
 * Marcas de «cargado en el ERP» para el parte de cambios de abonos (2026-10-02).
 *
 * El parte lista qué registrar en el ERP externo; estas filas permiten ir tachando lo ya
 * hecho sin perder el hilo en el medio. Guardan los VALORES marcados y no solo el abono: una
 * marca por id dejaría tachado para siempre un abono al que después le cambian el precio otra
 * vez, y ese cambio nuevo nunca llegaría al ERP.
 *
 * UNIQUE por `abonoId`: marcar de nuevo pisa la marca anterior, que ya no significa nada.
 *
 * Idempotente: si la tabla existe, no hace nada.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @param {object} Sequelize - Constructores de tipos.
 * @returns {Promise<void>}
 */
export const up = async (sequelize, Sequelize) => {
    const q = sequelize.getQueryInterface();
    // ⚠️ showAllTables() devuelve OBJETOS en MariaDB: sin normalizar, el guard nunca corta.
    const tablas = (await q.showAllTables()).map(t => String(t?.tableName ?? t));
    if (tablas.includes('abono_erp_marcas')) {
        console.log('   ↷ abono_erp_marcas ya existe');
        return;
    }

    await q.createTable('abono_erp_marcas', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        abonoId: { type: Sequelize.INTEGER, allowNull: false },
        moneda: { type: Sequelize.ENUM('ARS', 'USD'), allowNull: false },
        precio: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
        montoPesos: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
        clienteId: { type: Sequelize.INTEGER, allowNull: false },
        servicioId: { type: Sequelize.INTEGER, allowNull: false },
        baja: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        userId: { type: Sequelize.INTEGER, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
    await q.addIndex('abono_erp_marcas', ['abonoId'], { unique: true, name: 'abono_erp_marcas_abonoId' });
    console.log('   ✓ abono_erp_marcas');
};
