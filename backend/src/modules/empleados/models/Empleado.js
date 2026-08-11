import { DataTypes } from 'sequelize';

/** Categorías (mismas del legado). Freelance NO genera vacaciones. */
export const CATEGORIAS_EMPLEADO = ['Socio', 'Relación de dependencia', 'Monotributo', 'Freelance'];

/** Categorías que no otorgan vacaciones. */
export const CATEGORIAS_SIN_VACACIONES = ['Freelance'];

/** Estados civiles del formulario (lista fija del legado). */
export const ESTADOS_CIVILES = ['Soltero/a', 'Casado/a', 'Divorciado/a', 'Viudo/a', 'En pareja', 'Otro'];

/**
 * Modelo Empleado: ficha completa del personal.
 *
 * `sueldo` es un CACHE del vigente hoy — la fuente de verdad es el historial
 * (`sueldo_actualizaciones`, módulo sueldos): PRD §6.5 unifica la doble fuente del legado.
 * `vacDiasAnuales` es el otorgamiento anual por defecto (override por año en
 * vacacion_asignaciones). Freelance no genera vacaciones (las filas históricas quedan).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Empleado.
 */
export const defineEmpleadoModel = (db) => {
    const Empleado = db.define('empleados', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre: { type: DataTypes.STRING(150), allowNull: false },
        dni: { type: DataTypes.STRING(20), allowNull: true },
        cuil: { type: DataTypes.STRING(20), allowNull: true },
        nacionalidad: { type: DataTypes.STRING(60), allowNull: true },
        fechaNacimiento: { type: DataTypes.DATEONLY, allowNull: true },
        domicilio: { type: DataTypes.STRING(200), allowNull: true },
        telefono: { type: DataTypes.STRING(40), allowNull: true },
        email: { type: DataTypes.STRING(150), allowNull: true },
        estadoCivil: { type: DataTypes.STRING(30), allowNull: true },
        cargasFamiliares: { type: DataTypes.STRING(200), allowNull: true },
        // Contacto de urgencia.
        cuNombre: { type: DataTypes.STRING(150), allowNull: true },
        cuTelefono: { type: DataTypes.STRING(40), allowNull: true },
        cuParentesco: { type: DataTypes.STRING(60), allowNull: true },
        fechaIngreso: { type: DataTypes.DATEONLY, allowNull: true },
        observaciones: { type: DataTypes.TEXT, allowNull: true },
        categoria: { type: DataTypes.ENUM(...CATEGORIAS_EMPLEADO), allowNull: false, defaultValue: 'Relación de dependencia' },
        // Días de vacaciones por año (default 14, como el legado). Se conserva aunque sea
        // Freelance (volver de Freelance no pierde la config).
        vacDiasAnuales: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 14 },
        // CACHE del sueldo vigente hoy (la verdad vive en sueldo_actualizaciones).
        sueldo: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
        timestamps: true,
        paranoid: true,
        indexes: [{ fields: ['activo'] }]
    });

    Empleado.associate = (models) => {
        if (models.EmpleadoArea) Empleado.hasMany(models.EmpleadoArea, { foreignKey: 'empleadoId' });
        if (models.VacacionAsignacion) Empleado.hasMany(models.VacacionAsignacion, { foreignKey: 'empleadoId' });
        if (models.VacacionToma) Empleado.hasMany(models.VacacionToma, { foreignKey: 'empleadoId' });
        if (models.EmpleadoArchivo) Empleado.hasMany(models.EmpleadoArchivo, { foreignKey: 'empleadoId' });
        if (models.SueldoActualizacion) Empleado.hasMany(models.SueldoActualizacion, { foreignKey: 'empleadoId' });
        if (models.SueldoPago) Empleado.hasMany(models.SueldoPago, { foreignKey: 'empleadoId' });
    };

    return Empleado;
};
