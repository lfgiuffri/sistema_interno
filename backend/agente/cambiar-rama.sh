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
#       'backTemplatesDir' => '../../../FullGlass/adminFiles/templates/'
#                           | '../../../FullGlassDev/adminFiles/templates/'
#       ⚠️ NO toca 'backCustomTemplatesDir', que también dice FullGlass/adminFiles/templates/
#          pero cuelga de otro lado. Por eso cada reemplazo va anclado al NOMBRE DE LA CLAVE
#          y no al texto de la ruta.
#
#   <cliente>/sitio/index.php  y  <cliente>/sitio/getPlugin.php
#       set_include_path(... .'/../../../FullGlass/POSITIVEMEDIA');
#                            | '/../../../FullGlassDev/POSITIVEMEDIA');
#       ⚠️ Los dos archivos tienen ADEMÁS un set_include_path a '/../FullGlass' que NO se
#          cambia. Por eso el patrón exige los tres `../` y el `/POSITIVEMEDIA` final.
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

  <carpeta-del-cliente>  Carpeta que contiene configs/ y sitio/  (ej: /home/totalpack)
  --dry-run, -n          Muestra lo que haría, sin tocar ningún archivo.
AYUDA
    exit 2
}

# ── Argumentos ───────────────────────────────────────────────────────────────────────
SITIO=''; RAMA=''; SECO=0
for arg in "$@"; do
    case "$arg" in
        --dry-run|-n) SECO=1 ;;
        -h|--help)    uso ;;
        -*)           morir "Opción desconocida: $arg" ;;
        *)            if   [ -z "$SITIO" ]; then SITIO="$arg"
                      elif [ -z "$RAMA" ];  then RAMA="$arg"
                      else morir "Sobra el argumento «$arg»"; fi ;;
    esac
done
[ -n "$SITIO" ] && [ -n "$RAMA" ] || uso

case "$RAMA" in
    "$RAMA_ESTABLE") DIR_FG="$DIR_ESTABLE" ;;
    "$RAMA_PRUEBAS") DIR_FG="$DIR_PRUEBAS" ;;
    # Se rechaza en vez de adivinar: «dev» era el nombre viejo y mandarlo a una carpeta que
    # no existe deja el sitio caído.
    *) morir "Rama «$RAMA» inválida. Las únicas válidas son «$RAMA_ESTABLE» y «$RAMA_PRUEBAS»." ;;
esac

SITIO="${SITIO%/}"
[ -d "$SITIO" ] || morir "No existe la carpeta del cliente: $SITIO"

CONFIG="$SITIO/configs/config_site.php"
INDEX="$SITIO/sitio/index.php"
PLUGIN="$SITIO/sitio/getPlugin.php"
ARCHIVOS=("$CONFIG" "$INDEX" "$PLUGIN")

echo "Cliente: $SITIO"
echo "Rama destino: $RAMA (carpeta $DIR_FG)"
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

# La carpeta destino tiene que EXISTIR. Es la comprobación que más sirve de todas: pasar un
# cliente a `development` en un servidor que nunca tuvo FullGlassDev lo deja caído al instante,
# y el error aparecería como un 500 en el navegador del cliente, no acá.
DESTINO_FG="$SITIO/sitio/../../../$DIR_FG"
if [ -d "$DESTINO_FG/POSITIVEMEDIA" ]; then
    echo "Carpeta destino OK: $(cd "$DESTINO_FG" && pwd)"
else
    RESUELTA=$(cd "$SITIO/sitio/../../.." 2>/dev/null && pwd)
    morir "No existe $DIR_FG/POSITIVEMEDIA bajo ${RESUELTA:-$SITIO/sitio/../../..} — este servidor no tiene esa rama instalada. No se tocó nada."
fi

# ── 2. Estado actual, archivo por archivo ────────────────────────────────────────────
# Se mira cada uno por separado y no solo el config: si un intento anterior quedó a mitad,
# esto es lo único que lo muestra.
rama_de_config() {
    sed -nE "s/.*'branch'[[:space:]]*=>[[:space:]]*'([^']*)'.*/\1/p" "$CONFIG" | head -1
}
dir_de_templates() {
    sed -nE "/'backTemplatesDir'/ s@.*\.\./\.\./\.\./([A-Za-z]+)/adminFiles.*@\1@p" "$CONFIG" | head -1
}
dir_de_include() {
    sed -nE "s@.*/\.\./\.\./\.\./([A-Za-z]+)/POSITIVEMEDIA.*@\1@p" "$1" | head -1
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

[ -n "$TPL_ACTUAL" ] || morir "En $CONFIG no se encontró 'backTemplatesDir' con la forma ../../../<carpeta>/adminFiles/... — no se tocó nada."
[ -n "$IDX_ACTUAL" ] || morir "En $INDEX no se encontró el set_include_path a ../../../<carpeta>/POSITIVEMEDIA — no se tocó nada."
[ -n "$PLG_ACTUAL" ] || morir "En $PLUGIN no se encontró el set_include_path a ../../../<carpeta>/POSITIVEMEDIA — no se tocó nada."

# Idempotencia: la app puede reintentar un trabajo, y volver a aplicar lo mismo no es un error.
if [ "$BRANCH_ACTUAL" = "$RAMA" ] && [ "$TPL_ACTUAL" = "$DIR_FG" ] \
   && [ "$IDX_ACTUAL" = "$DIR_FG" ] && [ "$PLG_ACTUAL" = "$DIR_FG" ]; then
    echo "Ya estaba en «$RAMA» y los tres archivos coinciden. No hay nada que hacer."
    exit 0
fi

# ── 3. Preparar las versiones nuevas en temporales ───────────────────────────────────
TMPDIR_T=$(mktemp -d) || morir "No se pudo crear la carpeta temporal"
# El trap corre pase lo que pase: un temporal con el config de un cliente no se deja tirado.
trap 'rm -rf "$TMPDIR_T"' EXIT

NUEVO_CONFIG="$TMPDIR_T/config_site.php"
NUEVO_INDEX="$TMPDIR_T/index.php"
NUEVO_PLUGIN="$TMPDIR_T/getPlugin.php"

# Estos archivos terminan en `?>` SIN salto de línea final, y sed le agrega uno. PHP se come
# un salto después de `?>`, así que no cambia el comportamiento — pero deja una línea de más
# en el diff de los tres archivos, y acá lo que importa es poder mirar un diff y entenderlo
# de un vistazo. Se le saca el byte que sobra, uno solo y solo si el original no lo tenía.
igualar_salto_final() {
    local original="$1" nuevo="$2"
    [ -s "$original" ] || return 0
    [ -n "$(tail -c1 "$original")" ] || return 0   # el original SÍ terminaba en salto: nada que hacer
    [ -z "$(tail -c1 "$nuevo")" ] || return 0      # el nuevo tampoco termina en salto: nada que hacer
    truncate -s -1 "$nuevo"
}

# config_site.php — dos cambios, los dos anclados al NOMBRE de la clave.
sed -E \
    -e "/'branch'/ s@('branch'[[:space:]]*=>[[:space:]]*)'[^']*'@\1'$RAMA'@" \
    -e "/'backTemplatesDir'/ s@(\.\./\.\./\.\./)[A-Za-z]+(/adminFiles)@\1$DIR_FG\2@" \
    "$CONFIG" > "$NUEVO_CONFIG" || morir "Falló la edición de config_site.php"

# Si la clave `branch` no existía, se agrega. Sin ella el sitio funciona igual, pero el
# Sistema Interno no puede mostrar en qué rama está —que es la mitad del sentido de esto—,
# así que se crea y se avisa. Va pegada a 'backTemplatesDir' para heredar su indentación y
# quedar dentro del array sí o sí.
AGREGO_BRANCH=0
if [ -z "$BRANCH_ACTUAL" ]; then
    awk -v rama="$RAMA" '
        !puesta && /'\''backTemplatesDir'\''/ {
            match($0, /^[[:space:]]*/)
            printf "%s'\''branch'\'' => '\''%s'\'',\n", substr($0, 1, RLENGTH), rama
            puesta = 1
        }
        { print }
    ' "$NUEVO_CONFIG" > "$NUEVO_CONFIG.b" && mv "$NUEVO_CONFIG.b" "$NUEVO_CONFIG" \
        || morir "No se pudo agregar la clave 'branch' a config_site.php"
    AGREGO_BRANCH=1
fi

# index.php y getPlugin.php — el patrón exige los TRES `../` y el `/POSITIVEMEDIA` final,
# que es lo que distingue la línea a cambiar de la otra, la de '/../FullGlass'.
for par in "$INDEX:$NUEVO_INDEX" "$PLUGIN:$NUEVO_PLUGIN"; do
    sed -E "s@(/\.\./\.\./\.\./)[A-Za-z]+(/POSITIVEMEDIA)@\1$DIR_FG\2@g" \
        "${par%%:*}" > "${par##*:}" || morir "Falló la edición de ${par%%:*}"
done

igualar_salto_final "$CONFIG" "$NUEVO_CONFIG"
igualar_salto_final "$INDEX" "$NUEVO_INDEX"
igualar_salto_final "$PLUGIN" "$NUEVO_PLUGIN"

# ── 4. Verificar los temporales antes de pisar nada ──────────────────────────────────
# No se confía en que sed hizo lo que se le pidió: se lee el resultado.
verificar() {
    local archivo="$1" etiqueta="$2" obtenido
    obtenido=$(dir_de_include "$archivo")
    [ "$obtenido" = "$DIR_FG" ] || morir "$etiqueta quedó apuntando a «${obtenido:-nada}» en vez de «$DIR_FG». No se escribió nada."
}
verificar "$NUEVO_INDEX" "index.php"
verificar "$NUEVO_PLUGIN" "getPlugin.php"

TPL_NUEVO=$(sed -nE "/'backTemplatesDir'/ s@.*\.\./\.\./\.\./([A-Za-z]+)/adminFiles.*@\1@p" "$NUEVO_CONFIG" | head -1)
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

# Sintaxis de PHP. Si el servidor no tiene el binario, se sigue igual pero se dice.
if command -v php >/dev/null 2>&1; then
    for t in "$NUEVO_CONFIG" "$NUEVO_INDEX" "$NUEVO_PLUGIN"; do
        php -l "$t" >/dev/null 2>&1 || morir "El resultado de $(basename "$t") no compila como PHP. No se escribió nada."
    done
    echo "Sintaxis PHP verificada en los tres archivos."
else
    echo "Aviso: no hay binario «php» en el PATH, no se pudo verificar la sintaxis."
fi

if [ "$SECO" = 1 ]; then
    echo
    echo "Cambios que se aplicarían:"
    for par in "$CONFIG:$NUEVO_CONFIG" "$INDEX:$NUEVO_INDEX" "$PLUGIN:$NUEVO_PLUGIN"; do
        echo "--- ${par%%:*}"
        diff -u "${par%%:*}" "${par##*:}" | tail -n +3
    done
    echo
    echo "MODO PRUEBA: no se escribió nada."
    exit 0
fi

# ── 5. Escribir, con respaldo y con vuelta atrás ─────────────────────────────────────
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

for par in "$CONFIG:$NUEVO_CONFIG" "$INDEX:$NUEVO_INDEX" "$PLUGIN:$NUEVO_PLUGIN"; do
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

# ── 6. Releer y confirmar ────────────────────────────────────────────────────────────
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
[ "$AGREGO_BRANCH" = 1 ] && echo "Se AGREGÓ la clave 'branch' a config_site.php (no estaba)."
echo "Listo: $SITIO pasó de «${BRANCH_ACTUAL:-sin rama}» a «$RAMA»."
echo "  config_site.php      branch=$FINAL_BRANCH  backTemplatesDir=../../../$FINAL_TPL/adminFiles/templates/"
echo "  sitio/index.php      ../../../$FINAL_IDX/POSITIVEMEDIA"
echo "  sitio/getPlugin.php  ../../../$FINAL_PLG/POSITIVEMEDIA"
echo "Respaldos: *.bak-$SELLO (en la carpeta de cada archivo)."
