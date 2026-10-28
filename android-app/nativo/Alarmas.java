package io.github.ulisesfna.calendario;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Alarmas del propio móvil. La app manda la lista de avisos de las próximas semanas y aquí se
 * programan con AlarmManager: suenan a su hora aunque la app esté cerrada, sin internet ni servidor.
 *
 * Cada aviso es un JSON: { id, at (ms), titulo, texto, nivel, repetirMin }.
 * Niveles: visual · vibrate · sound · alarm (suena hasta 3 min) · persistent (hasta que la pares).
 */
final class Alarmas {

    static final String DISPARAR = "io.github.ulisesfna.calendario.DISPARAR";
    static final String POSPONER = "io.github.ulisesfna.calendario.POSPONER";
    static final String PARAR = "io.github.ulisesfna.calendario.PARAR";
    static final String REPETIR = "io.github.ulisesfna.calendario.REPETIR";
    static final String CALLAR = "io.github.ulisesfna.calendario.CALLAR";

    private static final String PREFS = "alarmas";
    private static final int COLOR = 0xFF5B4BDB;
    private static final int MAX_REPETICIONES = 30;
    private static final long MINUTO = 60_000L;

    private Alarmas() {}

    static String canal(String nivel) {
        switch (nivel) {
            case "visual":
            case "vibrate":
            case "alarm":
            case "persistent":
                return "cal1-" + nivel;
            default:
                return "cal1-sound";
        }
    }

    static boolean fuerte(String nivel) {
        return "alarm".equals(nivel) || "persistent".equals(nivel);
    }

    /** Un canal por intensidad (Android decide el sonido y la vibración por canal) */
    static void crearCanales(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        // Las alarmas suenan por el canal de ALARMA: con el volumen de alarma y aunque el móvil esté en silencio
        AudioAttributes deAlarma = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        Uri sonidoAlarma = Uri.parse("android.resource://" + ctx.getPackageName() + "/raw/alarma");

        NotificationChannel c = new NotificationChannel(canal("visual"), "Avisos silenciosos", NotificationManager.IMPORTANCE_LOW);
        c.setSound(null, null);
        c.enableVibration(false);
        nm.createNotificationChannel(c);

        c = new NotificationChannel(canal("vibrate"), "Avisos con vibración", NotificationManager.IMPORTANCE_HIGH);
        c.setSound(null, null);
        c.enableVibration(true);
        c.setVibrationPattern(new long[] { 0, 200, 100, 200 });
        nm.createNotificationChannel(c);

        c = new NotificationChannel(canal("sound"), "Avisos con sonido", NotificationManager.IMPORTANCE_HIGH);
        c.enableVibration(true);
        c.setVibrationPattern(new long[] { 0, 300, 120, 300 });
        nm.createNotificationChannel(c);

        c = new NotificationChannel(canal("alarm"), "Alarmas", NotificationManager.IMPORTANCE_HIGH);
        c.setSound(sonidoAlarma, deAlarma);
        c.enableVibration(true);
        c.setVibrationPattern(new long[] { 0, 800, 300, 800, 300, 800 });
        c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        c.setBypassDnd(true);
        nm.createNotificationChannel(c);

        c = new NotificationChannel(canal("persistent"), "Alarmas persistentes", NotificationManager.IMPORTANCE_HIGH);
        c.setSound(sonidoAlarma, deAlarma);
        c.enableVibration(true);
        c.setVibrationPattern(new long[] { 0, 1000, 300, 1000, 300, 1000 });
        c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        c.setBypassDnd(true);
        nm.createNotificationChannel(c);
    }

    // ---------------- Lista guardada (para volver a programarla tras reiniciar el móvil) ----------------

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONArray leerLista(Context ctx, String clave) {
        try {
            return new JSONArray(prefs(ctx).getString(clave, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static void guardarLista(Context ctx, String clave, JSONArray lista) {
        prefs(ctx).edit().putString(clave, lista.toString()).apply();
    }

    /** Avisos pospuestos y pruebas: no vienen en la lista de la app, se guardan aparte */
    private static void guardarExtra(Context ctx, JSONObject a) {
        JSONArray viejos = leerLista(ctx, "extra");
        JSONArray nuevos = new JSONArray();
        long ahora = System.currentTimeMillis();
        for (int i = 0; i < viejos.length(); i++) {
            JSONObject x = viejos.optJSONObject(i);
            if (x != null && x.optLong("at") > ahora && x.optInt("id") != a.optInt("id")) nuevos.put(x);
        }
        nuevos.put(a);
        guardarLista(ctx, "extra", nuevos);
    }

    private static void quitarExtra(Context ctx, int id) {
        JSONArray viejos = leerLista(ctx, "extra");
        if (viejos.length() == 0) return;
        JSONArray nuevos = new JSONArray();
        long ahora = System.currentTimeMillis();
        for (int i = 0; i < viejos.length(); i++) {
            JSONObject x = viejos.optJSONObject(i);
            if (x != null && x.optLong("at") > ahora && x.optInt("id") != id) nuevos.put(x);
        }
        guardarLista(ctx, "extra", nuevos);
    }

    /** Hora del próximo aviso programado (0 si no hay) */
    static long siguiente(Context ctx) {
        long ahora = System.currentTimeMillis();
        long min = 0;
        for (String clave : new String[] { "lista", "extra" }) {
            JSONArray l = leerLista(ctx, clave);
            for (int i = 0; i < l.length(); i++) {
                JSONObject a = l.optJSONObject(i);
                long at = a == null ? 0 : a.optLong("at");
                if (at > ahora && (min == 0 || at < min)) min = at;
            }
        }
        return min;
    }

    // ---------------- Programar ----------------

    static PendingIntent pendiente(Context ctx, String accion, JSONObject a) {
        Intent i = new Intent(ctx, AlarmaReceiver.class).setAction(accion).putExtra("aviso", a.toString());
        return PendingIntent.getBroadcast(ctx, a.optInt("id"), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent abrirApp(Context ctx, int id) {
        Intent i = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (i == null) i = new Intent(ctx, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return PendingIntent.getActivity(ctx, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean exactasPermitidas(Context ctx) {
        if (Build.VERSION.SDK_INT < 31) return true;
        return ctx.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    private static void poner(Context ctx, String accion, JSONObject a, long cuando) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        PendingIntent pi = pendiente(ctx, accion, a);
        try {
            if (exactasPermitidas(ctx)) {
                if (DISPARAR.equals(accion) && fuerte(a.optString("nivel"))) {
                    // Las alarmas, como las del despertador: Android no las retrasa nunca
                    am.setAlarmClock(new AlarmManager.AlarmClockInfo(cuando, abrirApp(ctx, a.optInt("id"))), pi);
                } else {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando, pi);
                }
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando, pi);
            }
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cuando, pi);
        }
    }

    /** Sustituye los avisos programados por la lista nueva (la app la manda al abrirse y tras cada cambio) */
    static int programar(Context ctx, JSONArray nuevos) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        JSONArray viejos = leerLista(ctx, "lista");
        for (int i = 0; i < viejos.length(); i++) {
            JSONObject a = viejos.optJSONObject(i);
            if (a != null) am.cancel(pendiente(ctx, DISPARAR, a));
        }
        long ahora = System.currentTimeMillis();
        JSONArray guardados = new JSONArray();
        for (int i = 0; i < nuevos.length(); i++) {
            JSONObject a = nuevos.optJSONObject(i);
            if (a == null || a.optLong("at") <= ahora) continue;
            poner(ctx, DISPARAR, a, a.optLong("at"));
            guardados.put(a);
        }
        guardarLista(ctx, "lista", guardados);
        return guardados.length();
    }

    /** Tras reiniciar el móvil o actualizar la app, Android borra las alarmas: volver a ponerlas */
    static void reprogramar(Context ctx) {
        crearCanales(ctx);
        long ahora = System.currentTimeMillis();
        for (String clave : new String[] { "lista", "extra" }) {
            JSONArray l = leerLista(ctx, clave);
            for (int i = 0; i < l.length(); i++) {
                JSONObject a = l.optJSONObject(i);
                if (a != null && a.optLong("at") > ahora) poner(ctx, DISPARAR, a, a.optLong("at"));
            }
        }
    }

    // ---------------- Mostrar ----------------

    private static int icono(Context ctx) {
        int r = ctx.getResources().getIdentifier("ic_stat_cal", "drawable", ctx.getPackageName());
        return r != 0 ? r : android.R.drawable.ic_popup_reminder;
    }

    private static JSONObject copia(JSONObject a) {
        try {
            return new JSONObject(a.toString());
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    static boolean activa(Context ctx, int id) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        for (StatusBarNotification s : nm.getActiveNotifications()) {
            if (s.getId() == id) return true;
        }
        return false;
    }

    /** Muestra el aviso. alertar=false lo deja en la barra sin sonido (alarma que ya sonó 3 min). */
    static void mostrar(Context ctx, JSONObject a, boolean alertar) {
        int id = a.optInt("id");
        quitarExtra(ctx, id);
        String nivel = a.optString("nivel", "sound");
        boolean fuerte = fuerte(nivel);
        boolean persistente = "persistent".equals(nivel);
        String texto = a.optString("texto", "");
        Notification.Builder b = new Notification.Builder(ctx, alertar ? canal(nivel) : canal("visual"))
            .setSmallIcon(icono(ctx))
            .setColor(COLOR)
            .setContentTitle(a.optString("titulo", "Aviso"))
            .setContentText(texto)
            .setStyle(new Notification.BigTextStyle().bigText(texto))
            .setWhen(a.optLong("at", System.currentTimeMillis()))
            .setShowWhen(true)
            .setCategory(fuerte ? Notification.CATEGORY_ALARM : Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(abrirApp(ctx, id))
            .setAutoCancel(!persistente)
            .setOngoing(persistente && alertar)
            .addAction(new Notification.Action.Builder((Icon) null, "Posponer 10 min", pendiente(ctx, POSPONER, a)).build())
            .addAction(new Notification.Action.Builder((Icon) null, fuerte ? "Parar" : "Vale", pendiente(ctx, PARAR, a)).build());
        Notification n = b.build();
        // Las alarmas repiten su sonido sin parar hasta que se toca la notificación
        if (fuerte && alertar) n.flags |= Notification.FLAG_INSISTENT;
        ctx.getSystemService(NotificationManager.class).notify(id, n);
        if (!alertar) return;

        long ahora = System.currentTimeMillis();
        if ("alarm".equals(nivel)) {
            poner(ctx, CALLAR, a, ahora + 3 * MINUTO);
        } else if (persistente) {
            int veces = a.optInt("veces", 0);
            if (veces < MAX_REPETICIONES) {
                JSONObject sig = copia(a);
                try {
                    sig.put("veces", veces + 1);
                } catch (JSONException ignored) {}
                poner(ctx, REPETIR, sig, ahora + Math.max(1, a.optInt("repetirMin", 2)) * MINUTO);
            }
        }
    }

    /** Quita el aviso y sus repeticiones */
    static void parar(Context ctx, JSONObject a) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        ctx.getSystemService(NotificationManager.class).cancel(a.optInt("id"));
        am.cancel(pendiente(ctx, REPETIR, a));
        am.cancel(pendiente(ctx, CALLAR, a));
    }

    static void pararId(Context ctx, int id) {
        JSONObject a = new JSONObject();
        try {
            a.put("id", id);
        } catch (JSONException ignored) {}
        parar(ctx, a);
    }

    static void posponer(Context ctx, JSONObject a, int minutos) {
        parar(ctx, a);
        JSONObject n = copia(a);
        long cuando = System.currentTimeMillis() + minutos * MINUTO;
        try {
            // Id nuevo (los de la app están por debajo de 0x40000000)
            n.put("id", 0x40000000 | (int) ((System.currentTimeMillis() / 1000) & 0x3FFFFFFF));
            n.put("at", cuando);
            n.remove("veces");
        } catch (JSONException ignored) {}
        guardarExtra(ctx, n);
        poner(ctx, DISPARAR, n, cuando);
    }

    /** Aviso de prueba de un nivel, ahora mismo (segundos=0) o dentro de unos segundos */
    static void probar(Context ctx, String nivel, int segundos, String titulo, String texto) {
        JSONObject a = new JSONObject();
        long cuando = System.currentTimeMillis() + Math.max(0, segundos) * 1000L;
        try {
            a.put("id", 0x7FF00000 + Math.abs(nivel.hashCode() % 1000));
            a.put("at", cuando);
            a.put("titulo", titulo);
            a.put("texto", texto);
            a.put("nivel", nivel);
            a.put("repetirMin", 1);
        } catch (JSONException ignored) {}
        parar(ctx, a);
        if (segundos <= 0) {
            mostrar(ctx, a, true);
        } else {
            guardarExtra(ctx, a);
            poner(ctx, DISPARAR, a, cuando);
        }
    }
}
