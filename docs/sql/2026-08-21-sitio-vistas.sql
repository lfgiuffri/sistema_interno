-- ============================================================================
--  Sistema Interno — Vistas por sitio + velocidad histórica · 21/08/2026
-- ============================================================================
--
--  Solo si actualizás la base a mano. Si desplegás el código y reiniciás el backend con
--  AUTO_MIGRATE distinto de "false", la migración 0007 hace todo esto solo.
--
--    mysqldump -u sistema -p sistema_interno > backup-antes-vistas.sql
--    mysql -u sistema -p sistema_interno < 2026-08-21-sitio-vistas.sql
--
--  ES RE-EJECUTABLE.
--
--  Qué cambia: un sitio pasa a tener N URLs chequeables (`/`, `/ecommerce`…), cada una con
--  su propio «esto lo administramos nosotros» y su propio estado. A cada sitio que ya existe
--  se le crea la vista «/» HEREDANDO su estado actual, así el chequeo sigue donde estaba y
--  no dispara una alerta falsa en el primer ciclo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `sitio_vistas` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sitioId` INT NOT NULL,
  `ruta` VARCHAR(190) NOT NULL DEFAULT '/',
  `nombre` VARCHAR(100) DEFAULT NULL,
  -- Le exigimos el marcador del footer (lo hicimos nosotros) o alcanza un 2xx (de terceros).
  `verificaMarcador` TINYINT(1) NOT NULL DEFAULT 1,
  -- NULL = usa el marcador global (config MANTENIMIENTO_MARCADOR_ID).
  `marcadorId` VARCHAR(100) DEFAULT NULL,
  `estado` ENUM('online','sin_marcador','offline','desconocido') NOT NULL DEFAULT 'desconocido',
  `ultimoChequeoAt` DATETIME DEFAULT NULL,
  `ultimoCodigo` INT DEFAULT NULL,
  `tiempoMs` INT DEFAULT NULL,
  `fallosSeguidos` INT NOT NULL DEFAULT 0,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `orden` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  `deletedAt` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `sitio_vistas_sitio` (`sitioId`),
  KEY `sitio_vistas_activo` (`activo`),
  KEY `sitio_vistas_estado` (`estado`),
  CONSTRAINT `sitio_vistas_sitio_fk` FOREIGN KEY (`sitioId`)
    REFERENCES `sitios_web` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Resumen diario PERMANENTE de velocidad y disponibilidad. El detalle (`sitio_chequeos`) se
-- purga a los 30 días; sin esta tabla, la velocidad de un mes o un año no tendría de dónde
-- salir. Sin deletedAt: es una bitácora agregada, no un dato de negocio que se dé de baja.
CREATE TABLE IF NOT EXISTS `sitio_velocidad_dia` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sitioId` INT NOT NULL,
  `vistaId` INT NOT NULL,
  `fecha` DATE NOT NULL,
  `muestras` INT NOT NULL DEFAULT 0,
  -- Promedio SOLO de los chequeos que respondieron: un timeout es una caída, no latencia.
  `promedioMs` INT DEFAULT NULL,
  `minMs` INT DEFAULT NULL,
  `maxMs` INT DEFAULT NULL,
  `disponibilidad` DECIMAL(5,2) DEFAULT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  -- Único: el rollup de un día se puede re-correr y actualiza la fila en vez de duplicarla.
  UNIQUE KEY `sitio_velocidad_dia_vista_fecha` (`vistaId`,`fecha`),
  KEY `sitio_velocidad_dia_sitio_fecha` (`sitioId`,`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Columnas nuevas. MySQL no tiene "ADD COLUMN IF NOT EXISTS" portable, así que se consulta
-- primero information_schema y se arma el ALTER solo si falta (esto hace el script
-- re-ejecutable sin tirar error).
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sitio_chequeos' AND COLUMN_NAME = 'vistaId') = 0,
  'ALTER TABLE `sitio_chequeos` ADD COLUMN `vistaId` INT NULL, ADD KEY `sitio_chequeos_vista` (`vistaId`,`createdAt`)',
  'SELECT "sitio_chequeos.vistaId ya existe"'));
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sitio_incidentes' AND COLUMN_NAME = 'vistaId') = 0,
  'ALTER TABLE `sitio_incidentes` ADD COLUMN `vistaId` INT NULL, ADD KEY `sitio_incidentes_vista` (`vistaId`,`tipo`,`resueltoAt`)',
  'SELECT "sitio_incidentes.vistaId ya existe"'));
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- A cada sitio sin vistas se le crea la «/» heredando su estado actual: el chequeo sigue
-- donde estaba (mismo estado, mismo contador de fallos) y no avisa una caída que no pasó.
INSERT INTO `sitio_vistas`
  (`sitioId`, `ruta`, `nombre`, `verificaMarcador`, `marcadorId`, `estado`, `ultimoChequeoAt`,
   `ultimoCodigo`, `tiempoMs`, `fallosSeguidos`, `activo`, `orden`, `createdAt`, `updatedAt`)
SELECT s.id, '/', NULL, s.verificaMarcador, NULL, s.estado, s.ultimoChequeoAt,
       s.ultimoCodigo, s.tiempoMs, s.fallosSeguidos, 1, 0, NOW(), NOW()
FROM `sitios_web` s
WHERE s.deletedAt IS NULL
  AND NOT EXISTS (SELECT 1 FROM `sitio_vistas` v WHERE v.sitioId = s.id AND v.deletedAt IS NULL);

-- Los chequeos e incidentes viejos son de cuando el sitio era una sola URL: se ligan a esa
-- vista «/». Sin esto, el historial y la velocidad de la home arrancarían vacíos.
UPDATE `sitio_chequeos` c
  JOIN `sitio_vistas` v ON v.sitioId = c.sitioId AND v.ruta = '/' AND v.deletedAt IS NULL
   SET c.vistaId = v.id
 WHERE c.vistaId IS NULL;

-- Solo los de disponibilidad (son de la ruta). Dominio y TLS NO: son del host.
UPDATE `sitio_incidentes` i
  JOIN `sitio_vistas` v ON v.sitioId = i.sitioId AND v.ruta = '/' AND v.deletedAt IS NULL
   SET i.vistaId = v.id
 WHERE i.vistaId IS NULL AND i.tipo IN ('offline','sin_marcador');

CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `name` VARCHAR(255) NOT NULL,
  `appliedAt` DATETIME NOT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `schema_migrations` (`name`, `appliedAt`) VALUES ('0007-sitio-vistas.js', NOW());

-- Verificación:
--   SELECT COUNT(*) FROM sitio_vistas;                    -- una por sitio, al menos
--   SELECT ruta, COUNT(*) FROM sitio_vistas GROUP BY ruta;
--   SELECT COUNT(*) FROM sitio_chequeos WHERE vistaId IS NULL;   -- 0 tras la migración
