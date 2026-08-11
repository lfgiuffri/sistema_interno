import { DataTypes } from 'sequelize';

/**
 * Modelo AbonoActualizacion: historial INMUTABLE de actualizaciones de precio de un abono.
 * Bitácora append-only: nunca se edita ni se borra desde la app (no es paranoid a propósito).
 * `operationId` da idempotencia a los flujos preview→aplicar (un doble submit no aplica
 * el aumento dos veces — corrige el bug #10 del sistema legado).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo AbonoActualizacion.
 */
export const defineAbonoActualizacionModel = (db) => {
    const AbonoActualizacion = db.define('abono_actualizaciones', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        abonoId: { type: DataTypes.INTEGER, allowNull: false },
        fecha: { type: DataTypes.DATEONLY, allowNull: false },
        moneda: { type: DataTypes.ENUM('ARS', 'USD'), allowNull: false },
        precioAnterior: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
        precioNuevo: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
        // 'porcentaje' (ARS) o 'cotizacion' (USD: se revisa el precio y se reinicia el reloj).
        tipo: { type: DataTypes.ENUM('porcentaje', 'cotizacion'), allowNull: false },
        porcentaje: { type: DataTypes.DECIMAL(7, 2), allowNull: true },
        cotizacion: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
        // Equivalente en pesos del precio nuevo (solo abonos USD; informativo/histórico).
        precioPesos: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
        userId: { type: DataTypes.INTEGER, allowNull: true },
        // Idempotencia del flujo aplicar: mismo operationId → no se re-aplica.
        operationId: { type: DataTypes.STRING(64), allowNull: true }
    }, {
        timestamps: true,
        updatedAt: false, // bitácora: solo createdAt
        indexes: [
            { fields: ['abonoId', 'fecha'] },
            { unique: true, fields: ['abonoId', 'operationId'] }
        ]
    });

    AbonoActualizacion.associate = (models) => {
        if (models.Abono) AbonoActualizacion.belongsTo(models.Abono, { foreignKey: 'abonoId' });
        if (models.User) AbonoActualizacion.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return AbonoActualizacion;
};
