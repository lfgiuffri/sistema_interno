import { DataTypes } from 'sequelize';

/**
 * Modelo EspacioTrabajo: contenedor de listas y tareas con acceso POR USUARIO.
 *
 * Segunda capa de permisos del módulo de tareas (../analisis_app_php/03 §0.2): además de la
 * capability de sección, cada usuario necesita ver/editar en el espacio (UsuarioEspacio).
 * Un espacio inactivo no aparece en la home de Tareas pero conserva sus listas y tareas.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo EspacioTrabajo.
 */
export const defineEspacioTrabajoModel = (db) => {
    const EspacioTrabajo = db.define('espacios_trabajo', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre: { type: DataTypes.STRING(100), allowNull: false },
        descripcion: { type: DataTypes.STRING(255), allowNull: true },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
        // Sequelize pluralizaría a "espacios_trabajos" (mal castellano): nombre fijo.
        tableName: 'espacios_trabajo',
        timestamps: true,
        // Soft delete; la unicidad de nombre se valida contra NO eliminados en el service
        // (el UNIQUE del legado incluía eliminados y explotaba al recrear nombres — bug §3.2).
        paranoid: true,
        indexes: [{ fields: ['activo'] }]
    });

    EspacioTrabajo.associate = (models) => {
        if (models.UsuarioEspacio) EspacioTrabajo.hasMany(models.UsuarioEspacio, { foreignKey: 'espacioId' });
        if (models.Lista) EspacioTrabajo.hasMany(models.Lista, { foreignKey: 'espacioId' });
        if (models.Tarea) EspacioTrabajo.hasMany(models.Tarea, { foreignKey: 'espacioId' });
    };

    return EspacioTrabajo;
};
