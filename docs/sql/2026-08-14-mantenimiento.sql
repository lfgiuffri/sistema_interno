-- ============================================================================
--  Sistema Interno — Módulo MANTENIMIENTO (Servidores + Sitios web)
--  Migraciones 0003 y 0004 · 14/08/2026
-- ============================================================================
--
--  CUÁNDO CORRERLO
--  Solo si querés actualizar la base a mano. Si desplegás el código y arrancás
--  el backend con AUTO_MIGRATE distinto de "false", el runner aplica estas
--  mismas migraciones solo y este archivo no hace falta.
--
--  CÓMO CORRERLO
--    mysqldump -u sistema -p sistema_interno > backup-antes-mantenimiento.sql
--    mysql -u sistema -p sistema_interno < 2026-08-14-mantenimiento.sql
--
--  ES RE-EJECUTABLE: todo va con IF NOT EXISTS / INSERT IGNORE. Correrlo dos
--  veces no rompe nada ni pisa datos.
--
--  QUÉ NO HACE: no toca datos existentes ni reparte permisos a los roles
--  (ver la sección 3 al final).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SERVIDORES (migración 0003)
-- ----------------------------------------------------------------------------

-- Inventario de VPS. `tokenHash` guarda el sha256 del token del agente: el token
-- en claro no se persiste nunca (se muestra una sola vez al generarlo).
CREATE TABLE IF NOT EXISTS `servidores` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(120) NOT NULL,
  `ip` VARCHAR(45) NOT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `monitorea` TINYINT(1) NOT NULL DEFAULT 1,
  `puertoChequeo` INT NOT NULL DEFAULT 443,
  `tokenHash` VARCHAR(64) DEFAULT NULL,
  `umbralCpu` INT DEFAULT NULL,
  `umbralRam` INT DEFAULT NULL,
  `umbralDisco` INT DEFAULT NULL,
  `ultimoContactoAt` DATETIME DEFAULT NULL,
  `estado` ENUM('online','offline','desconocido') NOT NULL DEFAULT 'desconocido',
  `so` VARCHAR(120) DEFAULT NULL,
  `observaciones` TEXT DEFAULT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  `deletedAt` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `servidores_activo` (`activo`),
  KEY `servidores_estado` (`estado`),
  KEY `servidores_token` (`tokenHash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Detalle fino: una fila por minuto y por servidor. El scheduler lo purga a los 30 días.
CREATE TABLE IF NOT EXISTS `servidor_metricas` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `servidorId` INT NOT NULL,
  `cpu` DECIMAL(5,2) NOT NULL,
  `ram` DECIMAL(5,2) NOT NULL,
  `disco` DECIMAL(5,2) NOT NULL,
  `discos` JSON DEFAULT NULL,
  `carga1` DECIMAL(6,2) DEFAULT NULL,
  `uptimeSeg` INT DEFAULT NULL,
  `createdAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `servidor_metricas_servidor_created` (`servidorId`,`createdAt`),
  CONSTRAINT `servidor_metricas_ibfk_1` FOREIGN KEY (`servidorId`)
    REFERENCES `servidores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Resumen diario permanente (promedio y máximo): sobrevive a la purga del detalle.
CREATE TABLE IF NOT EXISTS `servidor_metricas_dia` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `servidorId` INT NOT NULL,
  `fecha` DATE NOT NULL,
  `cpuProm` DECIMAL(5,2) NOT NULL,
  `cpuMax` DECIMAL(5,2) NOT NULL,
  `ramProm` DECIMAL(5,2) NOT NULL,
  `ramMax` DECIMAL(5,2) NOT NULL,
  `discoProm` DECIMAL(5,2) NOT NULL,
  `discoMax` DECIMAL(5,2) NOT NULL,
  `muestras` INT NOT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `servidor_metricas_dia_servidor_fecha` (`servidorId`,`fecha`),
  CONSTRAINT `servidor_metricas_dia_ibfk_1` FOREIGN KEY (`servidorId`)
    REFERENCES `servidores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Bitácora de incidentes. El anti-spam se apoya en el índice (servidorId, tipo, resueltoAt):
-- mientras haya uno abierto de ese tipo, no se vuelve a avisar.
CREATE TABLE IF NOT EXISTS `servidor_incidentes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `servidorId` INT NOT NULL,
  `tipo` ENUM('offline','cpu','ram','disco') NOT NULL,
  `valor` DECIMAL(6,2) DEFAULT NULL,
  `umbral` INT DEFAULT NULL,
  `detalle` VARCHAR(255) DEFAULT NULL,
  `resueltoAt` DATETIME DEFAULT NULL,
  `createdAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `servidor_incidentes_abierto` (`servidorId`,`tipo`,`resueltoAt`),
  KEY `servidor_incidentes_created` (`createdAt`),
  CONSTRAINT `servidor_incidentes_ibfk_1` FOREIGN KEY (`servidorId`)
    REFERENCES `servidores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------------------
-- 2. SITIOS WEB (migración 0004)
-- ----------------------------------------------------------------------------

-- `verificaMarcador` = 1 exige el <div id="app-conn-id"> del footer para dar el sitio
-- por sano; 0 (sitios de terceros) se conforma con un 2xx.
-- `dominioAuto` = 1 significa "la fecha la trae RDAP"; una fecha cargada a mano lo
-- pone en 0 para que el refresco diario no la pise.
-- Las dos FK van con ON DELETE SET NULL: si se borra el servicio o el servidor,
-- el sitio se sigue monitoreando (la relación es informativa).
CREATE TABLE IF NOT EXISTS `sitios_web` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(150) NOT NULL,
  `url` VARCHAR(255) NOT NULL,
  `servicioId` INT DEFAULT NULL,
  `servidorId` INT DEFAULT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `verificaMarcador` TINYINT(1) NOT NULL DEFAULT 1,
  `estado` ENUM('online','sin_marcador','offline','desconocido') NOT NULL DEFAULT 'desconocido',
  `ultimoChequeoAt` DATETIME DEFAULT NULL,
  `ultimoCodigo` INT DEFAULT NULL,
  `tiempoMs` INT DEFAULT NULL,
  `fallosSeguidos` INT NOT NULL DEFAULT 0,
  `dominio` VARCHAR(190) DEFAULT NULL,
  `dominioVenceAt` DATE DEFAULT NULL,
  `dominioAuto` TINYINT(1) NOT NULL DEFAULT 0,
  `dominioConsultadoAt` DATETIME DEFAULT NULL,
  `tlsVenceAt` DATE DEFAULT NULL,
  `observacion` TEXT DEFAULT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  `deletedAt` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `sitios_web_activo` (`activo`),
  KEY `sitios_web_estado` (`estado`),
  KEY `sitios_web_servidor` (`servidorId`),
  CONSTRAINT `sitios_web_ibfk_1` FOREIGN KEY (`servidorId`)
    REFERENCES `servidores` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `sitios_web_ibfk_2` FOREIGN KEY (`servicioId`)
    REFERENCES `servicios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Un registro por chequeo (cada 5 minutos). Se purga a los 30 días.
CREATE TABLE IF NOT EXISTS `sitio_chequeos` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `sitioId` INT NOT NULL,
  `estado` ENUM('online','sin_marcador','offline') NOT NULL,
  `httpStatus` INT DEFAULT NULL,
  `tiempoMs` INT DEFAULT NULL,
  `motivo` VARCHAR(200) DEFAULT NULL,
  `createdAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `sitio_chequeos_sitio_created` (`sitioId`,`createdAt`),
  KEY `sitio_chequeos_created` (`createdAt`),
  CONSTRAINT `sitio_chequeos_ibfk_1` FOREIGN KEY (`sitioId`)
    REFERENCES `sitios_web` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `sitio_incidentes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sitioId` INT NOT NULL,
  `tipo` ENUM('offline','sin_marcador','dominio','tls') NOT NULL,
  `detalle` VARCHAR(255) DEFAULT NULL,
  `resueltoAt` DATETIME DEFAULT NULL,
  `createdAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `sitio_incidentes_abierto` (`sitioId`,`tipo`,`resueltoAt`),
  KEY `sitio_incidentes_created` (`createdAt`),
  CONSTRAINT `sitio_incidentes_ibfk_1` FOREIGN KEY (`sitioId`)
    REFERENCES `sitios_web` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------------------
-- 3. REGISTRO DE MIGRACIONES
-- ----------------------------------------------------------------------------
-- Se marcan como aplicadas para que el runner del backend no las vuelva a
-- intentar al arrancar. Sin esto no pasaría nada grave (las migraciones cortan
-- si la tabla ya existe), pero el log quedaría más limpio.

CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `name` VARCHAR(255) NOT NULL,
  `appliedAt` DATETIME NOT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `schema_migrations` (`name`, `appliedAt`) VALUES
  ('0003-mantenimiento-servidores.js', NOW()),
  ('0004-mantenimiento-sitios.js', NOW());

-- ----------------------------------------------------------------------------
-- 4. DESPUÉS DE CORRER ESTO
-- ----------------------------------------------------------------------------
--
--  a) PERMISOS. El rol Administrador ya entra: tiene el comodín `*`. A los demás
--     roles hay que darles las capabilities nuevas desde la app
--     (Administración → Roles): `servidores:*` y `sitios:*`.
--
--     Ojo: `servidores:read` y `sitios:read` no solo dan acceso a la pantalla —
--     definen QUIÉN RECIBE LAS ALERTAS de cada sección. Dáselas a quien tenga
--     que enterarse de una caída, no a todo el mundo.
--
--     Si preferís hacerlo por SQL, reemplazá <ID_DEL_ROL>:
--
--     INSERT IGNORE INTO role_capabilities (roleId, capability, createdAt, updatedAt)
--     SELECT <ID_DEL_ROL>, c.cap, NOW(), NOW() FROM (
--       SELECT 'servidores:read' AS cap UNION ALL SELECT 'servidores:create'
--       UNION ALL SELECT 'servidores:update' UNION ALL SELECT 'servidores:toggle'
--       UNION ALL SELECT 'servidores:delete'
--       UNION ALL SELECT 'sitios:read'   UNION ALL SELECT 'sitios:create'
--       UNION ALL SELECT 'sitios:update' UNION ALL SELECT 'sitios:toggle'
--       UNION ALL SELECT 'sitios:delete'
--     ) c;
--
--  b) CONFIGURACIÓN. Los umbrales y las ventanas de aviso NO necesitan filas:
--     tienen defaults en el código y se guardan recién cuando alguien los cambia
--     desde Configuración → Negocio. Los valores por defecto son:
--       MANTENIMIENTO_UMBRAL_CPU          90   (%)
--       MANTENIMIENTO_UMBRAL_RAM          90   (%)
--       MANTENIMIENTO_UMBRAL_DISCO        85   (%)
--       MANTENIMIENTO_MINUTOS_SIN_REPORTE  5   (minutos de silencio del agente)
--       MANTENIMIENTO_FALLOS_PARA_ALERTA   2   (chequeos fallidos seguidos de un sitio)
--       MANTENIMIENTO_DIAS_AVISO_DOMINIO  30   (días)
--       MANTENIMIENTO_DIAS_AVISO_TLS      15   (días)
--
--  c) REINICIAR EL BACKEND: `sudo systemctl restart sistema-interno`. Recién ahí
--     arrancan los dos handlers del scheduler (servidores y sitios).
--
--  d) VERIFICAR:
--     SELECT table_name FROM information_schema.tables
--      WHERE table_schema = DATABASE()
--        AND table_name IN ('servidores','servidor_metricas','servidor_metricas_dia',
--                           'servidor_incidentes','sitios_web','sitio_chequeos',
--                           'sitio_incidentes');
--     -- tienen que aparecer las 7.
--
--     Y desde afuera: curl https://sys.positivemedia.com.ar/api/health  →  {"ok":true,...}
-- ============================================================================
