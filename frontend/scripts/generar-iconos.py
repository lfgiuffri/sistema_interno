"""
Genera TODO el juego de iconos de la app desde el logo de la empresa.

    cd frontend && python3 scripts/generar-iconos.py     (requiere Pillow)

Si cambia el logo, se corre esto y se regeneran los 12 archivos de una: hacerlos a mano es
tedioso y se termina con tamaños desparejos o alguno viejo colgado.

Hay DOS familias de iconos y la diferencia no es cosmética:

  · `icon-*`, `favicon.svg`, `favicon.ico` → fondo TRANSPARENTE.
    Se ven sobre la pestaña del navegador, que puede ser clara u oscura.

  · `pwa-*`, `apple-touch-icon` → fondo BLANCO.
    iOS NO soporta transparencia: si el fondo es transparente, lo pinta de negro.

  · `pwa-512-maskable` → además, 18% de margen.
    Android recorta el icono con una máscara (círculo, cuadrado redondeado) y la zona segura
    es el 80% central. Ese margen solo hace falta en el icono `maskable`: aplicárselo también
    al normal lo deja innecesariamente chico en los lugares que NO recortan.

OJO con el margen: este logo es ALTO y angosto (un vaso). Al centrarlo en un cuadrado, la
altura es la que manda, así que cada punto de margen se nota el doble que con un logo
cuadrado. Los valores de acá están elegidos para que se vea grande sin que la máscara lo corte.

El `favicon.svg` se genera embebiendo el PNG en base64. Suena raro, pero el navegador PREFIERE
el SVG a los PNG del `<link>`: si queda un SVG viejo, es el que se ve y el logo nuevo no
aparece nunca. Generándolo desde la misma fuente, no puede quedar desfasado.
"""
import base64
import os

from PIL import Image

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ORIGEN = os.path.join(RAIZ, 'public', 'vaso 300x300.png')
DESTINO = os.path.join(RAIZ, 'public', 'icons')
BLANCO = (255, 255, 255, 255)

src = Image.open(ORIGEN).convert('RGBA')
# Recorte a lo que realmente ocupa el dibujo: si el original trae aire alrededor, sin recortar
# el logo queda chico dentro de cada icono.
logo = src.crop(src.getbbox())
print(f'origen {src.size} → dibujo {logo.size}')


def encajar(tam, margen, fondo=None):
    """
    Centra el logo en un lienzo cuadrado.

    :param tam: lado del icono en px.
    :param margen: aire a cada lado, como fracción del lado (0.18 = 18%).
    :param fondo: color de fondo RGBA, o None para transparente.
    """
    lienzo = Image.new('RGBA', (tam, tam), fondo or (0, 0, 0, 0))
    util = int(tam * (1 - margen * 2))
    w, h = logo.size
    escala = min(util / w, util / h)
    nuevo = logo.resize((max(1, int(w * escala)), max(1, int(h * escala))), Image.LANCZOS)
    lienzo.paste(nuevo, ((tam - nuevo.width) // 2, (tam - nuevo.height) // 2), nuevo)
    return lienzo


os.makedirs(DESTINO, exist_ok=True)

for tam in (16, 32, 48, 64, 96, 192, 512):
    encajar(tam, 0.02).save(f'{DESTINO}/icon-{tam}.png')
    print(f'  icon-{tam}.png')

# Iconos de la app instalada: sin recorte, así que van casi al borde.
for tam in (192, 512):
    encajar(tam, 0.05, BLANCO).save(f'{DESTINO}/pwa-{tam}.png')
    print(f'  pwa-{tam}.png  (fondo blanco, al borde)')

# El único que necesita margen: Android le aplica máscara.
encajar(512, 0.18, BLANCO).save(f'{DESTINO}/pwa-512-maskable.png')
print('  pwa-512-maskable.png  (margen del 18% para el recorte de Android)')

encajar(180, 0.06, BLANCO).save(f'{DESTINO}/apple-touch-icon.png')
print('  apple-touch-icon.png  (fondo blanco: iOS no soporta transparencia)')

encajar(128, 0.0).save(f'{DESTINO}/logo.png')
print('  logo.png  (marca de la barra lateral, sin margen: la caja ya tiene el suyo)')

encajar(48, 0.06).save(
    os.path.join(RAIZ, 'public', 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)],
)
print('  favicon.ico')

b64 = base64.b64encode(open(f'{DESTINO}/icon-192.png', 'rb').read()).decode()
with open(os.path.join(RAIZ, 'public', 'favicon.svg'), 'w') as f:
    f.write(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192"'
        ' role="img" aria-label="Positive Media">\n'
        f'  <image href="data:image/png;base64,{b64}" width="192" height="192"/>\n'
        '</svg>\n'
    )
print('  favicon.svg  (PNG embebido: le gana a los <link> PNG, así que tiene que ser este logo)')
