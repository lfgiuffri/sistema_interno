import { DataTypes } from 'sequelize';

/** Estados de tarea — MISMO ORDEN que el ENUM del legado (ordenar por la columna usa este orden). */
export const ESTADOS_TAREA = ['abierta', 'en_progreso', 'pausada', 'en_revision', 'completada'];

/** Estados que cuentan como pendientes (pausada SIGUE pendiente — regla del legado). */
export const ESTADOS_PENDIENTES = ['abierta', 'en_progreso', 'pausada', 'en_revision'];

/** Prioridades (color → peso): verde=Baja, amarillo=Media, naranja=Alta, rojo=Urgente. */
export const PRIORIDADES_TAREA = ['verde', 'amarillo', 'naranja', 'rojo'];

/**
 * Modelo Tarea: unidad de trabajo dentro de una lista de un espacio.
 *
 * Reglas del legado (../analisis_app_php/03 §1.3/§2):
 *  - `espacioId` se guarda desnormalizado (el acceso se controla por el espacio de la tarea).
 *  - `descripcion` es HTML SANEADO en servidor (al guardar y al servir).
 *  - `asignadoA` null = sin asignar; solo usuarios asignables (activos con tareas:update o admin).
 *  - El estado vigente vive acá; la bitácora de cambios en TareaEstado (append-only).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Tarea.
 */
export const defineTareaModel = (db) => {
    const Tarea = db.define('tareas', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        espacioId: { type: DataTypes.INTEGER, allowNull: false },
        listaId: { type: DataTypes.INTEGER, allowNull: false },
        nombre: { type: DataTypes.STRING(200), allowNull: false },
        descripcion: { type: DataTypes.TEXT('medium'), allowNull: true },
        asignadoA: { type: DataTypes.INTEGER, allowNull: true },
        creadoPor: { type: DataTypes.INTEGER, allowNull: true },
        prioridad: { type: DataTypes.ENUM(...PRIORIDADES_TAREA), allowNull: false, defaultValue: 'verde' },
        estado: { type: DataTypes.ENUM(...ESTADOS_TAREA), allowNull: false, defaultValue: 'abierta' },
        fechaInicio: { type: DataTypes.DATEONLY, allowNull: true },
        fechaVencimiento: { type: DataTypes.DATEONLY, allowNull: true },
        /**
         * Posición MANUAL dentro de la lista (arrastrar y soltar), en múltiplos de 10.
         * 0 = nunca se acomodó a mano: esas tareas empatan y las desempata el orden
         * automático del legado, así que una lista que nadie tocó se ve igual que siempre.
         * Las completadas no participan: van al fondo por estado, antes de mirar esto.
         */
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
    }, {
        timestamps: true,
        paranoid: true,
        indexes: [
            { fields: ['espacioId'] },
            { fields: ['listaId'] },
            { fields: ['asignadoA'] },
            { fields: ['estado'] },
            { fields: ['fechaVencimiento'] },
            { fields: ['listaId', 'orden'] }
        ]
    });

    Tarea.associate = (models) => {
        if (models.EspacioTrabajo) Tarea.belongsTo(models.EspacioTrabajo, { foreignKey: 'espacioId' });
        if (models.Lista) Tarea.belongsTo(models.Lista, { foreignKey: 'listaId' });
        if (models.User) {
            Tarea.belongsTo(models.User, { foreignKey: 'asignadoA', as: 'asignado' });
            Tarea.belongsTo(models.User, { foreignKey: 'creadoPor', as: 'creador' });
        }
        if (models.TareaEstado) Tarea.hasMany(models.TareaEstado, { foreignKey: 'tareaId' });
        if (models.TareaArchivo) Tarea.hasMany(models.TareaArchivo, { foreignKey: 'tareaId' });
    };

    return Tarea;
};
