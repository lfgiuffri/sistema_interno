import { DataTypes } from 'sequelize';

/**
 * Modelo Cliente: clientes de la empresa (entidad compartida por abonos y proyectos).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Cliente.
 */
export const defineClienteModel = (db) => {
    const Cliente = db.define('clientes', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre: { type: DataTypes.STRING(160), allowNull: false },
        contacto: { type: DataTypes.STRING(160), allowNull: true },
        email: { type: DataTypes.STRING(160), allowNull: true },
        telefono: { type: DataTypes.STRING(60), allowNull: true },
        observaciones: { type: DataTypes.TEXT, allowNull: true },
        // En el sistema legado esta columna existía pero no se usaba; acá se implementa
        // (toggle + filtro) para unificar con el resto de los catálogos (PRD §6.1).
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
        timestamps: true,
        paranoid: true,
        indexes: [{ fields: ['nombre'] }]
    });

    Cliente.associate = (models) => {
        if (models.Abono) Cliente.hasMany(models.Abono, { foreignKey: 'clienteId' });
        if (models.Proyecto) Cliente.hasMany(models.Proyecto, { foreignKey: 'clienteId' });
    };

    return Cliente;
};
