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
function descubrirSitios($rutaBase)
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
        $sitios[] = ['ruta' => $dir, 'base' => $cfg['db_name'], 'cfg' => $cfg];
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
    $sitios = descubrirSitios($t['rutaSitios'] ?? '/home');
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

// ── Principal ────────────────────────────────────────────────────────────────────────────
$res = api('GET', 'agente/trabajos');
if ($res['code'] !== 200 || !is_array($res['data'])) {
    fwrite(STDERR, "No se pudo consultar trabajos (HTTP {$res['code']})\n");
    exit(1);
}

if (!$res['data']) {
    // Sin trabajo: se aprovecha para refrescar el inventario que alimenta la vista previa.
    // Va acá y no en cada corrida con trabajo para no recorrer el disco dos veces seguidas.
    // La ruta se pregunta a la app y NO se guarda en el .env del servidor: si viviera en los
    // dos lados, cambiarla en la ficha dejaría al agente recorriendo la vieja en silencio.
    $conf = api('GET', 'agente/config');
    if (($conf['data']['tieneFullglass'] ?? false) !== true) exit(0);
    $sitios = descubrirSitios($conf['data']['rutaSitios'] ?? '/home');
    api('POST', 'agente/sitios', ['sitios' => array_map(
        function ($s) {
            return ['ruta' => $s['ruta'], 'base' => isset($s['base']) ? $s['base'] : null,
                    'problema' => isset($s['problema']) ? $s['problema'] : null];
        },
        $sitios
    )]);
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
        $r = $t['tipo'] === 'sql' ? ejecutarSql($t) : ejecutarDeploy($t);
    } catch (Throwable $e) {
        $r = ['ok' => false, 'error' => substr($e->getMessage(), 0, 300), 'resultados' => []];
    }
    $reportar($r);
    echo "trabajo {$t['id']} ({$t['tipo']}/{$t['fase']}): " . ($r['ok'] ? 'ok' : 'con errores') . "\n";
}
