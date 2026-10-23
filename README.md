# Mi calendario

Calendario personal con **eventos, tareas y planning**, categorías fáciles de crear,
avisos de varias intensidades, importación de horarios de Chronos (UB) y
**sincronización cifrada** entre dispositivos con tu cuenta de Google.
Es una app web instalable (PWA): funciona en el ordenador y en el móvil, también sin conexión.

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

- **Android (Chrome):** abre la dirección de GitHub Pages → menú **⋮** → **Instalar aplicación**
  (o el botón **📲 Instalar** de la barra lateral). Queda con su icono, a pantalla completa y funciona sin conexión.
- **iPhone (Safari):** botón **Compartir** → **Añadir a pantalla de inicio**.
- **PC:** en Chrome/Edge, el icono de instalar de la barra de direcciones.
- **APK de Android (opcional):** en <https://www.pwabuilder.com> pega la dirección de GitHub Pages
  → *Package for stores* → **Android** → descarga el `.apk`/`.aab` (sirve para instalarla o subirla a Google Play).

### Pasar los datos que ya tienes en el PC

Los datos de `http://localhost:8765` no se mueven solos a la nueva dirección. Dos opciones:

- **Con la sincronización** (recomendado, ver abajo): conéctala primero en el PC (añadiendo también
  `http://localhost:8765` como origen autorizado) y después en la versión de GitHub y en el móvil.
- **Con una copia:** en el PC *Ajustes → Copia de seguridad (.json)* y en la nueva *Ajustes → Restaurar copia*.

## 3. Sincronización entre dispositivos (cifrada)

**Cómo funciona (no hay que hacer nada de esto, es para que sepas qué pasa)**

Piensa en una **caja con candado** guardada en un cajón de Google:

- **Tu cuenta de Google** es el cajón: el sitio donde se guarda la caja para que todos tus dispositivos la encuentren.
  Se guarda en una carpeta oculta de tu Google Drive (no aparece en «Mi unidad»), y la app no puede ver ningún otro archivo tuyo.
- **La contraseña de cifrado** es la llave del candado. **No es tu contraseña de Google**: es otra que te inventas en la app
  la primera vez. Google guarda la caja pero **no tiene la llave**, así que solo ve datos ilegibles.
- En cada dispositivo la escribes **una sola vez** (la misma en todos); después se sincroniza sola: al abrir la app,
  unos segundos después de cada cambio y cada 3 minutos. Si cambias cosas en dos dispositivos, se juntan
  (gana el cambio más reciente de cada elemento; lo borrado se borra en todos).
- ⚠️ **Apunta la contraseña de cifrado en un sitio seguro.** Si la olvidas, lo guardado en la nube no se puede abrir
  (ni Google ni nadie). Lo que tengas en tus dispositivos sí se mantiene.

*Detalle técnico:* cifrado AES-256-GCM con una clave derivada de la contraseña (PBKDF2-SHA256, 600 000 iteraciones);
la clave queda guardada en cada dispositivo de forma que ni la propia app puede extraerla.

**Puesta en marcha (una sola vez, ~10 minutos, gratis)**

Google exige que cada app tenga su propio «ID de cliente»:

1. Entra en <https://console.cloud.google.com/> → selector de proyectos → **Proyecto nuevo** → «Mi calendario».
2. **APIs y servicios → Biblioteca** → busca **Google Drive API** → **Habilitar**.
3. **Google Auth Platform** (o *Pantalla de consentimiento de OAuth*) → **Empezar**:
   nombre de la app, tu correo, audiencia **Externa** → Crear.
4. **Audiencia → Usuarios de prueba → Añadir usuarios** → tu Gmail (y el de quien quieras que la use).
5. **Acceso a los datos → Añadir o quitar permisos** → marca `.../auth/drive.appdata`, `openid` y `email` → Guardar.
6. **Clientes → Crear cliente** → tipo **Aplicación web** → en **Orígenes de JavaScript autorizados** añade:
   - `https://TU-USUARIO.github.io`
   - `http://localhost:8765` (para usarla también en el PC con el `.bat`)
7. Copia el **ID de cliente** (acaba en `.apps.googleusercontent.com`) y pégalo en **`js/config.js`**
   antes de subir a GitHub (así sirve para todos tus dispositivos). También se puede pegar en *Ajustes → Sincronización*.

**Usarla:** *Ajustes → Sincronización → Conectar con Google* → eliges la cuenta → creas la contraseña de cifrado.
En cada otro dispositivo, lo mismo con **la misma contraseña**.

**Notas**

- Por seguridad, Google da sesiones de 1 hora. Si al abrir la app pone **«☁️ Toca para sincronizar»**,
  un toque basta (la ventana de Google se abre y se cierra sola).
- Mientras el proyecto de Google está «en prueba», Google puede pedirte que vuelvas a aceptar los permisos cada pocos días.
- En iPhone, si el inicio de sesión no vuelve a la app instalada, sincroniza una vez desde Safari.

## 4. Avisos con la app cerrada (Android)

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
js/config.js       ID de cliente de Google (para la sincronización)
js/app.js          arranque, navegación, atajos, gestos, añadir rápido
js/store.js        datos, guardado, deshacer y marcas de tiempo para sincronizar
js/sync.js         cifrado + Google Drive + fusión
js/push.js         avisos con la app cerrada (sube la lista cifrada al servidor de avisos)
servidor-avisos/   código del servidor de avisos (Cloudflare Worker); no hace falta subirlo a GitHub
js/engine.js       repeticiones → apariciones, mover / borrar / completar
js/recurrence.js   reglas de repetición
js/notify.js       avisos, sonidos y alarmas
js/ics.js          leer/escribir .ics e importar horarios
js/quickadd.js     lenguaje natural
js/views/          vistas (horas, mes, agenda, planning)
js/ui/             editor, ficha, categorías, importador, ajustes, sincronización
```
