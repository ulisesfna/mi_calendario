package io.github.ulisesfna.calendario;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Sonido y volumen de los avisos que suenan (nivel sound, alarm y persistent).
 *
 * Android fija el sonido de un canal al crearlo: para cambiarlo se crea un canal nuevo
 * (cal2-<nivel>-<rev>) y se borra el anterior. El volumen propio se consigue poniendo el volumen
 * de ALARMA del móvil al del ajuste mientras suena y devolviéndolo después (RESTAURAR).
 */
final class Sonidos {

    static final String RESTAURAR = "io.github.ulisesfna.calendario.RESTAURAR";

    // Sonidos generados por parchear.py (res/raw/al_*.wav y av_*.wav); «sistema» = el del móvil; «movil» = tono elegido
    static final String[] ALARMAS = { "digital", "clasica", "sirena", "campana", "suave", "sistema", "movil" };
    static final String[] AVISOS = { "ding", "doble", "campana", "sistema", "movil" };

    private static final String PREFS = "sonido";
    private static final int ID_RESTAURAR = 0x7FE00001;
    private static final long SEGUNDO = 1000L;

    private static MediaPlayer reproductor;

    private Sonidos() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static boolean valido(String[] lista, String clave) {
        for (String s : lista) if (s.equals(clave)) return true;
        return false;
    }

    // ---------------- Ajustes ----------------

    /** { alarma, alarmaNombre, aviso, avisoNombre, volAlarma (-1 = el del móvil), volAviso, avisoFuerte } */
    static JSONObject config(Context ctx) {
        SharedPreferences p = prefs(ctx);
        JSONObject c = new JSONObject();
        try {
            c.put("alarma", p.getString("alarma", "digital"));
            c.put("alarmaNombre", p.getString("alarmaNombre", ""));
            c.put("aviso", p.getString("aviso", "ding"));
            c.put("avisoNombre", p.getString("avisoNombre", ""));
            c.put("volAlarma", p.getInt("volAlarma", 80));
            c.put("volAviso", p.getInt("volAviso", 60));
            c.put("avisoFuerte", p.getBoolean("avisoFuerte", false));
        } catch (JSONException ignored) {}
        return c;
    }

    /** Guarda los ajustes que vengan (los demás se quedan como estaban). Si cambia un sonido, rehace los canales. */
    static void configurar(Context ctx, String alarma, String aviso, Integer volAlarma, Integer volAviso, Boolean avisoFuerte) {
        SharedPreferences p = prefs(ctx);
        SharedPreferences.Editor e = p.edit();
        boolean canales = false;
        if (alarma != null && valido(ALARMAS, alarma) && !"movil".equals(alarma) && !alarma.equals(p.getString("alarma", "digital"))) {
            e.putString("alarma", alarma);
            canales = true;
        }
        if (aviso != null && valido(AVISOS, aviso) && !"movil".equals(aviso) && !aviso.equals(p.getString("aviso", "ding"))) {
            e.putString("aviso", aviso);
            canales = true;
        }
        if (volAlarma != null) e.putInt("volAlarma", volAlarma < 0 ? -1 : Math.max(5, Math.min(100, volAlarma)));
        if (volAviso != null) e.putInt("volAviso", Math.max(5, Math.min(100, volAviso)));
        if (avisoFuerte != null && avisoFuerte != p.getBoolean("avisoFuerte", false)) {
            e.putBoolean("avisoFuerte", avisoFuerte);
            canales = true;
        }
        if (canales) e.putInt("rev", p.getInt("rev", 1) + 1);
        e.commit();
        if (canales) crearCanales(ctx);
    }

    /** Tono elegido en el selector de Android (alarma=true para las alarmas, false para los avisos con sonido) */
    static void elegido(Context ctx, boolean alarma, Uri uri, String nombre) {
        String k = alarma ? "alarma" : "aviso";
        SharedPreferences p = prefs(ctx);
        p.edit()
            .putString(k, "movil")
            .putString(k + "Uri", uri.toString())
            .putString(k + "Nombre", nombre == null ? "" : nombre)
            .putInt("rev", p.getInt("rev", 1) + 1)
            .commit();
        crearCanales(ctx);
    }

    static Uri uriActual(Context ctx, boolean alarma) {
        SharedPreferences p = prefs(ctx);
        String clave = alarma ? p.getString("alarma", "digital") : p.getString("aviso", "ding");
        if ("sistema".equals(clave)) return alarma ? Settings.System.DEFAULT_ALARM_ALERT_URI : Settings.System.DEFAULT_NOTIFICATION_URI;
        if ("movil".equals(clave)) {
            String u = p.getString(alarma ? "alarmaUri" : "avisoUri", "");
            if (!u.isEmpty()) return Uri.parse(u);
            clave = alarma ? "digital" : "ding";
        }
        if (!valido(alarma ? ALARMAS : AVISOS, clave)) clave = alarma ? "digital" : "ding";
        return Uri.parse("android.resource://" + ctx.getPackageName() + "/raw/" + (alarma ? "al_" : "av_") + clave);
    }

    // ---------------- Canales ----------------

    static String canal(Context ctx, String nivel) {
        return "cal2-" + nivel + "-" + prefs(ctx).getInt("rev", 1);
    }

    static AudioAttributes deAlarma() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
    }

    private static AudioAttributes deAviso() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
    }

    /** Canales con sonido (los de la versión actual) y borrado de los antiguos */
    static void crearCanales(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        String sound = canal(ctx, "sound"), alarm = canal(ctx, "alarm"), persistent = canal(ctx, "persistent");
        for (NotificationChannel ch : nm.getNotificationChannels()) {
            String id = ch.getId();
            boolean viejo = id.equals("cal1-sound") || id.equals("cal1-alarm") || id.equals("cal1-persistent")
                || (id.startsWith("cal2-") && !id.equals(sound) && !id.equals(alarm) && !id.equals(persistent));
            if (viejo) nm.deleteNotificationChannel(id);
        }
        boolean fuerte = prefs(ctx).getBoolean("avisoFuerte", false);
        Uri tonoAlarma = uriActual(ctx, true);

        NotificationChannel c = new NotificationChannel(sound, "Avisos con sonido", NotificationManager.IMPORTANCE_HIGH);
        // «Aunque el móvil esté en silencio»: suena por el canal de alarma, con su volumen
        c.setSound(uriActual(ctx, false), fuerte ? deAlarma() : deAviso());
        c.enableVibration(true);
        c.setVibrationPattern(new long[] { 0, 300, 120, 300 });
        nm.createNotificationChannel(c);

        c = new NotificationChannel(alarm, "Alarmas", NotificationManager.IMPORTANCE_HIGH);
        c.setSound(tonoAlarma, deAlarma());
        c.enableVibration(true);
        c.setVibrationPattern(new long[] { 0, 800, 300, 800, 300, 800 });
        c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        c.setBypassDnd(true);
        nm.createNotificationChannel(c);

        c = new NotificationChannel(persistent, "Alarmas persistentes", NotificationManager.IMPORTANCE_HIGH);
        c.setSound(tonoAlarma, deAlarma());
        c.enableVibration(true);
        c.setVibrationPattern(new long[] { 0, 1000, 300, 1000, 300, 1000 });
        c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        c.setBypassDnd(true);
        nm.createNotificationChannel(c);
    }

    /** Estado de los canales con sonido: el usuario (o la capa del fabricante) puede haberles quitado el sonido */
    static JSONObject canales(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        JSONObject r = new JSONObject();
        for (String nivel : new String[] { "sound", "alarm", "persistent" }) {
            NotificationChannel ch = nm.getNotificationChannel(canal(ctx, nivel));
            JSONObject x = new JSONObject();
            try {
                x.put("existe", ch != null);
                x.put("importancia", ch == null ? -1 : ch.getImportance());
                x.put("sonido", ch != null && ch.getSound() != null);
                r.put(nivel, x);
            } catch (JSONException ignored) {}
        }
        return r;
    }

    // ---------------- Volumen propio ----------------

    /** Volumen (0-100) con el que debe sonar este nivel, o -1 si se deja el del móvil */
    static int volumenDe(Context ctx, String nivel) {
        SharedPreferences p = prefs(ctx);
        if ("alarm".equals(nivel) || "persistent".equals(nivel)) return p.getInt("volAlarma", 80);
        if ("sound".equals(nivel) && p.getBoolean("avisoFuerte", false)) return p.getInt("volAviso", 60);
        return -1;
    }

    /** Pone el volumen de alarma del móvil al del ajuste; RESTAURAR lo devuelve pasado `durante` */
    static void subirVolumen(Context ctx, int pct, long durante) {
        if (pct < 0) return;
        AudioManager am = ctx.getSystemService(AudioManager.class);
        SharedPreferences p = prefs(ctx);
        int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
        int objetivo = Math.max(1, Math.round(max * Math.min(100, pct) / 100f));
        SharedPreferences.Editor e = p.edit();
        // Si ya estaba subido por otro aviso, el volumen «de verdad» es el que se guardó entonces
        if (p.getInt("volOriginal", -1) < 0) e.putInt("volOriginal", am.getStreamVolume(AudioManager.STREAM_ALARM));
        try {
            am.setStreamVolume(AudioManager.STREAM_ALARM, objetivo, 0);
            e.putInt("volPuesto", objetivo);
        } catch (RuntimeException ignored) {
            // Algunos modos (No molestar sin permiso) no dejan cambiarlo: suena con el que haya
        }
        e.commit();
        programarRestaurar(ctx, durante);
    }

    private static void programarRestaurar(Context ctx, long durante) {
        SharedPreferences p = prefs(ctx);
        long ahora = System.currentTimeMillis();
        long cuando = Math.max(ahora + durante, p.getLong("restaurarEn", 0));
        p.edit().putLong("restaurarEn", cuando).commit();
        Intent i = new Intent(ctx, AlarmaReceiver.class).setAction(RESTAURAR);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, ID_RESTAURAR, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        try {
            if (Alarmas.exactasPermitidas(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando, pi);
        } catch (SecurityException ex) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando, pi);
        }
    }

    /** ¿Queda alguna alarma sonando? (las que suenan sin parar llevan FLAG_INSISTENT) */
    private static boolean sonando(Context ctx) {
        if (reproductor != null) return true;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        for (StatusBarNotification s : nm.getActiveNotifications()) {
            if ((s.getNotification().flags & Notification.FLAG_INSISTENT) != 0) return true;
        }
        return false;
    }

    /** Devuelve el volumen de alarma que tenía el móvil (si nadie lo ha tocado mientras tanto) */
    static void restaurar(Context ctx) {
        SharedPreferences p = prefs(ctx);
        p.edit().remove("restaurarEn").commit();
        if (sonando(ctx)) {
            programarRestaurar(ctx, 60 * SEGUNDO);
            return;
        }
        int original = p.getInt("volOriginal", -1);
        int puesto = p.getInt("volPuesto", -1);
        if (original >= 0 && puesto >= 0) {
            AudioManager am = ctx.getSystemService(AudioManager.class);
            // Si lo has cambiado a mano mientras sonaba, se respeta lo que pusiste
            if (am.getStreamVolume(AudioManager.STREAM_ALARM) == puesto) {
                try {
                    am.setStreamVolume(AudioManager.STREAM_ALARM, original, 0);
                } catch (RuntimeException ignored) {}
            }
        }
        p.edit().remove("volOriginal").remove("volPuesto").commit();
    }

    // ---------------- Escuchar (desde Ajustes, con la app abierta) ----------------

    /** Reproduce el sonido elegido unos segundos, con el volumen del ajuste */
    static void escuchar(Context ctx, boolean alarma, int segundos) throws Exception {
        pararEscucha(ctx);
        boolean porAlarma = alarma || prefs(ctx).getBoolean("avisoFuerte", false);
        subirVolumen(ctx, volumenDe(ctx, alarma ? "alarm" : "sound"), (segundos + 2) * SEGUNDO);
        final MediaPlayer mp = new MediaPlayer();
        try {
            mp.setAudioAttributes(porAlarma ? deAlarma() : deAviso());
            mp.setDataSource(ctx, uriActual(ctx, alarma));
            mp.setLooping(alarma);
            mp.prepare();
            mp.start();
        } catch (Exception ex) {
            mp.release();
            restaurar(ctx);
            throw ex;
        }
        reproductor = mp;
        final Context app = ctx.getApplicationContext();
        mp.setOnCompletionListener((m) -> {
            if (reproductor == m) pararEscucha(app);
        });
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (reproductor == mp) pararEscucha(app);
        }, segundos * SEGUNDO);
    }

    static void pararEscucha(Context ctx) {
        MediaPlayer mp = reproductor;
        reproductor = null;
        if (mp == null) return;
        try {
            mp.stop();
        } catch (RuntimeException ignored) {}
        mp.release();
        restaurar(ctx);
    }

    static boolean escuchando() {
        return reproductor != null;
    }
}
