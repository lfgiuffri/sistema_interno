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
 *
 * Los `alerta*` dicen QUÉ avisa cada servidor. Es distinto del umbral: el umbral corre la
 * línea, esto apaga el aviso del todo. Sirve para el servidor de pruebas que se apaga los
 * fines de semana, o para el que vive con el disco al 95% a propósito. Apagar una alerta NO
 * apaga el monitoreo: la métrica se sigue guardando y el estado se sigue actualizando (el
 * servidor se ve offline en la pantalla), lo único que no pasa es que se abra el incidente y
 * se le escriba a nadie.
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
        // Qué alertas crea este servidor. Todas prendidas por defecto: apagar es la excepción.
        alertaOffline: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        alertaCpu: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        alertaRam: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        alertaDisco: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        // Última señal de vida (reporte del agente o chequeo TCP exitoso).
        ultimoContactoAt: { type: DataTypes.DATE, allowNull: true },
        estado: { type: DataTypes.ENUM('online', 'offline', 'desconocido'), allowNull: false, defaultValue: 'desconocido' },
        so: { type: DataTypes.STRING(120), allowNull: true },
        observaciones: { type: DataTypes.TEXT, allowNull: true },

        // ── FullGlass: actualización de bases y deploy ────────────────────────────────────
        // No todos los servidores alojan FullGlass. Este flag es el que habilita las dos
        // funciones nuevas: sin él, el servidor no muestra ni acepta nada de esto, y la API
        // rechaza los trabajos. Es el primer filtro contra mandarle un deploy al VPS equivocado.
        tieneFullglass: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        /**
         * Carpeta que el agente recorre buscando sitios (una subcarpeta por cliente, cada una
         * con `configs/config_site.php`). Configurable por servidor porque no todos tienen el
         * mismo layout; el default es el del script PHP que esto reemplaza.
         */
        rutaSitios: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '/home' },
        // Los comandos corren COMO ROOT en el VPS. Quien los edita puede hacer cualquier cosa
        // ahí adentro: por eso editarlos pide `servidores:deploy-config`, que es una capability
        // distinta de la que habilita apretar el botón.
        comandoDeployProd: { type: DataTypes.TEXT, allowNull: true },
        comandoDeployDev: { type: DataTypes.TEXT, allowNull: true },
        /**
         * Última vez que el agente reportó su inventario de sitios. Distingue «el worker nunca
         * habló» (null) de «recorrió y no encontró nada» (con fecha y la tabla vacía), que se
         * ven igual y mandan a buscar el problema a lugares opuestos.
         */
        sitiosReportadosAt: { type: DataTypes.DATE, allowNull: true }
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
