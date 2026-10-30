# Mi calendario

Calendario personal con **eventos, tareas y planning**, categorías fáciles de crear,
avisos de varias intensidades, importación de horarios de Chronos (UB) y
**sincronización cifrada** entre dispositivos a través de tu propio servidor gratuito (Cloudflare).
Es una app web instalable (PWA) para el ordenador y, en Android, una **app propia (APK)** con alarmas de verdad.

---

## 1. Publicarla en GitHub Pages (para tenerla en el móvil)

No hace falta instalar Git: todo se hace desde la web de GitHub.

1. En <https://github.com/new> crea un repositorio, por ejemplo **`calendario`** (público).
2. En la página del repositorio vacío pulsa **«uploading an existing file»**.
3. Abre esta carpeta en el Explorador, selecciona **todo su contenido** (menos la carpeta `.claude`
   y `Abrir calendario.bat`, que solo sirven en el PC) y **arrástralo** a la página. Pulsa **Commit changes**.
   - Las carpetas `css`, `js`, `icons` deben quedar dentro (GitHub las sube al arrastrarlas).
   - El archivo `.nojekyll` es opcional: la web de GitHub no deja subir archivos que empiezan por punto, y no pasa nada.
4. **Settings → Pages** → *Source*: **Deploy from a branch** → Branch **main** / **(root)** → **Save**.
5. Al minuto estará en **`https://TU-USUARIO.github.io/calendario/`**.

**Para actualizarla más adelante:** vuelve a subir los archivos cambiados (*Add file → Upload files*).
El móvil coge la versión nueva al abrir la app (a veces hace falta cerrarla y abrirla dos veces).

## 2. Instalarla como aplicación

- **Android:** la **app propia (APK)**, ver el apartado 5. Las alarmas las programa el propio móvil, así que
  suenan con la app cerrada, sin internet y sin depender de Chrome.
- **PC:** en Chrome/Edge, el icono de instalar de la barra de direcciones.
- **iPhone (Safari):** botón **Compartir** → **Añadir a pantalla de inicio**.

### Pasar los datos que ya tienes en el PC

Los datos de `http://localhost:8765` no se mueven solos a la nueva dirección. Dos opciones:

- **Con la sincronización** (recomendado, ver abajo): conéctala en el PC y después en los demás dispositivos.
- **Con una copia:** en el PC *Ajustes → Copia de seguridad (.json)* y en la nueva *Ajustes → Restaurar copia*.

## 3. Sincronización entre dispositivos (cifrada)

**Cómo funciona (no hay que hacer nada de esto, es para que sepas qué pasa)**

Piensa en una **caja con candado** guardada en tu servidor de Cloudflare (el del apartado 4):

- **El servidor** es el sitio donde se guarda la caja para que todos tus dispositivos la encuentren.
- **La contraseña de sincronización** es la llave del candado. Te la inventas en la app la primera vez.
  El servidor guarda la caja pero **no tiene la llave**, así que solo ve datos ilegibles. Con la contraseña
  se encuentra también tu caja: sin ella nadie puede ni encontrarla ni sobrescribirla.
- En cada dispositivo la escribes **una sola vez** (la misma en todos); después se sincroniza sola: al abrir la app,
  unos segundos después de cada cambio y cada 3 minutos. Si cambias cosas en dos dispositivos, se juntan
  (gana el cambio más reciente de cada elemento; lo borrado se borra en todos).
- ⚠️ **Apunta la contraseña en un sitio seguro.** Si la olvidas, lo guardado en el servidor no se puede abrir
  (ni Cloudflare ni nadie). Lo que tengas en tus dispositivos sí se mantiene.

*Detalle técnico:* cifrado AES-256-GCM con una clave derivada de la contraseña (PBKDF2-SHA256, 600 000 iteraciones);
la clave queda guardada en cada dispositivo de forma que ni la propia app puede extraerla.

**Usarla:** *Ajustes → Sincronización → Conectar* → escribe tu contraseña. Si es la primera vez, te pide repetirla
para crear la copia. En cada otro dispositivo, **la misma contraseña**: si no coincide, la app te avisa
de que no hay datos con esa contraseña (pulsa *Cancelar* y revisa cómo la escribiste).

Necesita el servidor del apartado 4 con el **`worker.js` actual** (*Edit code* → pegar → *Deploy*).
La dirección del servidor ya viene puesta en `js/config.js`.

> Antes la sincronización usaba Google Drive. Ya no hace falta nada de Google Cloud: si la tenías conectada,
> la app te pedirá conectar de nuevo; usa tu contraseña de cifrado de siempre (o una nueva) en todos los dispositivos.

## 4. Tu servidor (Cloudflare): sincronización y avisos en el navegador

Una app web no puede ejecutarse estando cerrada. Para que los avisos lleguen igualmente, un servidor
gratuito manda un «toque» (Web Push) al móvil a la hora de cada aviso; el móvil despierta la app un instante,
descifra el aviso y lo muestra.

**Privacidad:** el servidor solo guarda la **hora** de cada aviso y su texto **cifrado** con tu clave
(la de la sincronización, o una propia del dispositivo). No puede leer títulos ni nada de tu calendario.
Si usas la sincronización, tus dispositivos comparten los avisos: lo que cambies en la tablet avisará también al móvil.

**Crear el servidor (una vez, ~10 minutos, gratis, todo desde la web):**

Son tres piezas: el **Worker** (el código), un **espacio KV** (el almacén) y el **enlace** entre ambos.

1. Crea una cuenta en <https://dash.cloudflare.com/sign-up> (plan **Free**).
2. **Workers & Pages → Create application** → (pestaña *Workers*) **Start with Hello World!** → ponle nombre
   (p. ej. `calendario-avisos`) → **Deploy**.
3. En el Worker: **Edit code** → borra todo, pega el contenido de **`servidor-avisos/worker.js`** → **Deploy**.
4. **Storage & Databases → KV → Create** → cualquier nombre (p. ej. `KV`) → crear.
5. Vuelve al **Worker** → pestaña **Bindings → Add binding → KV namespace** → *Variable name*: **`KV`**
   (exactamente así) → elige el espacio KV del paso 4 → **Add binding** (se publica solo, no hay botón «Deploy»).
6. En el Worker → **Settings → Trigger Events → Add → Cron Triggers** → expresión **`* * * * *`** (cada minuto) → **Add**.
7. Comprueba: abre `https://TU-WORKER.TU-USUARIO.workers.dev/vapid` en el navegador.
   - `{"publicKey":"B…"}` → todo bien.
   - «Falta enlazar el espacio KV…» → revisa el paso 5 (la variable debe llamarse `KV`).
   - «Hello World» → falta el paso 3.

**Activarlo en cada dispositivo:** *Ajustes → Avisos → 📲 Avisos con la app cerrada* → pega la dirección → **Activar**
(acepta el permiso de notificaciones). Pulsa **Enviar prueba**, cierra la app y espera 1–2 minutos.
También puedes poner la dirección en `js/config.js` (`PUSH_SERVER_URL`) para no escribirla en cada dispositivo.

**En Xiaomi**, para que el sistema no retrase los avisos: *Ajustes → Aplicaciones → Chrome →
Ahorro de batería → Sin restricciones* y activa **Inicio automático**.

**Cómo suenan con la app cerrada:** Android usa el sonido y la vibración de las notificaciones de Chrome
(se cambian en *Ajustes del móvil → Aplicaciones → Chrome → Notificaciones*). 🔕 Visual llega en silencio;
⏰ Alarma y 🚨 Persistente se quedan fijas en pantalla, y la persistente **se repite cada pocos minutos**
(hasta 1 hora) hasta que pulses *Parar* o la quites. Con la app abierta, cada nivel suena como lo configuraste.
La precisión es de ±1 minuto. Los avisos se programan para los próximos 30 días y la lista se renueva cada vez
que abres o cierras la app, o cambias algo.

*(Esto es para la versión web. En el móvil Android, mejor la app propia del apartado 5, que no necesita nada de esto.)*

## 5. App de Android (APK)

GitHub fabrica la app sola cada vez que subes cambios y la deja en **Releases**. Enlace fijo de descarga:
**`https://github.com/TU-USUARIO/TU-REPOSITORIO/releases/latest/download/Calendario.apk`**

**Preparación (una sola vez)**

1. Sube a GitHub todo como siempre, **incluida la carpeta `android-app`**.
2. **La llave de firma** (para que cada versión nueva se instale encima de la anterior conservando tus datos):
   en el repositorio → **Settings → Secrets and variables → Actions → New repository secret** →
   *Name*: **`APK_KEYSTORE`** → *Secret*: pega el contenido de **`llave-apk/APK_KEYSTORE.txt`** → **Add secret**.
   - ⚠️ La carpeta `llave-apk` **no se sube a GitHub** y conviene guardarla (por ejemplo en un pendrive):
     si se pierde, las versiones nuevas no se podrán instalar encima (habría que desinstalar y volver a sincronizar).
3. **El fabricante:** en el repositorio → **Add file → Create new file** → como nombre escribe exactamente
   **`.github/workflows/apk.yml`** (al escribir las barras se crean las carpetas) → pega el contenido de
   **`android-app/apk.yml`** → **Commit changes**.
4. Pestaña **Actions**: verás «App Android (APK)» trabajando (~5 minutos). Cuando salga ✅, el APK está en **Releases**.
   Si sale ❌, entra, abre el paso en rojo y haz una captura.

**Instalarla en el móvil**

1. En el móvil, abre el enlace de descarga (o *Ajustes → Instalar* en la versión web) → se descarga `Calendario.apk`.
2. Ábrelo. Android pedirá permitir **instalar apps de esta fuente** (Chrome) → permitir → **Instalar**.
   Si Play Protect avisa de una app desconocida → *Más detalles* → **Instalar de todas formas**.
3. Abre la app → acepta el permiso de **notificaciones** → *Ajustes → Sincronización → Conectar* con tu contraseña.
4. *Ajustes → Avisos → 📲 Alarmas del móvil*: comprueba que todo esté en ✅ y, en Xiaomi, activa
   **Inicio automático** y **Ahorro de batería → Sin restricciones** (botón *Abrir la ficha de la app*).
   Pulsa **Probar con la app cerrada**, cierra la app y bloquea el móvil: al minuto debe sonar la alarma.
5. Si tenías la versión web instalada en el móvil, **desactiva allí los avisos** (*Ajustes → Avisos → Desactivar*)
   y desinstálala, para no recibir cada aviso dos veces.

**Cómo suenan:** 🔕 Visual llega en silencio, 📳 solo vibra, 🔔 suena una vez (con el volumen de notificaciones,
así que en modo vibración solo vibra, salvo que marques *Que suenen aunque el móvil esté en silencio*).
⏰ Alarma suena (aunque el móvil esté en silencio) durante 3 minutos o hasta que la toques; 🚨 Persistente igual, se queda fija y
**se repite cada pocos minutos** (hasta 1 hora) hasta que pulses **Parar**. *Posponer 10 min* y *Parar* funcionan
desde la notificación sin abrir la app. Tras reiniciar el móvil las alarmas se vuelven a programar solas.
El sonido y el volumen se eligen en *Ajustes → Avisos* (sonidos propios, la alarma del móvil o cualquier tono suyo).
Con **volumen propio**, la app pone el volumen de alarma del móvil a ese nivel mientras suena y luego lo deja como estaba.

**Límites:** el móvil programa los avisos de los próximos 45 días cada vez que abres la app o cambias algo.
Lo que cambies en **otro** dispositivo llega al móvil cuando abras la app en él (al abrirla se sincroniza).

**Actualizar:** sube los archivos cambiados a GitHub como siempre. En ~5 minutos hay APK nuevo, y la app te avisa
(«Hay una versión nueva → Descargar»); también en *Ajustes → Versión de la app → Buscar actualización*.
Se instala encima y **tus datos se conservan**.

---

## Usarla solo en el PC

Doble clic en **`Abrir calendario.bat`** (usa Python). Se abre `http://localhost:8765`.

## Qué incluye

| Función | Dónde está |
|---|---|
| Crear categorías fácil | Barra lateral → **＋**, nombre y Enter (color automático). También desde el editor o con `#Nombre` en «Añadir rápido». Subcategorías plegables, icono, tipo y duración por defecto. |
| Personalizar tareas | Prioridad, subtareas, fecha límite, icono, color, tono y avisos propios. |
| Duración de las tareas | Por defecto **∞ sin fin**: empieza a una hora y queda «en curso» hasta completarla. Botones rápidos **1 h / 1 día / 1 semana / 1 mes** o fecha de fin a mano. Las de un día o más se ven como barra en «todo el día». |
| Avisos de las tareas | Por defecto **a la hora en que empiezan** (*Ajustes → Avisos → Avisos de las tareas*). En el editor, los botones «a la hora» van primero; también se pueden poner avisos antes. |
| Tareas pendientes | Las vencidas sin completar (⚠) y las «sin fin» de días anteriores (∞) se muestran **hoy** en el calendario y en **Agenda → ⏳ Pendientes** y **Planning → ⏳ Pendientes**, con botones *Hoy / Mañana*, hasta que las completes. Se puede desactivar en el menú 👁. |
| Plannings en la agenda | Al crear un planning ya lleva **una sesión programada** (desde la próxima media hora, 1 h), así sale en el calendario y en Agenda. Al **acabar cada sesión** avisa con 🔔 vibración + sonido (*Ajustes → Avisos → Avisos de los plannings*; también «5 min antes de acabar», etc.). |
| **Planning** | Pasos con fecha opcional, fecha objetivo, progreso, sesiones recurrentes. Vista **Planning** agrupada por categoría. Encima de una clase se ve sólido y la clase de debajo translúcida; si dos plannings se solapan, ⚠. |
| Mover antes / después | Ficha del evento: **−1 día / −1 h / −15′ / +15′ / +1 h / +1 día**, flechas del teclado, arrastrar (en el móvil, mantener pulsado). Solo esta / esta y siguientes / toda la serie. |
| Avisos | Antelación libre y 5 niveles: 🔕 visual, 📳 vibración, 🔔 sonido, ⏰ alarma, 🚨 persistente. |
| Exámenes | Los exámenes (EXAM de Chronos, o la casilla «📝 Es un examen» del editor) avisan solos: 🔔 2 semanas y 1 semana antes y ⏰ alarma 1 h 30 min antes. Se cambia en *Ajustes → Avisos → Avisos de los exámenes*; un examen con avisos propios los conserva. |
| Colores | 96 tonos, neutros, 10 paletas, recientes, color libre y tonos por tipo de clase. |
| Importar Chronos | TEORIA / TEOPR / PROB / EXAM y los grupos cuentan como una sola asignatura, cada tipo con su tono. Para importaciones antiguas: ⋯ del grupo → **🧩 Unir asignaturas repetidas**. |
| Navegación | Día / 3 días / Semana / Mes / Agenda / Planning. Deslizar para cambiar de periodo (de arriba abajo en Mes). Botón 👁 para mostrar u ocultar eventos, tareas y plannings. |
| Repeticiones | Cada N días/semanas/meses/años, varios días, «2.º martes» / «último viernes», hasta fecha o N veces, fechas concretas, días y periodos excluidos. |
| Agenda sí / no | 📅/🚫 en cada elemento o por categoría. Fuera de agenda: sin avisos automáticos ni vista Agenda; en Mes, como línea fina. |
| Extra | Añadir rápido en lenguaje natural, acciones en bloque por categoría, festivos, deshacer (Ctrl+Z), modo oscuro, exportar a `.ics`. |

## Estructura

```
index.html, css/app.css, sw.js, manifest.webmanifest, icons/, .nojekyll
js/config.js       dirección de tu servidor (Cloudflare Worker)
js/app.js          arranque, navegación, atajos, gestos, añadir rápido
js/store.js        datos, guardado, deshacer y marcas de tiempo para sincronizar
js/server.js       conexión con tu servidor
js/sync.js         cifrado + sincronización + fusión
js/push.js         avisos con la app cerrada en el navegador (sube la lista cifrada al servidor)
js/native.js       app de Android: alarmas del móvil, botón atrás, versiones nuevas
android-app/       cómo se fabrica el APK (lo usa GitHub): código nativo de las alarmas (nativo/) y scripts
android-app/apk.yml  copia del fabricante, para pegarlo en .github/workflows/apk.yml
llave-apk/         llave de firma del APK: NO subir a GitHub, guardar en sitio seguro
servidor-avisos/   código del servidor (Cloudflare Worker); no hace falta subirlo a GitHub
js/engine.js       repeticiones → apariciones, mover / borrar / completar
js/recurrence.js   reglas de repetición
js/notify.js       avisos, sonidos y alarmas
js/ics.js          leer/escribir .ics e importar horarios
js/quickadd.js     lenguaje natural
js/views/          vistas (horas, mes, agenda, planning)
js/ui/             editor, ficha, categorías, importador, ajustes, sincronización
```
