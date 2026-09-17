import { DataTypes } from 'sequelize';

/**
 * Eventos de una incidencia que se le pueden avisar por mail al cliente, con su columna y su
 * default. FUENTE ÚNICA: la usan el modelo (para definir las columnas), el outbox del mail
 * (para decidir si manda) y la pantalla de configuración (para pintar los checkboxes).
 *
 * Los defaults son los pedidos: el cliente se entera de que **cargamos** su incidencia y de
 * que quedó **resuelta**. Los pasos intermedios no avisan — que una tarea pase a «en progreso»
 * es movimiento nuestro, no una novedad para él.
 */
export const AVISOS_INCIDENCIA = [
    { evento: 'creada', campo: 'avisaCreada', label: 'Cuando se carga la incidencia', porDefecto: true },
    { evento: 'nueva', campo: 'avisaNueva', label: 'Cuando vuelve a «nueva»', porDefecto: false },
    { evento: 'en_progreso', campo: 'avisaEnProgreso', label: 'Cuando pasa a «en progreso»', porDefecto: false },
    { evento: 'resuelta', campo: 'avisaResuelta', label: 'Cuando queda resuelta', porDefecto: true }
];

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
        /**
         * Destinatarios de los avisos de incidencias, separados por coma. Es una lista propia
         * y no `email` ni los usuarios del portal: puede incluir a gente que necesita
         * enterarse sin entrar al portal (el gerente, el que factura).
         */
        emailsNotificacion: { type: DataTypes.TEXT, allowNull: true },
        // Qué eventos avisan (ver AVISOS_INCIDENCIA arriba). Se generan desde la misma lista
        // para que agregar un evento sea tocar un solo lugar.
        ...Object.fromEntries(AVISOS_INCIDENCIA.map(a => [
            a.campo,
            { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: a.porDefecto }
        ])),
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
        if (models.ClienteUsuario) Cliente.hasMany(models.ClienteUsuario, { foreignKey: 'clienteId' });
        if (models.Incidencia) Cliente.hasMany(models.Incidencia, { foreignKey: 'clienteId' });
    };

    return Cliente;
};
