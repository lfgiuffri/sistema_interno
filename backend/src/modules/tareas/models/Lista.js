import { DataTypes } from 'sequelize';

/**
 * Modelo Lista: agrupador de tareas dentro de un espacio de trabajo.
 * Unicidad de nombre POR ESPACIO contra no eliminadas (validada en el service, con oferta
 * de reactivación). `activa` es cosmético en el listado (una lista inactiva se ve atenuada).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Lista.
 */
export const defineListaModel = (db) => {
    const Lista = db.define('listas', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        espacioId: { type: DataTypes.INTEGER, allowNull: false },
        nombre: { type: DataTypes.STRING(100), allowNull: false },
        descripcion: { type: DataTypes.STRING(255), allowNull: true },
        activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
        timestamps: true,
        paranoid: true,
        indexes: [{ fields: ['espacioId'] }]
    });

    Lista.associate = (models) => {
        if (models.EspacioTrabajo) Lista.belongsTo(models.EspacioTrabajo, { foreignKey: 'espacioId' });
        if (models.Tarea) Lista.hasMany(models.Tarea, { foreignKey: 'listaId' });
    };

    return Lista;
};
