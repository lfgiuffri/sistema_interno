-- ============================================================================
--  Sistema Interno — Importación de SITIOS WEB de clientes (panel_clientes.csv)
--  62 sitios · 10 servidores · generado el 18/08/2026
-- ============================================================================
--
--  QUÉ HACE
--    1. Crea los 10 servidores que falten (por IP), como "solo chequeo externo"
--       (monitorea = 0): sin agente, se les prueba el puerto 443 cada 5 minutos.
--    2. Crea los 62 sitios que falten (por URL), ligados a su servidor y a su servicio.
--    3. Informa al final qué quedó cargado y qué se saltó.
--
--  ES RE-EJECUTABLE: todo va con NOT EXISTS. Correrlo dos veces no duplica ni pisa nada.
--  NO modifica ningún sitio ni servidor que ya exista.
--
--  CÓMO CORRERLO
--    mysqldump -u sistema -p sistema_interno > backup-antes-import-sitios.sql
--    mysql -u sistema -p sistema_interno < import-sitios-clientes.sql
--
--  REQUISITO: las tablas del módulo mantenimiento tienen que existir
--  (docs/sql/2026-08-14-mantenimiento.sql o arrancar el backend con AUTO_MIGRATE).
--
--  OMITIDO A PROPÓSITO: Novogar (Sistema a medida) — viene sin URL en el CSV.
-- ============================================================================

-- Los datos del CSV viven en una tabla temporal: existe solo durante esta sesión y
-- desaparece al terminar. Así el INSERT real es UNO solo, con JOINs, en vez de 62 statements.
--
-- ⚠️ COLACIONES. Comparar dos columnas de tablas distintas falla con «Illegal mix of
-- collations» si cada una declara una colación diferente, y eso es lo que pasa acá: en
-- MySQL 8 una tabla `utf8mb4` nace `utf8mb4_0900_ai_ci`, mientras que las tablas de la app
-- son `utf8mb4_general_ci`. Por eso cada comparación entre esta tabla y las reales lleva
-- `COLLATE utf8mb4_bin` en LOS DOS lados: fija la comparación sin depender de cómo quedó
-- declarada cada columna, y funciona igual en MySQL y en MariaDB. Es comparación exacta
-- (distingue mayúsculas y acentos), que es justo lo que queremos para casar por nombre e IP.
CREATE TEMPORARY TABLE _imp_sitios (
  nombre     VARCHAR(150) NOT NULL,
  url        VARCHAR(255) NOT NULL,
  dominio    VARCHAR(190) NOT NULL,
  servicio   VARCHAR(100) NOT NULL,   -- nombre del servicio: se resuelve a id más abajo
  ip         VARCHAR(45)  NOT NULL,   -- IP del servidor: se resuelve a id más abajo
  verifica   TINYINT(1)   NOT NULL    -- 1 = tiene el marcador #app-conn-id (verificado en vivo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO _imp_sitios (nombre, url, dominio, servicio, ip, verifica) VALUES
  ('Amayra', 'https://www.amayra.com.ar/', 'amayra.com.ar', 'E-commerce', '52.22.1.124', 1),
  ('LSyD Store', 'https://www.lsydstore.com.ar/', 'lsydstore.com.ar', 'E-commerce', '52.22.1.124', 1),
  ('Berkana', 'https://www.berkanaoficial.com/', 'berkanaoficial.com', 'E-commerce', '52.22.1.124', 1),
  ('BH', 'https://www.bhcomplementos.com.ar/', 'bhcomplementos.com.ar', 'E-commerce', '181.117.240.123', 1),
  ('Tio - Tom', 'https://www.tio-tom.com.ar/', 'tio-tom.com.ar', 'E-commerce', '200.123.159.178', 0),
  ('CSL', 'https://www.ciasurlatina.com.ar/', 'ciasurlatina.com.ar', 'E-commerce', '200.123.159.178', 0),
  ('Tomy Empresas', 'https://empresas.tomy.com.ar/', 'empresas.tomy.com.ar', 'E-commerce', '200.123.159.178', 0),
  ('Laury', 'https://www.laurydigital.com.ar/', 'laurydigital.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Melocoton', 'https://mayorista.melocoton.com.ar/', 'mayorista.melocoton.com.ar', 'E-commerce', '200.123.135.58', 1),
  ('Dique', 'https://www.diquesrl.com.ar/', 'diquesrl.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Orlandi', 'https://www.orlandisa.com/', 'orlandisa.com', 'E-commerce', '181.117.240.123', 1),
  ('Orlandi', 'https://mayoristas.orlandisa.com/', 'mayoristas.orlandisa.com', 'E-commerce', '181.117.240.123', 0),
  ('Orlandi', 'https://tms.orlandisa.com/', 'tms.orlandisa.com', 'TMS', '186.122.179.57', 0),
  ('Acto Medico', 'https://www.actomedico.com.ar/', 'actomedico.com.ar', 'Sitio web', '181.117.240.123', 1),
  ('Pro-max', 'https://www.pro-max.com.ar/', 'pro-max.com.ar', 'E-commerce', '181.117.240.123', 1),
  ('Bodega Araujo', 'https://www.bodegaaraujo.com.ar/', 'bodegaaraujo.com.ar', 'E-commerce', '181.117.240.123', 0),
  ('Red Unitas', 'https://www.redunitas.com.ar/', 'redunitas.com.ar', 'Sitio web', '181.117.240.123', 1),
  ('Olivetto', 'https://www.drolivetto.com/', 'drolivetto.com', 'Sitio web', '181.117.240.123', 1),
  ('Schneider', 'https://www.schneidersa.com.ar/', 'schneidersa.com.ar', 'E-commerce', '181.117.240.123', 1),
  ('Chapas Oroño', 'https://tienda.chapasoro.com.ar/', 'tienda.chapasoro.com.ar', 'E-commerce', '181.117.240.123', 1),
  ('Libreria centro', 'https://www.centroperez.com.ar/', 'centroperez.com.ar', 'E-commerce', '138.99.7.233', 0),
  ('Ana Bolena', 'https://www.anabolenamuebles.com.ar/', 'anabolenamuebles.com.ar', 'E-commerce', '181.117.240.123', 1),
  ('Medi-Natural', 'https://www.medinatural.com.ar/', 'medinatural.com.ar', 'E-commerce', '181.117.240.123', 1),
  ('Linea GE', 'https://www.lineage.com.ar/', 'lineage.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Prack', 'https://www.prackembalajes.com/', 'prackembalajes.com', 'E-commerce', '181.117.240.123', 1),
  ('Total Pack', 'https://www.totalpackrosario.com.ar/', 'totalpackrosario.com.ar', 'E-commerce', '181.117.240.123', 1),
  ('Koll', 'https://www.koll.com.ar/', 'koll.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('La cortineria', 'https://www.vivedeco.com/', 'vivedeco.com', 'E-commerce', '181.117.240.123', 1),
  ('Lomas del Sol', 'https://www.ldsnutricionanimal.com.ar/', 'ldsnutricionanimal.com.ar', 'Sitio web', '181.117.240.123', 1),
  ('Service Itaila', 'https://www.serviceitalia.com.ar/', 'serviceitalia.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Carello', 'https://www.carloscarello.com.ar/', 'carloscarello.com.ar', 'E-commerce', '181.117.240.123', 1),
  ('Plastimac', 'https://www.plastimac.com.ar/', 'plastimac.com.ar', 'E-commerce', '181.117.240.123', 1),
  ('Papelera Suipacha', 'https://www.papelerasuipacha.com.ar/', 'papelerasuipacha.com.ar', 'E-commerce', '181.117.240.182', 0),
  ('Crazy Shop', 'https://www.crazyshop.com.ar/', 'crazyshop.com.ar', 'E-commerce', '181.117.240.182', 0),
  ('Luparini repuestos', 'https://www.luparinirepuestos.com.ar/', 'luparinirepuestos.com.ar', 'E-commerce', '186.189.235.219', 0),
  ('Mega Aberturas', 'https://www.megaaberturas.com.ar/', 'megaaberturas.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Vision Stick', 'https://www.vision-sticks.com/', 'vision-sticks.com', 'E-commerce', '181.117.240.123', 1),
  ('Prem', 'https://www.premestudio.com.ar/', 'premestudio.com.ar', 'E-commerce', '181.117.240.123', 0),
  ('Pinomar', 'https://www.pinomar.com.ar/', 'pinomar.com.ar', 'E-commerce', '181.117.240.123', 1),
  ('Proyecting', 'https://www.proyecting.com/', 'proyecting.com', 'Sitio web', '181.117.240.123', 1),
  ('Plataforma deportiva', 'https://www.plataformadeportiva.com.ar/', 'plataformadeportiva.com.ar', 'E-commerce', '181.117.240.123', 1),
  ('Four-Plast', 'https://www.fourplast.com.ar/', 'fourplast.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('MegaShop', 'https://www.megashopok.com.ar/', 'megashopok.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('PLD', 'https://frontpld.positivemedia.com.ar/', 'frontpld.positivemedia.com.ar', 'Desarrollo a medida', '186.122.179.57', 0),
  ('Smile Pack', 'https://www.smilepack.com.ar/', 'smilepack.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Dist. Uriburu', 'https://www.duriburu.com.ar/', 'duriburu.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Doccia', 'https://www.doccia.com.ar/', 'doccia.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Klorito', 'https://www.klorito.com.ar/', 'klorito.com.ar', 'E-commerce', '181.117.240.123', 0),
  ('Repuestos Segui', 'https://www.repuestosegui.com.ar/', 'repuestosegui.com.ar', 'E-commerce', '181.117.240.123', 0),
  ('Andrekevin', 'https://www.andrekevin.com.ar/', 'andrekevin.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Nueva Regina', 'https://www.nuevaregina.com.ar/', 'nuevaregina.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Luvic', 'https://bazarluvic.com.ar/', 'bazarluvic.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Decormagic', 'https://www.decormagic.com.ar/', 'decormagic.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('All Paper', 'https://www.allpaper.com.ar/', 'allpaper.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Luco', 'https://www.luco.com.ar/', 'luco.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Olimpico', 'https://www.olimpicosrl.com.ar/', 'olimpicosrl.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Garcia Hermanos', 'https://www.garcia-hnossrl.com.ar/', 'garcia-hnossrl.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Kaktus', 'https://www.kaktus.com.ar/', 'kaktus.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Unicross', 'https://www.unicross.com.ar/', 'unicross.com.ar', 'E-commerce', '52.22.1.124', 1),
  ('Influencer', 'https://influencerstore.com.ar/', 'influencerstore.com.ar', 'E-commerce', '52.22.1.124', 1),
  ('Sun Sun Market', 'https://www.sunsunmarket.com.ar/', 'sunsunmarket.com.ar', 'E-commerce', '138.99.6.207', 1),
  ('Lesedife', 'https://www.lesedife.com/', 'lesedife.com', 'E-commerce', '104.26.10.151', 1);

-- ----------------------------------------------------------------------------
-- 0. Control previo: ¿todos los servicios del CSV existen en el catálogo?
--    Si alguna fila sale acá, ese sitio quedaría SIN servicio (no rompe nada, pero
--    conviene crear el servicio antes de seguir).
-- ----------------------------------------------------------------------------
SELECT DISTINCT i.servicio AS 'SERVICIO QUE NO EXISTE EN EL CATALOGO'
  FROM _imp_sitios i
  LEFT JOIN servicios s ON s.nombre COLLATE utf8mb4_bin = i.servicio COLLATE utf8mb4_bin
                        AND s.deletedAt IS NULL
 WHERE s.id IS NULL;

-- ----------------------------------------------------------------------------
-- 1. SERVIDORES (los que falten, por IP)
--    monitorea = 0 → sin agente, solo se prueba que el puerto 443 responda.
--    tokenHash queda NULL: un servidor sin agente no necesita token.
-- ----------------------------------------------------------------------------
INSERT INTO servidores (nombre, ip, activo, monitorea, puertoChequeo, estado, createdAt, updatedAt)
SELECT 'Lesedife AWS', '52.22.1.124', 1, 0, 443, 'desconocido', NOW(), NOW()
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM servidores WHERE ip = '52.22.1.124' AND deletedAt IS NULL);
INSERT INTO servidores (nombre, ip, activo, monitorea, puertoChequeo, estado, createdAt, updatedAt)
SELECT 'Claro 1', '181.117.240.123', 1, 0, 443, 'desconocido', NOW(), NOW()
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM servidores WHERE ip = '181.117.240.123' AND deletedAt IS NULL);
INSERT INTO servidores (nombre, ip, activo, monitorea, puertoChequeo, estado, createdAt, updatedAt)
SELECT 'Tio - Tom', '200.123.159.178', 1, 0, 443, 'desconocido', NOW(), NOW()
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM servidores WHERE ip = '200.123.159.178' AND deletedAt IS NULL);
INSERT INTO servidores (nombre, ip, activo, monitorea, puertoChequeo, estado, createdAt, updatedAt)
SELECT 'Claro 3', '138.99.6.207', 1, 0, 443, 'desconocido', NOW(), NOW()
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM servidores WHERE ip = '138.99.6.207' AND deletedAt IS NULL);
INSERT INTO servidores (nombre, ip, activo, monitorea, puertoChequeo, estado, createdAt, updatedAt)
SELECT 'Melocoton', '200.123.135.58', 1, 0, 443, 'desconocido', NOW(), NOW()
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM servidores WHERE ip = '200.123.135.58' AND deletedAt IS NULL);
INSERT INTO servidores (nombre, ip, activo, monitorea, puertoChequeo, estado, createdAt, updatedAt)
SELECT 'Claro 2', '186.122.179.57', 1, 0, 443, 'desconocido', NOW(), NOW()
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM servidores WHERE ip = '186.122.179.57' AND deletedAt IS NULL);
INSERT INTO servidores (nombre, ip, activo, monitorea, puertoChequeo, estado, createdAt, updatedAt)
SELECT 'Librería Centro', '138.99.7.233', 1, 0, 443, 'desconocido', NOW(), NOW()
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM servidores WHERE ip = '138.99.7.233' AND deletedAt IS NULL);
INSERT INTO servidores (nombre, ip, activo, monitorea, puertoChequeo, estado, createdAt, updatedAt)
SELECT 'Suipacha', '181.117.240.182', 1, 0, 443, 'desconocido', NOW(), NOW()
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM servidores WHERE ip = '181.117.240.182' AND deletedAt IS NULL);
INSERT INTO servidores (nombre, ip, activo, monitorea, puertoChequeo, estado, createdAt, updatedAt)
SELECT 'Luparini', '186.189.235.219', 1, 0, 443, 'desconocido', NOW(), NOW()
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM servidores WHERE ip = '186.189.235.219' AND deletedAt IS NULL);
INSERT INTO servidores (nombre, ip, activo, monitorea, puertoChequeo, estado, createdAt, updatedAt)
SELECT 'Lesedife Interno', '104.26.10.151', 1, 0, 443, 'desconocido', NOW(), NOW()
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM servidores WHERE ip = '104.26.10.151' AND deletedAt IS NULL);

-- ----------------------------------------------------------------------------
-- 2. SITIOS WEB (los que falten, por URL)
--    · estado 'desconocido' y sin fechas: los completa el primer ciclo del monitoreo
--      (disponibilidad + TLS a los 5 minutos, vencimiento de dominio por RDAP en el día).
--    · dominioAuto = 0 porque la fecha todavía no se consultó; el refresco diario la carga.
--    · verificaMarcador sale del chequeo real de cada sitio (ver el listado del final).
-- ----------------------------------------------------------------------------
INSERT INTO sitios_web
  (nombre, url, servicioId, servidorId, activo, verificaMarcador, estado,
   fallosSeguidos, dominio, dominioAuto, createdAt, updatedAt)
SELECT
  i.nombre, i.url,
  (SELECT s.id FROM servicios  s
    WHERE s.nombre COLLATE utf8mb4_bin = i.servicio COLLATE utf8mb4_bin
      AND s.deletedAt IS NULL LIMIT 1),
  (SELECT v.id FROM servidores v
    WHERE v.ip     COLLATE utf8mb4_bin = i.ip       COLLATE utf8mb4_bin
      AND v.deletedAt IS NULL LIMIT 1),
  1, i.verifica, 'desconocido',
  0, i.dominio, 0, NOW(), NOW()
  FROM _imp_sitios i
 WHERE NOT EXISTS (
   SELECT 1 FROM sitios_web w
    WHERE w.url COLLATE utf8mb4_bin = i.url COLLATE utf8mb4_bin
      AND w.deletedAt IS NULL);

-- ----------------------------------------------------------------------------
-- 3. Resultado
-- ----------------------------------------------------------------------------
SELECT COUNT(*) AS 'servidores en total' FROM servidores WHERE deletedAt IS NULL;
SELECT COUNT(*) AS 'sitios en total'     FROM sitios_web WHERE deletedAt IS NULL;

SELECT v.nombre AS servidor, v.ip, COUNT(w.id) AS sitios
  FROM servidores v LEFT JOIN sitios_web w ON w.servidorId = v.id AND w.deletedAt IS NULL
 WHERE v.deletedAt IS NULL GROUP BY v.id ORDER BY sitios DESC;

-- Sitios que quedaron SIN exigir el marcador: son los que hay que corregir en el footer.
-- A medida que le agregues <div id="app-conn-id"></div> a cada uno, tildá
-- «Es un sitio nuestro» en su ficha y el monitoreo pasa a verificarlo de verdad.
SELECT w.nombre, w.url
  FROM sitios_web w
 WHERE w.deletedAt IS NULL AND w.verificaMarcador = 0
 ORDER BY w.nombre;

-- Sitios que quedaron sin servicio asignado (si el catálogo no tenía el nombre).
SELECT w.nombre, w.url FROM sitios_web w
 WHERE w.deletedAt IS NULL AND w.servicioId IS NULL ORDER BY w.nombre;

-- ----------------------------------------------------------------------------
-- 4. DESPUÉS DE IMPORTAR — dos casos que ya sabemos que van a dar ruido
-- ----------------------------------------------------------------------------
--
--  a) Prem y Klorito responden 403 a cualquier cliente que no sea un navegador con
--     sesión (los probé con curl y con un Chrome real: los dos dan 403). Para el
--     monitoreo eso es «caído», así que a los 10 minutos van a abrir un incidente y
--     avisar. Primero comprobá desde el servidor de producción:
--
--       curl -s -o /dev/null -w '%{http_code}\n' https://www.premestudio.com.ar/
--       curl -s -o /dev/null -w '%{http_code}\n' https://www.klorito.com.ar/
--
--     Si desde ahí dan 200, no hay nada que hacer: era el bloqueo a mi IP.
--     Si también dan 403, desactivalos hasta resolver el WAF (o hacelo desde la
--     pantalla de Sitios web, con el botón de encendido):
--
--       UPDATE sitios_web SET activo = 0
--        WHERE url IN ('https://www.premestudio.com.ar/', 'https://www.klorito.com.ar/');
--
--  b) Los 14 sitios con verificaMarcador = 0 (los lista la consulta de arriba) pasan
--     el chequeo con solo responder 2xx. Cuando le agregues el marcador al footer de
--     uno, activale la verificación real:
--
--       UPDATE sitios_web SET verificaMarcador = 1 WHERE url = 'https://…';
--
--     El marcador es literalmente: <div id="app-conn-id"></div>
--
--  c) Lo que el monitoreo va a completar solo, sin que toques nada:
--     · estado y tiempo de respuesta → primer ciclo, dentro de 5 minutos
--     · vencimiento del certificado  → mismo ciclo (sale del handshake TLS)
--     · vencimiento del dominio      → refresco diario por RDAP
--
--     Lo probé sobre los 62: los 62 dominios y los 62 certificados se resolvieron, y
--     el ciclo completo tardó 45 s (holgado para un intervalo de 5 minutos).
--
--     Ojo con el primer día: hay dos dominios cerca de vencer que van a avisar en
--     cuanto corra el refresco. No es un falso positivo, es el sistema haciendo su
--     trabajo — pero conviene saberlo de antemano:
--       · duriburu.com.ar     vence el 31/08/2026
--       · bodegaaraujo.com.ar vence el 14/09/2026
-- ============================================================================
