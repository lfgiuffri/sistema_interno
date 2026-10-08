#!/usr/bin/env bash
#
# Cambia un cliente de FullGlass entre las ramas `main` y `development`.
#
#   cambiar-rama.sh <carpeta-del-cliente> <main|development> [--dry-run]
#
# Ejemplo:  cambiar-rama.sh /home/totalpack development
#
# NO hace falta subirlo a ningún servidor: lo distribuye el Sistema Interno. El worker de
# FullGlass lo baja de `GET /agente/cambiar-rama.sh`, lo deja en /usr/local/bin/ y lo refresca
# solo cuando el hash que publica la app deja de coincidir. Desplegar el backend alcanza para
# que todos los servidores queden con la versión nueva.
#
# Lo invoca el Sistema Interno desde Sitios web (la pastilla de la rama). El comando por
# defecto es `<este script> {sitio} {rama}`; en la ficha del servidor se puede configurar otro,
# para un servidor con un layout propio.
#
# También se puede correr a mano. Todo lo que imprime queda guardado en el historial de
# Ejecuciones de la app, así que el texto está escrito para leerse ahí.
#
# QUÉ TOCA (y qué no):
#
#   <cliente>/configs/config_site.php
#       'branch'           => 'main' | 'development'
#       'backTemplatesDir' => '../../FullGlass/adminFiles/templates/'
#                           | '../../FullGlassDev/adminFiles/templates/'
#          (la cantidad de `../` NO importa: se conserva la que tenga el archivo)
#       ⚠️ NO toca 'backCustomTemplatesDir', que también dice FullGlass/adminFiles/templates/
#          pero cuelga de otro lado. Por eso cada reemplazo va anclado al NOMBRE DE LA CLAVE
#          y no al texto de la ruta.
#
#   <cliente>/sitio/index.php  y  <cliente>/sitio/getPlugin.php
#       set_include_path(... .'/../../FullGlass/POSITIVEMEDIA');
#                            | '/../../FullGlassDev/POSITIVEMEDIA');
#       ⚠️ Los dos archivos tienen ADEMÁS un set_include_path a '/../FullGlass' que NO se
#          cambia. Lo que separa a uno del otro es el `/POSITIVEMEDIA` FINAL, no la cantidad
#          de `../`: la profundidad varía entre servidores y anclarla a un número fijo hacía
#          que el script no encontrara nada y no pudiera trabajar.
#
# CÓMO SE PROTEGE (son tres archivos: quedar a mitad de camino es el peor resultado posible —
# el config diría una rama y el include seguiría apuntando a la otra):
#
#   1. Comprueba TODO antes de escribir NADA: que los tres archivos existan y se puedan
#      escribir, y que la carpeta destino (FullGlass o FullGlassDev) exista de verdad.
#   2. Prepara las tres versiones nuevas en archivos temporales y verifica cada una: que el
#      reemplazo haya ocurrido (no confía en que sed hizo algo) y que el PHP siga compilando.
#   3. Recién entonces escribe los tres, con respaldo previo. Si alguno falla, DESHACE todo.
#   4. Vuelve a leer los tres archivos y reporta el estado final, que es lo único que prueba
#      que el cambio quedó.
#
# Escribe con `cat > archivo` y no con `mv`: así el archivo conserva su dueño y sus permisos.
# Un `mv` lo dejaría de root y el sitio dejaría de poder leerlo.
#
set -uo pipefail

RAMA_ESTABLE='main'
RAMA_PRUEBAS='development'
# Carpeta de FullGlass que le corresponde a cada rama.
DIR_ESTABLE='FullGlass'
DIR_PRUEBAS='FullGlassDev'

PROGRAMA=$(basename "$0")

morir() { echo "ERROR: $*" >&2; exit 1; }

uso() {
    cat >&2 <<AYUDA
Uso: $PROGRAMA <carpeta-del-cliente> <$RAMA_ESTABLE|$RAMA_PRUEBAS> [--dry-run]
     $PROGRAMA <carpeta-del-cliente> --detectar [--dry-run]

  <carpeta-del-cliente>  Carpeta que contiene configs/ y sitio/  (ej: /home/totalpack)
  --detectar             NO cambia de rama: averigua en cuál está mirando los archivos y
                         deja declarada la key 'branch' en config_site.php. Es para los
                         clientes viejos, que no la tienen y por eso el sistema no puede
                         mostrar en qué rama están.
  --dry-run, -n          Muestra lo que haría, sin tocar ningún archivo.
AYUDA
    exit 2
}

# ── Argumentos ───────────────────────────────────────────────────────────────────────
SITIO=''; RAMA=''; SECO=0; DETECTAR=0
for arg in "$@"; do
    case "$arg" in
        --dry-run|-n) SECO=1 ;;
        --detectar)   DETECTAR=1 ;;
        -h|--help)    uso ;;
        -*)           morir "Opción desconocida: $arg" ;;
        *)            if   [ -z "$SITIO" ]; then SITIO="$arg"
                      elif [ -z "$RAMA" ];  then RAMA="$arg"
                      else morir "Sobra el argumento «$arg»"; fi ;;
    esac
done
[ -n "$SITIO" ] || uso
# Se rechaza en vez de elegir uno de los dos: pedir «pasalo a main» y «averiguá en cuál está»
# a la vez no quiere decir nada, y adivinar cuál gana es la clase de cosa que después nadie
# puede explicar mirando el historial.
[ "$DETECTAR" = 1 ] && [ -n "$RAMA" ] && morir "--detectar no se combina con una rama destino: o se averigua, o se cambia."
[ "$DETECTAR" = 1 ] || [ -n "$RAMA" ] || uso

DIR_FG=''
if [ "$DETECTAR" = 0 ]; then
    case "$RAMA" in
        "$RAMA_ESTABLE") DIR_FG="$DIR_ESTABLE" ;;
        "$RAMA_PRUEBAS") DIR_FG="$DIR_PRUEBAS" ;;
        # Se rechaza en vez de adivinar: «dev» era el nombre viejo y mandarlo a una carpeta que
        # no existe deja el sitio caído.
        *) morir "Rama «$RAMA» inválida. Las únicas válidas son «$RAMA_ESTABLE» y «$RAMA_PRUEBAS»." ;;
    esac
fi

SITIO="${SITIO%/}"
[ -d "$SITIO" ] || morir "No existe la carpeta del cliente: $SITIO"

CONFIG="$SITIO/configs/config_site.php"
INDEX="$SITIO/sitio/index.php"
PLUGIN="$SITIO/sitio/getPlugin.php"
ARCHIVOS=("$CONFIG" "$INDEX" "$PLUGIN")

echo "Cliente: $SITIO"
if [ "$DETECTAR" = 1 ]; then
    echo "Modo: DETECTAR (no se cambia de rama, solo se declara la que ya tiene)"
else
    echo "Rama destino: $RAMA (carpeta $DIR_FG)"
fi
[ "$SECO" = 1 ] && echo "MODO PRUEBA: no se va a escribir nada."
echo

# ── 1. Todo tiene que estar en su lugar ANTES de tocar nada ──────────────────────────
for a in "${ARCHIVOS[@]}"; do
    [ -f "$a" ] || morir "Falta el archivo $a — ¿es esta la carpeta del cliente?"
    [ -r "$a" ] || morir "No se puede leer $a"
    [ -w "$a" ] || morir "No se puede escribir $a (¿permisos? ¿hace falta sudo?)"
    # También la CARPETA: ahí se crea el respaldo. Sin esto la corrida arranca, escribe el
    # primero y recién falla en el segundo — la vuelta atrás lo resuelve, pero es mejor no
    # haber tocado nada.
    [ -w "$(dirname "$a")" ] || morir "No se puede escribir en $(dirname "$a") (ahí va el respaldo)"
done

# ── 2. Estado actual, archivo por archivo ────────────────────────────────────────────
# Se mira cada uno por separado y no solo el config: si un intento anterior quedó a mitad,
# esto es lo único que lo muestra.
rama_de_config() {
    sed -nE "s/.*'branch'[[:space:]]*=>[[:space:]]*'([^']*)'.*/\1/p" "$CONFIG" | head -1
}
dir_de_templates() {
    sed -nE "/'backTemplatesDir'/ s@.*(\.\./)+([A-Za-z]+)/adminFiles.*@\2@p" "$CONFIG" | head -1
}
# La cadena de `../` TAL CUAL la tiene el archivo (ej. `/../../`). Se lee en vez de asumirla
# porque la profundidad cambia de servidor en servidor, y es lo que después se usa para
# comprobar que la carpeta destino existe de verdad.
prefijo_de_include() {
    sed -nE "s@.*'((/\.\.)+/)[A-Za-z]+/POSITIVEMEDIA.*@\1@p" "$1" | head -1
}

dir_de_include() {
    sed -nE "s@.*/(\.\./)+([A-Za-z]+)/POSITIVEMEDIA.*@\2@p" "$1" | head -1
}

BRANCH_ACTUAL=$(rama_de_config)
TPL_ACTUAL=$(dir_de_templates)
IDX_ACTUAL=$(dir_de_include "$INDEX")
PLG_ACTUAL=$(dir_de_include "$PLUGIN")

echo "Estado actual:"
echo "  config_site.php  branch           = ${BRANCH_ACTUAL:-«falta la clave»}"
echo "  config_site.php  backTemplatesDir = ${TPL_ACTUAL:-«no se reconoció»}"
echo "  sitio/index.php      include_path = ${IDX_ACTUAL:-«no se reconoció»}"
echo "  sitio/getPlugin.php  include_path = ${PLG_ACTUAL:-«no se reconoció»}"
echo

# La carpeta destino tiene que EXISTIR. Es la comprobación que más sirve de todas: pasar un
# cliente a `development` en un servidor que nunca tuvo FullGlassDev lo deja caído al instante,
# y el error aparecería como un 500 en el navegador del cliente, no acá.
#
# Va DESPUÉS de leer los archivos y no antes, porque la ruta sale del propio `index.php`: la
# cantidad de `../` cambia según cómo esté armado el servidor, y asumir una profundidad fija
# era mirar una carpeta que no es.
#
# En modo detectar no se mira: no se mueve nada, así que exigir FullGlassDev dejaría sin poder
# declarar su rama a los clientes de un servidor que solo tiene la estable — que son
# justamente los que más les falta la key.
if [ "$DETECTAR" = 0 ]; then
    PREFIJO=$(prefijo_de_include "$INDEX")
    [ -n "$PREFIJO" ] || morir "No se pudo leer la ruta a FullGlass desde $INDEX. No se tocó nada."
    DESTINO_FG="$SITIO/sitio$PREFIJO$DIR_FG"
    if [ -d "$DESTINO_FG/POSITIVEMEDIA" ]; then
        echo "Carpeta destino OK: $(cd "$DESTINO_FG" && pwd)"
    else
        RESUELTA=$(cd "$SITIO/sitio$PREFIJO" 2>/dev/null && pwd)
        morir "No existe $DIR_FG/POSITIVEMEDIA bajo ${RESUELTA:-$SITIO/sitio$PREFIJO} — este servidor no tiene esa rama instalada. No se tocó nada."
    fi
fi

# Inserta `'branch' => '<rama>'` como PRIMERA clave del $arrayConfig.
#
# Primera y no «al lado de backTemplatesDir» porque es el dato que uno va a buscar cuando abre
# el archivo: tenerlo arriba de todo evita el scroll y evita la duda de si está o no. Se mete
# justo después de la línea que abre el arreglo —antes incluso del comentario que encabeza el
# primer grupo— y hereda la indentación de la primera clave que encuentre, para no desalinear
# un archivo que está todo con tabs.
#
# Si no se reconoce la apertura del arreglo NO inventa: devuelve 1 y el que llama decide.
# @param $1 archivo de entrada  $2 archivo de salida  $3 rama a declarar
insertar_branch_primera() {
    awk -v rama="$3" '
        BEGIN { sangria = "\t\t" }
        # Sangría de referencia: la primera clave del arreglo.
        sangria_vista != 1 && /^[[:space:]]*'"'"'[A-Za-z_]+'"'"'[[:space:]]*=>/ {
            match($0, /^[[:space:]]*/)
            sangria = substr($0, 1, RLENGTH)
            sangria_vista = 1
        }
        { lineas[NR] = $0 }
        !apertura && /\$arrayConfig[[:space:]]*=[[:space:]]*(array[[:space:]]*\(|\[)/ { apertura = NR }
        END {
            if (!apertura) exit 1
            for (i = 1; i <= NR; i++) {
                print lineas[i]
                if (i == apertura) printf "%s'"'"'branch'"'"' => '"'"'%s'"'"',\n", sangria, rama
            }
        }
    ' "$1" > "$2"
}

[ -n "$TPL_ACTUAL" ] || morir "En $CONFIG no se encontró 'backTemplatesDir' con la forma ../<carpeta>/adminFiles/... — no se tocó nada."
[ -n "$IDX_ACTUAL" ] || morir "En $INDEX no se encontró el set_include_path a ../<carpeta>/POSITIVEMEDIA — no se tocó nada."
[ -n "$PLG_ACTUAL" ] || morir "En $PLUGIN no se encontró el set_include_path a ../<carpeta>/POSITIVEMEDIA — no se tocó nada."

# ── 3. Herramientas de escritura, compartidas por los dos modos ──────────────────────
TMPDIR_T=$(mktemp -d) || morir "No se pudo crear la carpeta temporal"
# El trap corre pase lo que pase: un temporal con el config de un cliente no se deja tirado.
trap 'rm -rf "$TMPDIR_T"' EXIT

NUEVO_CONFIG="$TMPDIR_T/config_site.php"
NUEVO_INDEX="$TMPDIR_T/index.php"
NUEVO_PLUGIN="$TMPDIR_T/getPlugin.php"

# Estos archivos terminan en `?>` SIN salto de línea final, y sed le agrega uno. PHP se come
# un salto después de `?>`, así que no cambia el comportamiento — pero deja una línea de más
# en el diff, y acá lo que importa es poder mirar un diff y entenderlo de un vistazo. Se le
# saca el byte que sobra, uno solo y solo si el original no lo tenía.
igualar_salto_final() {
    local original="$1" nuevo="$2"
    [ -s "$original" ] || return 0
    [ -n "$(tail -c1 "$original")" ] || return 0   # el original SÍ terminaba en salto: nada que hacer
    [ -z "$(tail -c1 "$nuevo")" ] || return 0      # el nuevo tampoco termina en salto: nada que hacer
    truncate -s -1 "$nuevo"
}

SELLO=$(date +%Y%m%d-%H%M%S)
ESCRITOS=()

deshacer() {
    echo "Deshaciendo lo ya escrito…" >&2
    for a in "${ESCRITOS[@]}"; do
        cat "$a.bak-$SELLO" > "$a" 2>/dev/null \
            && echo "  restaurado: $a" >&2 \
            || echo "  ¡NO SE PUDO RESTAURAR $a! El respaldo está en $a.bak-$SELLO" >&2
    done
}

# Aplica los pares `destino:nuevo` que se le pasen: normaliza el final de archivo, valida el
# PHP, y escribe con respaldo. Ante cualquier falla deshace lo ya escrito.
#
# Es UNA función y no dos copias porque los dos modos tocan los mismos archivos del mismo
# cliente: si la red de seguridad estuviera duplicada, el día que se arregle algo acá el otro
# camino se quedaría sin el arreglo.
aplicar_cambios() {
    local par destino fuente

    for par in "$@"; do igualar_salto_final "${par%%:*}" "${par##*:}"; done

    # Sintaxis de PHP. Si el servidor no tiene el binario, se sigue igual pero se dice.
    if command -v php >/dev/null 2>&1; then
        for par in "$@"; do
            php -l "${par##*:}" >/dev/null 2>&1 \
                || morir "El resultado de $(basename "${par%%:*}") no compila como PHP. No se escribió nada."
        done
        echo "Sintaxis PHP verificada."
    else
        echo "Aviso: no hay binario «php» en el PATH, no se pudo verificar la sintaxis."
    fi

    if [ "$SECO" = 1 ]; then
        echo
        echo "Cambios que se aplicarían:"
        for par in "$@"; do
            echo "--- ${par%%:*}"
            diff -u "${par%%:*}" "${par##*:}" | tail -n +3
        done
        echo
        echo "MODO PRUEBA: no se escribió nada."
        exit 0
    fi

    for par in "$@"; do
        destino="${par%%:*}"; fuente="${par##*:}"
        cp -p "$destino" "$destino.bak-$SELLO" || { deshacer; morir "No se pudo respaldar $destino"; }
        # `cat >` y no `mv`: conserva dueño, grupo y permisos del archivo original.
        if ! cat "$fuente" > "$destino"; then
            ESCRITOS+=("$destino")
            deshacer
            morir "No se pudo escribir $destino"
        fi
        ESCRITOS+=("$destino")
    done
}

# ── 4. Modo DETECTAR: averiguar la rama y dejarla declarada ──────────────────────────
#
# Para los clientes viejos, que no tienen la key `branch`. Sin ella el sistema no puede decir
# en qué rama están, y hasta hoy la única salida era entrar al servidor a mano.
#
# NO toca index.php ni getPlugin.php: no se está moviendo nada, se está escribiendo el dato
# que faltaba. Un solo archivo y una sola clave es mucho menos superficie de error.
if [ "$DETECTAR" = 1 ]; then
    # Los TRES tienen que coincidir. Si no coinciden el cliente quedó a mitad de camino de un
    # cambio anterior, y declarar cualquiera de las dos sería estampar como verdad algo que no
    # lo es — justo el tipo de dato que después se usa para decidir.
    if [ "$TPL_ACTUAL" != "$IDX_ACTUAL" ] || [ "$IDX_ACTUAL" != "$PLG_ACTUAL" ]; then
        echo "backTemplatesDir=$TPL_ACTUAL  index.php=$IDX_ACTUAL  getPlugin.php=$PLG_ACTUAL" >&2
        morir "Los tres archivos no apuntan a la misma carpeta: este cliente quedó a mitad de un cambio de rama. Resolvelo con un cambio explícito (a main o a development); no se declara nada."
    fi

    case "$TPL_ACTUAL" in
        "$DIR_ESTABLE") DETECTADA="$RAMA_ESTABLE" ;;
        "$DIR_PRUEBAS") DETECTADA="$RAMA_PRUEBAS" ;;
        *) morir "Los archivos apuntan a «$TPL_ACTUAL», que no es ni $DIR_ESTABLE ni $DIR_PRUEBAS. No se declara nada." ;;
    esac
    echo "Rama detectada: $DETECTADA (los tres archivos apuntan a $TPL_ACTUAL)"

    if [ "$BRANCH_ACTUAL" = "$DETECTADA" ]; then
        echo "La key 'branch' ya dice «$DETECTADA». No hay nada que hacer."
        exit 0
    fi

    if [ -z "$BRANCH_ACTUAL" ]; then
        insertar_branch_primera "$CONFIG" "$NUEVO_CONFIG" "$DETECTADA" \
            || morir "No se reconoció la apertura de \$arrayConfig en $CONFIG: habría que agregar la key a mano. No se tocó nada."
        echo "Se agrega la key 'branch' como PRIMERA del arreglo."
    else
        # Existía con otro valor: se corrige DONDE ESTÁ. Moverla arriba sería un diff más
        # grande para ningún beneficio, y acá el archivo es de un cliente en producción.
        sed -E "/'branch'/ s@('branch'[[:space:]]*=>[[:space:]]*)'[^']*'@\1'$DETECTADA'@" \
            "$CONFIG" > "$NUEVO_CONFIG" || morir "Falló la edición de config_site.php"
        echo "La key 'branch' decía «$BRANCH_ACTUAL» y los archivos dicen «$DETECTADA»: se corrige."
    fi

    # Verificar el resultado antes de escribir: se relee, no se confía en el reemplazo.
    BRANCH_NUEVO=$(sed -nE "s/.*'branch'[[:space:]]*=>[[:space:]]*'([^']*)'.*/\1/p" "$NUEVO_CONFIG" | head -1)
    [ "$BRANCH_NUEVO" = "$DETECTADA" ] || morir "branch quedó en «${BRANCH_NUEVO:-nada}» en vez de «$DETECTADA». No se escribió nada."
    # Y que no se haya tocado nada más que esa línea. Se normaliza ANTES de contar el salto
    # final que agrega awk: si no, ese byte aparece como una línea cambiada de más y el guard
    # saltaría siempre. `aplicar_cambios` la vuelve a llamar y no pasa nada: es idempotente.
    igualar_salto_final "$CONFIG" "$NUEVO_CONFIG"
    if [ "$(diff "$CONFIG" "$NUEVO_CONFIG" | grep -c "^[<>]")" -gt 2 ]; then
        morir "El cambio afectó más de una línea de $CONFIG. No se escribió nada."
    fi

    aplicar_cambios "$CONFIG:$NUEVO_CONFIG"

    FINAL=$(rama_de_config)
    [ "$FINAL" = "$DETECTADA" ] || { deshacer; morir "La comprobación final dio «$FINAL». Se volvió atrás."; }
    echo
    echo "Listo: $SITIO queda declarado en «$FINAL». No se cambió de rama, solo se registró la que ya tenía."
    echo "Respaldo: $CONFIG.bak-$SELLO"
    exit 0
fi

# Idempotencia: la app puede reintentar un trabajo, y volver a aplicar lo mismo no es un error.
if [ "$BRANCH_ACTUAL" = "$RAMA" ] && [ "$TPL_ACTUAL" = "$DIR_FG" ] \
   && [ "$IDX_ACTUAL" = "$DIR_FG" ] && [ "$PLG_ACTUAL" = "$DIR_FG" ]; then
    echo "Ya estaba en «$RAMA» y los tres archivos coinciden. No hay nada que hacer."
    exit 0
fi

# ── 5. Modo CAMBIAR: mover al cliente de rama ────────────────────────────────────────
# config_site.php — dos cambios, los dos anclados al NOMBRE de la clave.
sed -E \
    -e "/'branch'/ s@('branch'[[:space:]]*=>[[:space:]]*)'[^']*'@\1'$RAMA'@" \
    -e "/'backTemplatesDir'/ s@((\.\./)+)[A-Za-z]+(/adminFiles)@\1$DIR_FG\3@" \
    "$CONFIG" > "$NUEVO_CONFIG" || morir "Falló la edición de config_site.php"

# Si la clave `branch` no existía, se agrega como PRIMERA del arreglo: es el dato que uno va a
# buscar cuando abre el archivo. Sin ella el sitio funciona igual, pero el Sistema Interno no
# puede mostrar en qué rama está, que es la mitad del sentido de esto.
AGREGO_BRANCH=0
if [ -z "$BRANCH_ACTUAL" ]; then
    insertar_branch_primera "$CONFIG" "$NUEVO_CONFIG.b" "$RAMA" \
        || morir "No se reconoció la apertura de \$arrayConfig en $CONFIG. No se tocó nada."
    # El reemplazo de backTemplatesDir se vuelve a aplicar sobre el archivo ya con la key.
    sed -E "/'backTemplatesDir'/ s@((\.\./)+)[A-Za-z]+(/adminFiles)@\1$DIR_FG\3@" \
        "$NUEVO_CONFIG.b" > "$NUEVO_CONFIG" || morir "Falló la edición de config_site.php"
    rm -f "$NUEVO_CONFIG.b"
    AGREGO_BRANCH=1
fi

# index.php y getPlugin.php — el patrón exige los TRES `../` y el `/POSITIVEMEDIA` final,
# que es lo que distingue la línea a cambiar de la otra, la de '/../FullGlass'.
for par in "$INDEX:$NUEVO_INDEX" "$PLUGIN:$NUEVO_PLUGIN"; do
    sed -E "s@(/(\.\./)+)[A-Za-z]+(/POSITIVEMEDIA)@\1$DIR_FG\3@g" \
        "${par%%:*}" > "${par##*:}" || morir "Falló la edición de ${par%%:*}"
done

# ── 6. Verificar los temporales antes de pisar nada ──────────────────────────────────
# No se confía en que sed hizo lo que se le pidió: se lee el resultado.
verificar() {
    local archivo="$1" etiqueta="$2" obtenido
    obtenido=$(dir_de_include "$archivo")
    [ "$obtenido" = "$DIR_FG" ] || morir "$etiqueta quedó apuntando a «${obtenido:-nada}» en vez de «$DIR_FG». No se escribió nada."
}
verificar "$NUEVO_INDEX" "index.php"
verificar "$NUEVO_PLUGIN" "getPlugin.php"

TPL_NUEVO=$(sed -nE "/'backTemplatesDir'/ s@.*(\.\./)+([A-Za-z]+)/adminFiles.*@\2@p" "$NUEVO_CONFIG" | head -1)
[ "$TPL_NUEVO" = "$DIR_FG" ] || morir "backTemplatesDir quedó en «${TPL_NUEVO:-nada}» en vez de «$DIR_FG». No se escribió nada."
BRANCH_NUEVO=$(sed -nE "s/.*'branch'[[:space:]]*=>[[:space:]]*'([^']*)'.*/\1/p" "$NUEVO_CONFIG" | head -1)
[ "$BRANCH_NUEVO" = "$RAMA" ] || morir "branch quedó en «${BRANCH_NUEVO:-nada}» en vez de «$RAMA». No se escribió nada."

# El otro backTemplates NO se tocó: se compara contra el original, carácter por carácter.
original_custom=$(grep -c "backCustomTemplatesDir" "$CONFIG")
nuevo_custom=$(grep -c "backCustomTemplatesDir" "$NUEVO_CONFIG")
if [ "$original_custom" != "$nuevo_custom" ] \
   || ! diff <(grep "backCustomTemplatesDir" "$CONFIG") <(grep "backCustomTemplatesDir" "$NUEVO_CONFIG") >/dev/null 2>&1; then
    morir "Se modificó 'backCustomTemplatesDir', que no se debía tocar. No se escribió nada."
fi

# ── 7. Escribir y confirmar ──────────────────────────────────────────────────────────
aplicar_cambios "$CONFIG:$NUEVO_CONFIG" "$INDEX:$NUEVO_INDEX" "$PLUGIN:$NUEVO_PLUGIN"

FINAL_BRANCH=$(rama_de_config)
FINAL_TPL=$(dir_de_templates)
FINAL_IDX=$(dir_de_include "$INDEX")
FINAL_PLG=$(dir_de_include "$PLUGIN")

if [ "$FINAL_BRANCH" != "$RAMA" ] || [ "$FINAL_TPL" != "$DIR_FG" ] \
   || [ "$FINAL_IDX" != "$DIR_FG" ] || [ "$FINAL_PLG" != "$DIR_FG" ]; then
    deshacer
    morir "La comprobación final no dio: branch=$FINAL_BRANCH templates=$FINAL_TPL index=$FINAL_IDX plugin=$FINAL_PLG. Se volvió atrás."
fi

echo
[ "$AGREGO_BRANCH" = 1 ] && echo "Se AGREGÓ la clave 'branch' a config_site.php (no estaba), como primera del arreglo."
echo "Listo: $SITIO pasó de «${BRANCH_ACTUAL:-sin rama}» a «$RAMA»."
echo "  config_site.php      branch=$FINAL_BRANCH  backTemplatesDir=$(sed -nE "/'backTemplatesDir'/ s@.*=>[[:space:]]*'([^']*)'.*@\1@p" "$CONFIG" | head -1)"
echo "  sitio/index.php      $(prefijo_de_include "$INDEX")$FINAL_IDX/POSITIVEMEDIA"
echo "  sitio/getPlugin.php  $(prefijo_de_include "$PLUGIN")$FINAL_PLG/POSITIVEMEDIA"
echo "Respaldos: *.bak-$SELLO (en la carpeta de cada archivo)."
