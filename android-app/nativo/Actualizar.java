package io.github.ulisesfna.calendario;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.os.Build;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;

/**
 * Actualizaciones sin pasar por el navegador.
 *
 * · Web (casi todas): la app web (HTML/JS/CSS) se descarga de GitHub (web.zip de la última versión
 *   publicada) a una carpeta propia y Capacitor la sirve desde ahí en vez de la que trae el APK.
 *   Solo si la parte nativa es la misma (Version.NATIVO). Si una versión descargada no llega a
 *   arrancar (la app no llama a webOk), al abrir la app otra vez se vuelve sola a la del APK.
 *   Al instalar un APK nuevo, Capacitor vuelve a usar la web que lleva dentro (y aquí se limpia todo).
 * · Nativa (pocas): el APK se descarga desde la app y se instala con el instalador de Android.
 */
final class Actualizar {

    static final String INSTALADA = "io.github.ulisesfna.calendario.INSTALADA";
    private static final String BASE = "https://github.com/" + Version.REPO + "/releases/";
    private static final String PREFS = "actualizar";
    // Donde Capacitor guarda la carpeta desde la que sirve la web (com.getcapacitor.plugin.WebView)
    private static final String CAP_PREFS = "CapWebViewSettings";
    private static final String CAP_RUTA = "serverBasePath";
    private static final String CANAL = "cal-app";
    private static final int MAX_WEB = 30 * 1024 * 1024;
    private static final int MAX_APK = 200 * 1024 * 1024;

    interface Progreso {
        void pct(int p);
    }

    private Actualizar() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SharedPreferences capPrefs(Context ctx) {
        return ctx.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE);
    }

    static File carpetaWeb(Context ctx) {
        return new File(ctx.getFilesDir(), "web");
    }

    static File carpetaDe(Context ctx, int build) {
        return new File(carpetaWeb(ctx), "v" + build);
    }

    @SuppressWarnings("deprecation")
    static int versionApk(Context ctx) {
        try {
            PackageInfo p = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? (int) p.getLongVersionCode() : p.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    /** Versión de la web que se está usando: la descargada (si es la que sirve Capacitor) o la del APK */
    static int webActual(Context ctx, String rutaServida) {
        int activo = prefs(ctx).getInt("activo", 0);
        if (activo > 0 && rutaServida != null && rutaServida.equals(carpetaDe(ctx, activo).getAbsolutePath())) return activo;
        return versionApk(ctx);
    }

    // ---------------- Al abrir la app (antes de que Capacitor cargue la web) ----------------

    static void alArrancar(Context ctx) {
        SharedPreferences p = prefs(ctx);
        int apk = versionApk(ctx);
        // APK nuevo: trae su propia web (Capacitor ya deja de usar la descargada); empezar de cero
        if (p.getInt("apk", -1) != apk) {
            p.edit().clear().putInt("apk", apk).commit();
            borrar(carpetaWeb(ctx));
            return;
        }
        int prueba = p.getInt("prueba", 0);
        if (prueba != 0) {
            // La última versión aplicada no confirmó que arranca bien: volver a la del APK
            capPrefs(ctx).edit().putString(CAP_RUTA, "").commit();
            p.edit().remove("prueba").remove("activo").putInt("mala", prueba).commit();
        } else {
            int listo = p.getInt("listo", 0);
            if (listo > 0 && listo != p.getInt("mala", 0) && listo > webActual(ctx, capPrefs(ctx).getString(CAP_RUTA, ""))
                && Version.NATIVO.equals(p.getString("listoNativo", "")) && new File(carpetaDe(ctx, listo), "index.html").exists()) {
                usar(ctx, listo);
            }
        }
        limpiar(ctx);
    }

    /** Deja preparada la versión para que Capacitor la sirva (la confirma webOk) */
    static String usar(Context ctx, int build) {
        String ruta = carpetaDe(ctx, build).getAbsolutePath();
        capPrefs(ctx).edit().putString(CAP_RUTA, ruta).commit();
        prefs(ctx).edit().putInt("activo", build).putInt("prueba", build).remove("listo").remove("listoNativo").commit();
        return ruta;
    }

    /** La web ha arrancado bien */
    static void webOk(Context ctx) {
        prefs(ctx).edit().remove("prueba").commit();
    }

    /** Borra las versiones descargadas que ya no se usan */
    private static void limpiar(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String activo = "v" + p.getInt("activo", 0), listo = "v" + p.getInt("listo", 0);
        File[] l = carpetaWeb(ctx).listFiles();
        if (l == null) return;
        for (File f : l) if (!f.getName().equals(activo) && !f.getName().equals(listo)) borrar(f);
    }

    private static void borrar(File f) {
        File[] hijos = f.listFiles();
        if (hijos != null) for (File h : hijos) borrar(h);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    // ---------------- Red ----------------

    private static HttpURLConnection abrir(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(true); // github.com → servidor de descargas (los dos https)
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent", "MiCalendario-Android");
        c.setUseCaches(false);
        int code = c.getResponseCode();
        if (code != 200) {
            c.disconnect();
            throw new IOException(code == 404 ? "No hay ninguna versión publicada" : "GitHub respondió " + code);
        }
        return c;
    }

    /** Descarga a un archivo y devuelve su SHA-256 (hex) */
    private static String bajar(String url, File destino, int max, Progreso pr) throws IOException {
        HttpURLConnection c = abrir(url);
        try {
            long total = c.getContentLengthLong();
            if (total > max) throw new IOException("Archivo demasiado grande");
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(destino)) {
                byte[] buf = new byte[64 * 1024];
                long leido = 0;
                int n, ultimo = -1;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    md.update(buf, 0, n);
                    leido += n;
                    if (leido > max) throw new IOException("Archivo demasiado grande");
                    if (pr != null && total > 0) {
                        int pct = (int) (leido * 100 / total);
                        if (pct != ultimo) pr.pct(ultimo = pct);
                    }
                }
            }
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException(e);
        } finally {
            c.disconnect();
        }
    }

    /** version.json de la última versión publicada: { build, nativo, web (sha256 de web.zip), apk } */
    static JSONObject buscar() throws Exception {
        HttpURLConnection c = abrir(BASE + "latest/download/version.json");
        try (InputStream in = c.getInputStream()) {
            byte[] buf = new byte[8192];
            StringBuilder sb = new StringBuilder();
            int n;
            while ((n = in.read(buf)) > 0 && sb.length() < 64 * 1024) sb.append(new String(buf, 0, n, "UTF-8"));
            return new JSONObject(sb.toString());
        } finally {
            c.disconnect();
        }
    }

    // ---------------- Web ----------------

    /** Descarga y descomprime la web de la versión `build`; queda lista para usarse (devuelve su carpeta) */
    static File bajarWeb(Context ctx, int build, String sha256, String nativo) throws Exception {
        if (!Version.NATIVO.equals(nativo)) throw new IOException("Esa versión necesita instalar la app nueva");
        File dir = carpetaDe(ctx, build);
        if (!new File(dir, "index.html").exists()) {
            File zip = new File(ctx.getCacheDir(), "web-" + build + ".zip");
            try {
                String sha = bajar(BASE + "download/v" + build + "/web.zip", zip, MAX_WEB, null);
                if (!sha.equalsIgnoreCase(sha256)) throw new IOException("La descarga llegó dañada");
                File tmp = new File(carpetaWeb(ctx), "v" + build + ".tmp");
                borrar(tmp);
                descomprimir(zip, tmp);
                if (!new File(tmp, "index.html").exists()) throw new IOException("La descarga no trae la app");
                borrar(dir);
                if (!tmp.renameTo(dir)) throw new IOException("No se pudo guardar la versión nueva");
            } finally {
                //noinspection ResultOfMethodCallIgnored
                zip.delete();
            }
        }
        prefs(ctx).edit().putInt("listo", build).putString("listoNativo", nativo).commit();
        return dir;
    }

    private static void descomprimir(File zip, File destino) throws IOException {
        String raiz = destino.getCanonicalPath() + File.separator;
        try (ZipInputStream z = new ZipInputStream(new FileInputStream(zip))) {
            ZipEntry e;
            byte[] buf = new byte[64 * 1024];
            while ((e = z.getNextEntry()) != null) {
                File f = new File(destino, e.getName());
                // Nada fuera de la carpeta (rutas con «..»)
                if (!f.getCanonicalPath().startsWith(raiz)) throw new IOException("Ruta no válida en la descarga");
                if (e.isDirectory()) {
                    //noinspection ResultOfMethodCallIgnored
                    f.mkdirs();
                    continue;
                }
                //noinspection ResultOfMethodCallIgnored
                f.getParentFile().mkdirs();
                try (OutputStream out = new FileOutputStream(f)) {
                    int n;
                    while ((n = z.read(buf)) > 0) out.write(buf, 0, n);
                }
            }
        }
    }

    // ---------------- APK ----------------

    static boolean puedeInstalar(Context ctx) {
        return Build.VERSION.SDK_INT < 26 || ctx.getPackageManager().canRequestPackageInstalls();
    }

    /** Descarga el APK y se lo pasa al instalador de Android (que pide confirmación si hace falta) */
    static void instalarApk(Context ctx, String url, Progreso pr) throws Exception {
        if (!url.startsWith(BASE)) throw new IOException("Dirección de descarga no válida");
        File apk = new File(ctx.getCacheDir(), "actualizacion.apk");
        try {
            bajar(url, apk, MAX_APK, pr);
            PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            sp.setAppPackageName(ctx.getPackageName());
            sp.setSize(apk.length());
            // Android 12+: si la propia app es quien la instaló, puede actualizarse sin preguntar
            if (Build.VERSION.SDK_INT >= 31) sp.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            int id = pi.createSession(sp);
            try (PackageInstaller.Session s = pi.openSession(id)) {
                try (OutputStream out = s.openWrite("Calendario.apk", 0, apk.length()); InputStream in = new FileInputStream(apk)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    s.fsync(out);
                }
                Intent i = new Intent(ctx, AlarmaReceiver.class).setAction(INSTALADA);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                prefs(ctx).edit().putBoolean("instalando", true).commit();
                s.commit(PendingIntent.getBroadcast(ctx, 7001, i, flags).getIntentSender());
            }
        } finally {
            //noinspection ResultOfMethodCallIgnored
            apk.delete();
        }
    }

    /** Resultado del instalador de Android */
    @SuppressWarnings("deprecation")
    static void resultado(Context ctx, Intent intent) {
        int st = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Android quiere que confirmes: abrir su ventana de «¿Actualizar esta app?»
            Intent confirmar = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmar != null) {
                confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    ctx.startActivity(confirmar);
                } catch (Exception e) {
                    AlarmasPlugin.avisarInstalacion("No se pudo abrir el instalador de Android");
                }
            }
        } else if (st != PackageInstaller.STATUS_SUCCESS) {
            prefs(ctx).edit().remove("instalando").commit();
            String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            AlarmasPlugin.avisarInstalacion(st == PackageInstaller.STATUS_FAILURE_ABORTED
                ? "Actualización cancelada"
                : "No se pudo instalar" + (msg != null ? ": " + msg : ""));
        }
    }

    /** Tras actualizarse desde la propia app: notificación para volver a abrirla de un toque */
    static void trasActualizar(Context ctx) {
        SharedPreferences p = prefs(ctx);
        if (!p.getBoolean("instalando", false)) return;
        p.edit().remove("instalando").commit();
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel c = new NotificationChannel(CANAL, "Actualizaciones de la app", NotificationManager.IMPORTANCE_DEFAULT);
        c.setSound(null, null);
        nm.createNotificationChannel(c);
        Notification.Builder b = new Notification.Builder(ctx, CANAL)
            .setSmallIcon(Alarmas.icono(ctx))
            .setContentTitle("Mi calendario se ha actualizado")
            .setContentText("Toca para abrirlo")
            .setContentIntent(Alarmas.abrirApp(ctx, 7002))
            .setAutoCancel(true);
        try {
            nm.notify(7002, b.build());
        } catch (SecurityException ignored) {
            // Sin permiso de notificaciones
        }
    }
}
