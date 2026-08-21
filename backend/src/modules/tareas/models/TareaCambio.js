import { DataTypes } from 'sequelize';

/**
 * Modelo TareaCambio: bitácora APPEND-ONLY de TODO cambio en una tarea.
 *
 * Reemplaza a `tarea_estados`, que solo registraba el estado: por eso se veía quién creó la
 * tarea y nada más: cambiar el nombre, el asignado, la prioridad o las fechas no dejaba
 * rastro, y la edición rápida no anotaba nunca.
 *
 * Una fila por CAMPO cambiado, no por edición: así el detalle dice «cambió la prioridad de
 * verde a rojo» en vez de «editó la tarea», que no sirve para reconstruir nada.
 *
 * `valorAnterior` null = creación de la tarea (no había valor previo).
 *
 * ⚠️ De acá sale el TIEMPO DE TRABAJO del panel de equipo (tramos en `en_progreso`), que lee
 * las filas con `campo = 'estado'`. Cualquier cambio en cómo se anotan los estados afecta ese
 * cálculo.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo TareaCambio.
 */
export const defineTareaCambioModel = (db) => {
    const TareaCambio = db.define('tarea_cambios', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        tareaId: { type: DataTypes.INTEGER, allowNull: false },
        /** Qué cambió: estado | nombre | asignado | prioridad | fechaInicio | fechaVencimiento | descripcion | lista. */
        campo: { type: DataTypes.STRING(30), allowNull: false },
        /** TEXT y no STRING: un nombre son 200 caracteres y una descripción puede ser larga. */
        valorAnterior: { type: DataTypes.TEXT, allowNull: true },
        valorNuevo: { type: DataTypes.TEXT, allowNull: true },
        userId: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        tableName: 'tarea_cambios',
        timestamps: true,
        updatedAt: false,   // bitácora: solo createdAt
        indexes: [{ fields: ['tareaId', 'createdAt'] }, { fields: ['tareaId', 'campo'] }]
    });

    TareaCambio.associate = (models) => {
        if (models.Tarea) TareaCambio.belongsTo(models.Tarea, { foreignKey: 'tareaId' });
        if (models.User) TareaCambio.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return TareaCambio;
};
