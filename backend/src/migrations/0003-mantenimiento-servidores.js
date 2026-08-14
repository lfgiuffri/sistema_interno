/**
 * Migración: módulo `mantenimiento` — sección Servidores.
 *
 * Idempotente (el DDL en MariaDB hace COMMIT implícito): cada tabla se crea solo si falta.
 */

/**
 * Aplica la migración.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @returns {Promise<void>}
 */
export const up = async (sequelize) => {
    const q = sequelize.getQueryInterface();
    // showAllTables() devuelve OBJETOS ({ tableName, schema }) en MariaDB, no strings:
    // convertir con String() daría "[object Object]" y el guard nunca cortaría.
    const existentes = (await q.showAllTables()).map(t => String(t?.tableName ?? t).toLowerCase());
    const hay = (t) => existentes.includes(t);

    if (!hay('servidores')) {
        await sequelize.query(`CREATE TABLE servidores (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(120) NOT NULL,
            ip VARCHAR(45) NOT NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            monitorea TINYINT(1) NOT NULL DEFAULT 1,
            puertoChequeo INT NOT NULL DEFAULT 443,
            tokenHash VARCHAR(64) NULL,
            umbralCpu INT NULL,
            umbralRam INT NULL,
            umbralDisco INT NULL,
            ultimoContactoAt DATETIME NULL,
            estado ENUM('online','offline','desconocido') NOT NULL DEFAULT 'desconocido',
            so VARCHAR(120) NULL,
            observaciones TEXT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            deletedAt DATETIME NULL,
            INDEX servidores_activo (activo),
            INDEX servidores_estado (estado),
            INDEX servidores_token (tokenHash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }

    if (!hay('servidor_metricas')) {
        await sequelize.query(`CREATE TABLE servidor_metricas (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            servidorId INT NOT NULL,
            cpu DECIMAL(5,2) NOT NULL,
            ram DECIMAL(5,2) NOT NULL,
            disco DECIMAL(5,2) NOT NULL,
            discos JSON NULL,
            carga1 DECIMAL(6,2) NULL,
            uptimeSeg INT NULL,
            createdAt DATETIME NOT NULL,
            INDEX servidor_metricas_servidor_created (servidorId, createdAt),
            CONSTRAINT servidor_metricas_ibfk_1 FOREIGN KEY (servidorId) REFERENCES servidores (id) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }

    if (!hay('servidor_metricas_dia')) {
        await sequelize.query(`CREATE TABLE servidor_metricas_dia (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            servidorId INT NOT NULL,
            fecha DATE NOT NULL,
            cpuProm DECIMAL(5,2) NOT NULL,
            cpuMax DECIMAL(5,2) NOT NULL,
            ramProm DECIMAL(5,2) NOT NULL,
            ramMax DECIMAL(5,2) NOT NULL,
            discoProm DECIMAL(5,2) NOT NULL,
            discoMax DECIMAL(5,2) NOT NULL,
            muestras INT NOT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            UNIQUE KEY servidor_metricas_dia_servidor_fecha (servidorId, fecha),
            CONSTRAINT servidor_metricas_dia_ibfk_1 FOREIGN KEY (servidorId) REFERENCES servidores (id) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }

    if (!hay('servidor_incidentes')) {
        await sequelize.query(`CREATE TABLE servidor_incidentes (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            servidorId INT NOT NULL,
            tipo ENUM('offline','cpu','ram','disco') NOT NULL,
            valor DECIMAL(6,2) NULL,
            umbral INT NULL,
            detalle VARCHAR(255) NULL,
            resueltoAt DATETIME NULL,
            createdAt DATETIME NOT NULL,
            INDEX servidor_incidentes_abierto (servidorId, tipo, resueltoAt),
            INDEX servidor_incidentes_created (createdAt),
            CONSTRAINT servidor_incidentes_ibfk_1 FOREIGN KEY (servidorId) REFERENCES servidores (id) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }
};
