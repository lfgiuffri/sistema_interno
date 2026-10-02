import { DataTypes } from 'sequelize';

/**
 * Marca de «ya lo cargué en el ERP» para una fila del parte de cambios.
 *
 * Guarda los VALORES que se marcaron, no solo el id del abono. Es la diferencia entre que
 * esto sirva o engañe: si alguien marca el abono, y después le vuelven a cambiar el precio,
 * una marca por id lo dejaría tachado para siempre y el cambio nuevo nunca se cargaría en el
 * ERP. Con los valores guardados, la marca vale mientras el abono siga igual a como estaba
 * cuando se marcó; si se movió, la fila vuelve a aparecer sin marcar.
 *
 * Una fila por abono (UNIQUE): marcar de nuevo pisa la anterior, que ya no significa nada.
 *
 * Es de la EMPRESA, no de quien marcó (el sistema es colaborativo): si uno carga la mitad del
 * parte en el ERP y sigue otro, el segundo tiene que ver lo que ya hizo el primero. `userId`
 * queda como autoría.
 * @param {import('sequelize').Sequelize} db - Conexión.
 * @returns {import('sequelize').ModelStatic<any>} Modelo AbonoErpMarca.
 */
export const defineAbonoErpMarcaModel = (db) => {
    const AbonoErpMarca = db.define('abono_erp_marcas', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        abonoId: { type: DataTypes.INTEGER, allowNull: false, unique: true },

        // ── La foto de lo marcado. Son los MISMOS campos que compara el parte de cambios:
        // si alguno se mueve, lo que se cargó en el ERP dejó de ser lo vigente.
        moneda: { type: DataTypes.ENUM('ARS', 'USD'), allowNull: false },
        precio: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
        montoPesos: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
        clienteId: { type: DataTypes.INTEGER, allowNull: false },
        servicioId: { type: DataTypes.INTEGER, allowNull: false },
        /** true = se marcó como BAJA. Que vuelva a estar vigente invalida la marca. */
        baja: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

        userId: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        tableName: 'abono_erp_marcas',
        timestamps: true,
        indexes: [{ unique: true, fields: ['abonoId'] }]
    });

    /**
     * Asociaciones: el abono que marca y el usuario que la puso.
     * @param {object} models - Modelos de la app.
     * @returns {void}
     */
    AbonoErpMarca.associate = (models) => {
        if (models.Abono) AbonoErpMarca.belongsTo(models.Abono, { foreignKey: 'abonoId' });
        if (models.User) AbonoErpMarca.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return AbonoErpMarca;
};
