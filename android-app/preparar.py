"""Paso 1 de la compilación del APK: copia la app web a www/ (lo que va dentro del APK).

Lo ejecuta GitHub Actions desde esta carpeta (android-app). Variables de entorno opcionales:
  BUILD  número de compilación (sale en Ajustes y sirve para avisar de versiones nuevas)
  REPO   usuario/repositorio de GitHub donde se publican los APK
"""
import datetime
import json
import os
import shutil

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
WWW = os.path.join(AQUI, 'www')

shutil.rmtree(WWW, ignore_errors=True)
os.makedirs(WWW)
for nombre in ('index.html', 'manifest.webmanifest'):
    shutil.copy2(os.path.join(RAIZ, nombre), WWW)
for carpeta in ('css', 'js', 'icons'):
    shutil.copytree(os.path.join(RAIZ, carpeta), os.path.join(WWW, carpeta))

# Núcleo de Capacitor (registerPlugin) para usar los plugins nativos sin empaquetador
nucleo = os.path.join(AQUI, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js')
shutil.copy2(nucleo, os.path.join(WWW, 'capacitor.js'))

index = os.path.join(WWW, 'index.html')
with open(index, encoding='utf-8') as f:
    html = f.read()
marca = '<script type="module"'
if marca not in html:
    raise SystemExit('index.html: no se encuentra el script principal')
html = html.replace(marca, '<script src="capacitor.js"></script>\n  ' + marca, 1)
with open(index, 'w', encoding='utf-8') as f:
    f.write(html)

info = {
    'build': int(os.environ.get('BUILD') or 0),
    'repo': os.environ.get('REPO', ''),
    'date': datetime.date.today().strftime('%d/%m/%Y'),
}
with open(os.path.join(WWW, 'apk-version.json'), 'w', encoding='utf-8') as f:
    json.dump(info, f)
print('www listo:', info)
