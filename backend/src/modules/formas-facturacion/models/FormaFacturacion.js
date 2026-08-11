import { DataTypes } from 'sequelize';

/**
 * Modelo FormaFacturacion: formas de facturación de los abonos (SRL, Monotributo, etc.).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo FormaFacturacion.
 */
export const defineFormaFacturacionModel = (db) => {
    const FormaFacturacion = db.define('formas_facturacion', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre: { type: DataTypes.STRING(120), allowNull: false },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
        timestamps: true,
        paranoid: true,
        indexes: [{ fields: ['nombre'] }]
    });

    FormaFacturacion.associate = (models) => {
        if (models.Abono) FormaFacturacion.hasMany(models.Abono, { foreignKey: 'formaFacturacionId' });
    };

    return FormaFacturacion;
};
