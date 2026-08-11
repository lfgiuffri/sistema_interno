import { DataTypes } from 'sequelize';

/**
 * Modelo Abono: servicio recurrente contratado por un cliente, que se factura mes a mes.
 *
 * Reglas de negocio clave (del sistema legado, ver ../analisis_app_php/05):
 *  - `periodoMeses` NO es la periodicidad de facturación (que es mensual e implícita):
 *    es cada cuántos meses corresponde ACTUALIZAR el precio.
 *  - Los abonos en USD guardan el precio EN DÓLARES; el equivalente en pesos se calcula
 *    con la cotización global y solo se congela al facturar.
 *  - Un abono NACE INACTIVO (se activa cuando el proyecto asociado está terminado).
 *    Los inactivos no se facturan, no se actualizan y no suman en totales.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Abono.
 */
export const defineAbonoModel = (db) => {
    const Abono = db.define('abonos', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        clienteId: { type: DataTypes.INTEGER, allowNull: false },
        servicioId: { type: DataTypes.INTEGER, allowNull: false },
        // Referencia para distinguir dos abonos del mismo servicio (ej. qué e-commerce).
        descripcion: { type: DataTypes.STRING(255), allowNull: true },
        moneda: { type: DataTypes.ENUM('ARS', 'USD'), allowNull: false, defaultValue: 'USD' },
        precio: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
        fechaInicio: { type: DataTypes.DATEONLY, allowNull: false },
        // Cada cuántos meses corresponde actualizar el precio (alertas del panel).
        periodoMeses: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 12 },
        fechaUltimaActualizacion: { type: DataTypes.DATEONLY, allowNull: true },
        formaFacturacionId: { type: DataTypes.INTEGER, allowNull: true },
        observaciones: { type: DataTypes.TEXT, allowNull: true },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
    }, {
        timestamps: true,
        paranoid: true,
        indexes: [
            { fields: ['clienteId'] },
            { fields: ['servicioId'] },
            { fields: ['formaFacturacionId'] },
            { fields: ['activo'] }
        ]
    });

    Abono.associate = (models) => {
        if (models.Cliente) Abono.belongsTo(models.Cliente, { foreignKey: 'clienteId' });
        if (models.Servicio) Abono.belongsTo(models.Servicio, { foreignKey: 'servicioId' });
        if (models.FormaFacturacion) Abono.belongsTo(models.FormaFacturacion, { foreignKey: 'formaFacturacionId', as: 'formaFacturacion' });
        if (models.AbonoActualizacion) Abono.hasMany(models.AbonoActualizacion, { foreignKey: 'abonoId' });
        if (models.Facturacion) Abono.hasMany(models.Facturacion, { foreignKey: 'abonoId' });
    };

    return Abono;
};
