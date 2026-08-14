import { DataTypes } from 'sequelize';

/**
 * Modelo Servidor: inventario de VPS de la empresa + su configuración de monitoreo.
 *
 * `monitorea` distingue los servidores que administramos (llevan agente instalado y
 * reportan CPU/RAM/disco) de los de terceros, a los que solo se les prueba si responden
 * desde afuera (conexión TCP a `puertoChequeo`).
 *
 * El agente se autentica con un token propio del servidor: se guarda HASHEADO (sha256 —
 * el token es aleatorio de 256 bits, no hay riesgo de fuerza bruta) y se muestra UNA sola
 * vez al generarlo, como el secreto de los webhooks.
 *
 * Los umbrales en null significan "usar el global" (`MANTENIMIENTO_UMBRAL_*` de configuración):
 * solo se completan en el servidor que legítimamente vive alto y no debe alertar.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Servidor.
 */
export const defineServidorModel = (db) => {
    const Servidor = db.define('servidores', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre: { type: DataTypes.STRING(120), allowNull: false },
        ip: { type: DataTypes.STRING(45), allowNull: false },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        // false = servidor de un tercero: sin agente, solo chequeo TCP externo.
        monitorea: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        // Puerto para el chequeo externo (443 por defecto; 22 si no publica web).
        puertoChequeo: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 443 },
        tokenHash: { type: DataTypes.STRING(64), allowNull: true },
        // Umbrales propios; null = usa el global de configuración.
        umbralCpu: { type: DataTypes.INTEGER, allowNull: true },
        umbralRam: { type: DataTypes.INTEGER, allowNull: true },
        umbralDisco: { type: DataTypes.INTEGER, allowNull: true },
        // Última señal de vida (reporte del agente o chequeo TCP exitoso).
        ultimoContactoAt: { type: DataTypes.DATE, allowNull: true },
        estado: { type: DataTypes.ENUM('online', 'offline', 'desconocido'), allowNull: false, defaultValue: 'desconocido' },
        so: { type: DataTypes.STRING(120), allowNull: true },
        observaciones: { type: DataTypes.TEXT, allowNull: true }
    }, {
        tableName: 'servidores',
        timestamps: true,
        paranoid: true,
        indexes: [{ fields: ['activo'] }, { fields: ['estado'] }]
    });

    Servidor.associate = (models) => {
        if (models.ServidorMetrica) Servidor.hasMany(models.ServidorMetrica, { foreignKey: 'servidorId' });
        if (models.ServidorIncidente) Servidor.hasMany(models.ServidorIncidente, { foreignKey: 'servidorId' });
    };

    return Servidor;
};
