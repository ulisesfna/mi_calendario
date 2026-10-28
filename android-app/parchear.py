"""Paso 2 de la compilación del APK: adapta el proyecto Android que crea `npx cap add android`.

· Copia el código nativo de las alarmas (carpeta nativo/) y lo registra en el manifiesto.
· Permisos: notificaciones, alarmas exactas, arranque del móvil, batería.
· Icono, icono de notificación, pantalla de carga y sonido de alarma (generado aquí).
· Android 8 como mínimo y número de versión = número de compilación (BUILD).
"""
import glob
import json
import math
import os
import re
import shutil
import struct
import wave

AQUI = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(AQUI, 'android', 'app')
MAIN = os.path.join(APP, 'src', 'main')
RES = os.path.join(MAIN, 'res')
with open(os.path.join(AQUI, 'capacitor.config.json'), encoding='utf-8') as f:
    APP_ID = json.load(f)['appId']
BUILD = int(os.environ.get('BUILD') or 1)


def leer(ruta):
    with open(ruta, encoding='utf-8') as f:
        return f.read()


def escribir(ruta, texto):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write(texto)


def cambiar(ruta, patron, nuevo, obligatorio=True):
    texto = leer(ruta)
    texto2, n = re.subn(patron, nuevo, texto, count=1)
    if obligatorio and n == 0:
        raise SystemExit(f'{ruta}: no se encontró {patron!r}')
    escribir(ruta, texto2)


# ---------------- Código nativo ----------------

paquete = os.path.join(MAIN, 'java', *APP_ID.split('.'))
os.makedirs(paquete, exist_ok=True)
for java in glob.glob(os.path.join(AQUI, 'nativo', '*.java')):
    shutil.copy2(java, paquete)  # MainActivity.java sustituye a la de la plantilla

# ---------------- Manifiesto ----------------

manifiesto = os.path.join(MAIN, 'AndroidManifest.xml')
permisos = '''    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
</manifest>'''
receptor = f'''        <receiver android:name="{APP_ID}.AlarmaReceiver" android:exported="false">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" />
            </intent-filter>
        </receiver>
    </application>'''
cambiar(manifiesto, r'</application>', receptor)
cambiar(manifiesto, r'</manifest>\s*$', permisos)

# ---------------- Icono de la app (adaptable, dibujado como vector) ----------------


def rect(x, y, w, h, r=0):
    """Rectángulo (con esquinas redondeadas) como trazado de VectorDrawable"""
    if not r:
        return f'M{x},{y}h{w}v{h}h{-w}z'
    return (f'M{x + r},{y}h{w - 2 * r}a{r},{r} 0 0 1 {r},{r}v{h - 2 * r}a{r},{r} 0 0 1 {-r},{r}'
            f'h{-(w - 2 * r)}a{r},{r} 0 0 1 {-r},{-r}v{-(h - 2 * r)}a{r},{r} 0 0 1 {r},{-r}z')


# Mismas formas que icons/icon.svg (lienzo de 512)
FORMAS = [
    ('#FFFFFFFF', rect(104, 128, 304, 272, 36)),
    ('#FFFFD166', rect(104, 128, 304, 72, 36)),
    ('#FFFFD166', rect(104, 170, 304, 30)),
    ('#FFFFFFFF', rect(160, 96, 28, 64, 14)),
    ('#FFFFFFFF', rect(324, 96, 28, 64, 14)),
    ('#FFEF476F', rect(144, 236, 64, 44, 10)),
    ('#FF06D6A0', rect(224, 236, 64, 44, 10)),
    ('#FF118AB2', rect(304, 236, 64, 44, 10)),
    ('#FFC9C3F5', rect(144, 300, 64, 44, 10)),
    ('#FF7B61FF', rect(224, 300, 144, 44, 10)),
]
# El dibujo (x 104–408, y 96–400) cabe en la zona segura del icono adaptable (66 de 108 dp)
ESCALA = 0.165
DX, DY = 54 - 256 * ESCALA, 54 - 248 * ESCALA
caminos = '\n'.join(f'        <path android:fillColor="{c}" android:pathData="{d}" />' for c, d in FORMAS)
escribir(os.path.join(RES, 'drawable', 'ic_cal_frente.xml'), f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <group android:scaleX="{ESCALA}" android:scaleY="{ESCALA}" android:translateX="{DX:.2f}" android:translateY="{DY:.2f}">
{caminos}
    </group>
</vector>
''')
escribir(os.path.join(RES, 'drawable', 'ic_cal_fondo.xml'), '''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:pathData="M0,0h108v108h-108z">
        <aapt:attr name="android:fillColor">
            <gradient android:type="linear" android:startX="0" android:startY="0" android:endX="108" android:endY="108">
                <item android:offset="0" android:color="#FF7B61FF" />
                <item android:offset="1" android:color="#FF4338CA" />
            </gradient>
        </aapt:attr>
    </path>
</vector>
''')
adaptable = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_cal_fondo" />
    <foreground android:drawable="@drawable/ic_cal_frente" />
</adaptive-icon>
'''
for nombre in ('ic_launcher.xml', 'ic_launcher_round.xml'):
    escribir(os.path.join(RES, 'mipmap-anydpi-v26', nombre), adaptable)

# Icono de la barra de notificaciones (blanco: Android solo usa la silueta)
celdas = ''.join(rect(x, y, 3, 2.5, 0.5) for y in (11, 15) for x in (6.5, 10.5, 14.5))
escribir(os.path.join(RES, 'drawable', 'ic_stat_cal.xml'), f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:fillType="evenOdd" android:pathData="{rect(3, 4, 18, 17, 2)}{rect(5, 9, 14, 10)}" />
    <path android:fillColor="#FFFFFFFF" android:pathData="{rect(7, 2, 2, 5, 1)}{rect(15, 2, 2, 5, 1)}{celdas}" />
</vector>
''')

# Pantalla de carga: fondo morado con el calendario (en lugar del logo de Capacitor)
for png in glob.glob(os.path.join(RES, 'drawable*', 'splash.png')):
    os.remove(png)
escribir(os.path.join(RES, 'drawable', 'splash.xml'), '''<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@drawable/ic_cal_fondo" />
    <item android:drawable="@drawable/ic_cal_frente" android:gravity="center" android:width="200dp" android:height="200dp" />
</layer-list>
''')

# ---------------- Tema: sin dibujar bajo la barra de estado (Android 15) ----------------

estilos = os.path.join(RES, 'values', 'styles.xml')
for estilo in ('AppTheme.NoActionBar', 'AppTheme.NoActionBarLaunch'):
    cambiar(estilos, r'(<style name="' + re.escape(estilo) + r'"[^>]*>)',
            r'\1\n        <item name="android:windowOptOutEdgeToEdgeEnforcement">true</item>'
            r'\n        <item name="android:statusBarColor">#FF4338CA</item>')

# ---------------- Sonido de alarma (pitidos en dos tonos, Android lo repite) ----------------


def sonido_alarma(ruta, frecuencia=22050):
    muestras = []

    def tono(f, seg, vol=0.8):
        n = int(seg * frecuencia)
        fundido = int(0.006 * frecuencia)
        for i in range(n):
            env = min(1, i / fundido, (n - i) / fundido)
            t = i / frecuencia
            # Seno con algo de armónicos: se oye más que un seno puro sin ser estridente
            v = math.sin(2 * math.pi * f * t) + 0.3 * math.sin(6 * math.pi * f * t) + 0.15 * math.sin(10 * math.pi * f * t)
            muestras.append(vol * env * v / 1.45)

    def silencio(seg):
        muestras.extend([0.0] * int(seg * frecuencia))

    for _ in range(2):
        for _ in range(4):
            tono(988, 0.14)
            silencio(0.04)
            tono(1319, 0.14)
            silencio(0.04)
        silencio(0.5)
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with wave.open(ruta, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(frecuencia)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32767)) for s in muestras))


sonido_alarma(os.path.join(RES, 'raw', 'alarma.wav'))

# ---------------- Versión y Android mínimo ----------------

cambiar(os.path.join(AQUI, 'android', 'variables.gradle'), r'minSdkVersion\s*=\s*\d+', 'minSdkVersion = 26')
gradle = os.path.join(APP, 'build.gradle')
cambiar(gradle, r'versionCode\s+\d+', f'versionCode {BUILD}')
cambiar(gradle, r'versionName\s+"[^"]*"', f'versionName "1.{BUILD}"')

# Firma: siempre con la misma llave (si cambia, Android no deja actualizar encima)
llave = os.environ.get('KEYSTORE_FILE')
if llave:
    firma = f'''android {{
    signingConfigs {{
        debug {{
            storeFile file({json.dumps(llave)})
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }}
    }}'''
    cambiar(gradle, r'android\s*\{', firma.replace('\\', '\\\\'))

print('Proyecto Android adaptado (versión', BUILD, ')')
