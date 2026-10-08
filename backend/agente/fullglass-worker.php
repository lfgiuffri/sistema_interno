<?php
/**
 * Worker de FullGlass del Sistema Interno.
 *
 * Le pregunta a la app si este servidor tiene trabajo (SQL masivo sobre las bases de los
 * clientes, o un deploy) y lo ejecuta ACÁ. La app nunca se conecta al servidor: solo hay
 * peticiones HTTPS salientes, igual que el agente de métricas.
 *
 * Está en PHP y no en bash a propósito: estos servidores tienen PHP por definición (es lo que
 * corre FullGlass), así que puede LEER `config_site.php` con un include —exactamente como el
 * script que esto reemplaza— y hablar con MySQL por mysqli. Hacerlo desde bash obligaría a
 * parsear PHP y JSON a mano, que es justo donde estas cosas se rompen.
 *
 * ⚠️ Las credenciales de los clientes NO salen de este servidor. Se leen, se usan para
 * conectar, y a la app solo se le reporta el nombre del sitio, el de la base y el resultado.
 *
 * Config: /etc/sistema-interno-agente.env (API_URL y AGENT_TOKEN), la misma del agente.
 *
 * ⚠️ Escrito para PHP 7.0+ A PROPÓSITO, y por eso parece anticuado: sin arrow functions
 * (`fn()`, 7.4), sin `str_contains()` (8.0) y sin tipos en las firmas. Los VPS de clientes
 * corren la versión de PHP que necesita cada FullGlass, no la última, y un `Call to undefined
 * function` acá no se ve en ningún lado: el worker muere, nadie reporta, y la app se queda
 * diciendo «el agente no reportó sus sitios» para siempre. Antes de usar una función nueva,
 * verificá contra qué versión corre el servidor más viejo.
 */

const TIMEOUT_HTTP = 30;
const TIMEOUT_DEPLOY = 1800;     // 30 min: un deploy puede tardar
const MAX_SALIDA = 256 * 1024;

/**
 * Lee la configuración del agente (formato `CLAVE=valor`, como la del agente de métricas).
 * @param string $ruta Archivo de configuración.
 * @return array<string,string> Claves leídas.
 */
function leerConfig($ruta)
{
    $out = [];
    foreach (@file($ruta, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $linea) {
        if ($linea === '' || $linea[0] === '#' || strpos($linea, '=') === false) continue;
        list($k, $v) = explode('=', $linea, 2);
        $out[trim($k)] = trim($v);
    }
    return $out;
}

$cfg = leerConfig(getenv('AGENTE_CONFIG') ?: '/etc/sistema-interno-agente.env');
$apiUrl = rtrim($cfg['API_URL'] ?? '', '/');
$token  = $cfg['AGENT_TOKEN'] ?? '';
if ($apiUrl === '' || $token === '') {
    fwrite(STDERR, "Falta API_URL o AGENT_TOKEN en la configuración\n");
    exit(1);
}

/**
 * Llama a la API del Sistema Interno con el token del agente.
 * @param string $metodo GET o POST.
 * @param string $ruta Ruta relativa (ej. `agente/trabajos`).
 * @param array|null $cuerpo Payload JSON, o null.
 * @return array{code:int,data:mixed} Código HTTP y `data` del envelope.
 */
function api($metodo, $ruta, $cuerpo = null)
{
    global $apiUrl, $token;
    $ch = curl_init("$apiUrl/$ruta");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => TIMEOUT_HTTP,
        CURLOPT_CUSTOMREQUEST => $metodo,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', "x-agent-token: $token"],
    ]);
    if ($cuerpo !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($cuerpo));
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $json = json_decode((string) $raw, true);
    return ['code' => $code, 'data' => $json['data'] ?? null];
}

/**
 * Recorre la ruta configurada y arma el inventario de sitios con su base.
 *
 * El `include` corre en una función para que las variables del config del cliente no pisen
 * nada del worker. Solo se queda con lo necesario para conectar; nada de eso se reporta.
 * @param string $rutaBase Carpeta a recorrer (una subcarpeta por cliente).
 * @return array<int,array<string,mixed>> Sitios con `ruta`, `cfg` y, si falló, `problema`.
 */
function descubrirSitios($rutaBase, $claveRama = 'branch')
{
    $sitios = [];
    foreach (glob(rtrim($rutaBase, '/') . '/*', GLOB_ONLYDIR) ?: [] as $dir) {
        $archivo = "$dir/configs/config_site.php";
        if (!is_readable($archivo)) {
            $sitios[] = ['ruta' => $dir, 'problema' => 'no se encontró configs/config_site.php'];
            continue;
        }
        $cfg = (static function () use ($archivo) {
            $arrayConfig = null;
            include $archivo;
            return is_array($arrayConfig ?? null) ? $arrayConfig : null;
        })();

        if (!$cfg || empty($cfg['db_name'])) {
            $sitios[] = ['ruta' => $dir, 'problema' => 'config_site.php no define $arrayConfig'];
            continue;
        }
        // La rama sale del MISMO archivo que ya se lee para conectar: es un valor que el
        // cliente declara, así que lo que se muestra en la app es lo que hay en el servidor y
        // no una copia que se puede desincronizar.
        $rama = isset($cfg[$claveRama]) ? (string) $cfg[$claveRama] : null;
        $sitios[] = ['ruta' => $dir, 'base' => $cfg['db_name'], 'rama' => $rama, 'cfg' => $cfg];
    }
    return $sitios;
}

/**
 * Corre el SQL en la base de UN sitio.
 *
 * Usa `multi_query` porque el SQL puede traer varias sentencias; se recorren TODAS para
 * detectar en cuál falló. No hay transacción a propósito: estas corridas son casi siempre
 * DDL (`ALTER TABLE`) y MySQL hace commit implícito, así que envolverlas daría una falsa
 * sensación de que se puede volver atrás.
 * @param array $sitio Sitio con su `cfg`.
 * @param string $sql SQL a ejecutar.
 * @return array<string,mixed> Resultado para reportar (sin credenciales).
 */
function correrSql($sitio, $sql)
{
    $t0 = microtime(true);
    $base = ['sitio' => $sitio['ruta'], 'base' => $sitio['base'] ?? null];
    $c = $sitio['cfg'];

    mysqli_report(MYSQLI_REPORT_OFF);
    $db = @mysqli_connect($c['db_host'] ?? 'localhost', $c['db_user'] ?? '', $c['db_pass'] ?? '', $c['db_name'] ?? '', isset($c['db_port']) ? (int) $c['db_port'] : 3306);
    if (!$db) {
        // mysqli_connect_error() puede incluir el usuario, nunca la contraseña. Igual se
        // recorta: el detalle completo queda en el servidor, no en la app.
        return $base + ['estado' => 'error', 'error' => 'no se pudo conectar a la base', 'ms' => (int) ((microtime(true) - $t0) * 1000)];
    }
    if (!empty($c['db_char'])) @$db->set_charset($c['db_char']);

    $filas = 0;
    $ok = 0;
    $error = null;
    if ($db->multi_query($sql)) {
        do {
            if ($res = $db->store_result()) { $res->free(); }
            $filas += max(0, $db->affected_rows);
            $ok++;
            if (!$db->more_results()) break;
        } while ($db->next_result());
        if ($db->errno) $error = $db->error;
    } else {
        $error = $db->error;
    }
    $db->close();

    return $base + [
        'estado' => $error ? 'error' : 'ok',
        'filasAfectadas' => $filas,
        'sentenciasOk' => $ok,
        'error' => $error ? substr($error, 0, 1000) : null,
        'ms' => (int) ((microtime(true) - $t0) * 1000),
    ];
}

/**
 * Ejecuta un trabajo de SQL. En fase `canario` toca UNA sola base y corta.
 * @param array $t Trabajo recibido de la API.
 * @return array{ok:bool,resultados:array} Lo que se reporta.
 */
function ejecutarSql($t)
{
    global $rutaSitios, $claveRama;
    $sitios = descubrirSitios($rutaSitios, $claveRama);
    // Los que la app no pudo leer no se tocan, pero se reportan: un sitio que no se actualiza
    // en silencio es el peor resultado posible.
    $validos = array_values(array_filter($sitios, function ($s) { return isset($s['cfg']); }));
    $rotos = array_values(array_filter($sitios, function ($s) { return !isset($s['cfg']); }));

    // Si se eligieron sitios en la vista previa, se respeta esa selección.
    if (!empty($t['sitios'])) {
        $elegidos = array_flip($t['sitios']);
        $validos = array_values(array_filter($validos, function ($s) use ($elegidos) {
            return isset($elegidos[$s['ruta']]);
        }));
    }

    if (!$validos) {
        return ['ok' => false, 'resultados' => [], 'error' => 'No se encontró ninguna base para actualizar'];
    }

    // El canario prueba en UNA. El resto corre recién cuando una persona aprueba.
    $aCorrer = $t['fase'] === 'canario' ? [$validos[0]] : array_slice($validos, 1);
    if ($t['fase'] !== 'canario' && !$aCorrer) {
        return ['ok' => true, 'resultados' => []];   // había una sola base: ya se hizo en el canario
    }

    $resultados = [];
    foreach ($aCorrer as $sitio) {
        $resultados[] = correrSql($sitio, $t['sql']);
    }
    // Los ilegibles se anotan como omitidos una sola vez, en la fase del resto.
    if ($t['fase'] !== 'canario') {
        foreach ($rotos as $r) {
            $resultados[] = ['sitio' => $r['ruta'], 'base' => null, 'estado' => 'omitido', 'error' => $r['problema']];
        }
    }
    $hayError = (bool) array_filter($resultados, function ($r) { return $r['estado'] === 'error'; });
    return ['ok' => !$hayError, 'resultados' => $resultados];
}

/**
 * Ejecuta el comando de deploy y captura su salida.
 * @param array $t Trabajo con el `comando` ya resuelto por la app.
 * @return array{ok:bool,salida:string} Resultado.
 */
function ejecutarDeploy($t)
{
    $comando = (string) ($t['comando'] ?? '');
    if (trim($comando) === '') return ['ok' => false, 'salida' => '', 'error' => 'El trabajo no trae comando'];

    // `timeout` evita que un deploy colgado deje el trabajo en «corriendo» para siempre.
    $cmd = 'timeout ' . TIMEOUT_DEPLOY . ' bash -lc ' . escapeshellarg($comando) . ' 2>&1';
    $salida = [];
    $codigo = 0;
    exec($cmd, $salida, $codigo);
    $texto = substr(implode("\n", $salida), -MAX_SALIDA);

    return [
        'ok' => $codigo === 0,
        'salida' => $texto,
        'error' => $codigo === 0 ? null : ($codigo === 124 ? 'El comando superó el tiempo máximo' : "El comando terminó con código $codigo"),
    ];
}

/**
 * Se baja la versión nueva del worker si la que hay quedó vieja.
 *
 * Existe porque cada cambio del worker obligaba a entrar a cada servidor a reinstalarlo, y la
 * tercera vez que pasa eso ya es un problema de diseño. No agrega confianza nueva: la app ya
 * puede hacer que este worker ejecute comandos como root (es lo que hace el deploy), así que
 * que además le mande el propio archivo no cambia en nada el modelo de amenaza.
 *
 * Lo que sí agrega es un modo de falla —un worker roto se propagaría a todos los servidores de
 * una—, y contra eso van las tres defensas:
 *   1. Se valida la SINTAXIS con `php -l` antes de reemplazar nada.
 *   2. Se guarda la versión anterior al lado (`.bak`), para poder volver a mano.
 *   3. El reemplazo es un `rename()` sobre el mismo filesystem, que es atómico: nunca queda
 *      un archivo a medio escribir que la próxima corrida intente ejecutar.
 * Ante cualquier duda NO reemplaza y sigue trabajando con el que ya tiene.
 *
 * @param string $hashRemoto sha256 que publica la app.
 * @return bool true si se actualizó (y hay que terminar la corrida).
 */
function autoactualizar($hashRemoto)
{
    global $apiUrl, $token;
    $propio = @hash_file('sha256', __FILE__);
    if (!$hashRemoto || !$propio || $hashRemoto === $propio) return false;

    $ch = curl_init("$apiUrl/agente/fullglass-worker.php");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => TIMEOUT_HTTP,
        CURLOPT_HTTPHEADER => ["x-agent-token: $token"],
    ]);
    $nuevo = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    // Que el contenido sea el esperado y que coincida con el hash anunciado: si lo que llegó
    // no es exactamente lo que la app dijo que iba a mandar, no se toca nada.
    if ($code !== 200 || !$nuevo || strpos($nuevo, '<?php') !== 0) return false;
    if (hash('sha256', $nuevo) !== $hashRemoto) {
        fwrite(STDERR, "autoactualización: lo descargado no coincide con el hash anunciado\n");
        return false;
    }

    $tmp = __FILE__ . '.nuevo';
    if (@file_put_contents($tmp, $nuevo) === false) return false;

    // `php -l` sobre el archivo nuevo: un error de sintaxis acá se detecta antes de que el
    // worker deje de arrancar en todos los servidores a la vez.
    $salida = [];
    $codigo = 0;
    exec('php -l ' . escapeshellarg($tmp) . ' 2>&1', $salida, $codigo);
    if ($codigo !== 0) {
        @unlink($tmp);
        fwrite(STDERR, "autoactualización rechazada, el archivo nuevo no compila: " . implode(' ', $salida) . "\n");
        return false;
    }

    @copy(__FILE__, __FILE__ . '.bak');
    @chmod($tmp, 0700);
    if (!@rename($tmp, __FILE__)) { @unlink($tmp); return false; }

    echo "worker actualizado a " . substr($hashRemoto, 0, 12) . "; la próxima corrida usa la versión nueva\n";
    return true;
}

/**
 * Deja en el servidor el script que cambia de rama, y lo refresca si quedó viejo.
 *
 * Es el mismo mecanismo que `autoactualizar()` pero sobre OTRO archivo, con dos diferencias:
 * no corta la corrida (no se está reemplazando a sí mismo) y la ruta la manda la app, porque
 * es la app la que después compone el comando que lo invoca — si cada lado tuviera su propia
 * idea de dónde está el archivo, el día que alguno cambie el comando apuntaría a la nada.
 *
 * Que la app distribuya el script es lo que hace que un servidor nuevo no necesite que nadie
 * suba nada a mano. No agrega confianza: la app ya puede hacer que este worker corra comandos
 * como root. Las defensas son las mismas: tiene que coincidir con el hash anunciado y pasar
 * `bash -n` antes de quedar en su lugar, y ante cualquier duda se deja lo que había.
 *
 * @param string $ruta Dónde dejarlo (lo dice la app).
 * @param string|null $hashRemoto sha256 que la app publica.
 * @return void
 */
function sincronizarScriptRama($ruta, $hashRemoto)
{
    global $apiUrl, $token;
    if (!$hashRemoto || !$ruta) return;
    // La ruta viene de la app y se escribe como root: un mínimo de cordura igual, porque un
    // error de tipeo del otro lado no tiene por qué terminar en un archivo suelto en /etc.
    if (substr($ruta, 0, 1) !== '/' || substr($ruta, -3) !== '.sh') {
        fwrite(STDERR, "ruta de script inválida: $ruta\n");
        return;
    }
    if (is_file($ruta) && @hash_file('sha256', $ruta) === $hashRemoto) return;

    $ch = curl_init("$apiUrl/agente/cambiar-rama.sh");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => TIMEOUT_HTTP,
        CURLOPT_HTTPHEADER => ["x-agent-token: $token"],
    ]);
    $nuevo = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code !== 200 || !$nuevo || strpos($nuevo, '#!') !== 0) return;
    if (hash('sha256', $nuevo) !== $hashRemoto) {
        fwrite(STDERR, "script de rama: lo descargado no coincide con el hash anunciado\n");
        return;
    }

    $dir = dirname($ruta);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
        fwrite(STDERR, "script de rama: no existe $dir y no se pudo crear\n");
        return;
    }
    $tmp = $ruta . '.nuevo';
    if (@file_put_contents($tmp, $nuevo) === false) {
        fwrite(STDERR, "script de rama: no se pudo escribir en $dir\n");
        return;
    }

    $salida = [];
    $codigo = 0;
    exec('bash -n ' . escapeshellarg($tmp) . ' 2>&1', $salida, $codigo);
    if ($codigo !== 0) {
        @unlink($tmp);
        fwrite(STDERR, "script de rama rechazado, no compila: " . implode(' ', $salida) . "\n");
        return;
    }

    @chmod($tmp, 0755);
    if (!@rename($tmp, $ruta)) { @unlink($tmp); return; }
    echo "script de rama actualizado en $ruta (" . substr($hashRemoto, 0, 12) . ")\n";
}

// ── Principal ────────────────────────────────────────────────────────────────────────────
//
// La configuración se pide UNA vez y se usa para todo: la ruta a recorrer y la clave donde
// cada cliente declara su rama viven en la app, no en este servidor, para que cambiarlas ahí
// no deje al agente trabajando con datos viejos.
$conf = api('GET', 'agente/config');
if (($conf['data']['tieneFullglass'] ?? false) !== true) exit(0);

// La actualización va ANTES de tomar nada: así nunca se reemplaza el archivo con un trabajo a
// medio ejecutar. Si se actualizó, esta corrida termina y el timer vuelve en 10 s con el nuevo.
if (autoactualizar(isset($conf['data']['workerHash']) ? $conf['data']['workerHash'] : null)) exit(0);
$rutaSitios = isset($conf['data']['rutaSitios']) ? $conf['data']['rutaSitios'] : '/home';
$claveRama = isset($conf['data']['claveRama']) ? $conf['data']['claveRama'] : 'branch';

// Va DESPUÉS de la autoactualización —primero que este worker sea el correcto— y ANTES de
// pedir trabajos, para que un trabajo de rama encuentre el script ya en su lugar aunque sea
// la primera corrida de este servidor.
sincronizarScriptRama(
    isset($conf['data']['scriptRamaRuta']) ? $conf['data']['scriptRamaRuta'] : null,
    isset($conf['data']['scriptRamaHash']) ? $conf['data']['scriptRamaHash'] : null
);

$res = api('GET', 'agente/trabajos');
if ($res['code'] !== 200 || !is_array($res['data'])) {
    fwrite(STDERR, "No se pudo consultar trabajos (HTTP {$res['code']})\n");
    exit(1);
}

if (!$res['data']) {
    // Sin trabajo: se aprovecha para refrescar el inventario que alimenta la vista previa y
    // la columna de rama. Va acá y no en cada corrida con trabajo para no recorrer el disco
    // dos veces seguidas.
    $ruta = $rutaSitios;
    $sitios = descubrirSitios($ruta, $claveRama);
    api('POST', 'agente/sitios', ['sitios' => array_map(
        function ($s) {
            return ['ruta' => $s['ruta'], 'base' => isset($s['base']) ? $s['base'] : null,
                    'rama' => isset($s['rama']) ? $s['rama'] : null,
                    'problema' => isset($s['problema']) ? $s['problema'] : null];
        },
        $sitios
    )]);
    // Una línea por corrida: sin esto una corrida exitosa no deja rastro y el journal solo
    // muestra «Starting / Succeeded», que no dice si encontró algo. Es el dato que hace falta
    // cuando la app dice que no hay bases.
    $conProblema = count(array_filter($sitios, function ($s) { return isset($s['problema']); }));
    echo 'sin trabajos; inventario de ' . $ruta . ': ' . count($sitios) . ' sitio(s)'
        . ($conProblema ? ", $conProblema sin config legible" : '') . "\n";
    exit(0);
}

foreach ($res['data'] as $t) {
    // Un trabajo de SQL necesita mysqli. Se chequea ANTES de tomarlo: si faltara, tomarlo y
    // después morir dejaría el trabajo en «corriendo» sin que nadie pueda destrabarlo.
    if ($t['tipo'] === 'sql' && !function_exists('mysqli_connect')) {
        api('POST', "agente/trabajos/{$t['id']}/tomar");
        api('POST', "agente/trabajos/{$t['id']}/resultado", [
            'ok' => false,
            'error' => 'Este servidor no tiene la extensión mysqli de PHP',
            'resultados' => [],
        ]);
        continue;
    }

    $tomado = api('POST', "agente/trabajos/{$t['id']}/tomar");
    if ($tomado['code'] !== 200) continue;   // otro lo tomó, o se canceló

    // ⚠️ Red de seguridad: pase lo que pase, el trabajo tiene que REPORTAR.
    //
    // Sin esto, cualquier fatal de PHP a mitad de camino deja el trabajo en «corriendo» para
    // siempre: la pantalla muestra algo que nunca va a terminar y no hay forma de destrabarlo
    // sin tocar la base. El shutdown handler cubre incluso los errores que un try/catch no
    // atrapa (falta de una extensión, agotar la memoria).
    $reportado = false;
    $reportar = static function (array $r) use ($t, &$reportado) {
        if ($reportado) return;
        $reportado = true;
        api('POST', "agente/trabajos/{$t['id']}/resultado", [
            'ok' => $r['ok'],
            'salida' => $r['salida'] ?? null,
            'error' => $r['error'] ?? null,
            'resultados' => $r['resultados'] ?? [],
        ]);
    };
    register_shutdown_function(static function () use ($reportar, &$reportado) {
        if ($reportado) return;
        $e = error_get_last();
        $reportar(['ok' => false, 'error' => 'El worker cortó: ' . substr($e['message'] ?? 'motivo desconocido', 0, 300)]);
    });

    try {
        // `rama` se ejecuta igual que un deploy: la app ya resolvió el comando con el cliente
        // y la rama destino adentro, así que acá es correr y capturar.
        $r = $t['tipo'] === 'sql' ? ejecutarSql($t) : ejecutarDeploy($t);
    } catch (Throwable $e) {
        $r = ['ok' => false, 'error' => substr($e->getMessage(), 0, 300), 'resultados' => []];
    }
    $reportar($r);
    echo "trabajo {$t['id']} ({$t['tipo']}/{$t['fase']}): " . ($r['ok'] ? 'ok' : 'con errores') . "\n";
}
