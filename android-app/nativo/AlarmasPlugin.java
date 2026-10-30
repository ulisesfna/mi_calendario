package io.github.ulisesfna.calendario;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** Puente entre la app (JavaScript) y las alarmas nativas. En JS: Capacitor.registerPlugin('Alarmas') */
@CapacitorPlugin(name = "Alarmas", permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "avisos") })
public class AlarmasPlugin extends Plugin {

    @Override
    public void load() {
        Alarmas.crearCanales(getContext());
    }

    @PluginMethod
    public void programar(PluginCall call) {
        JSArray avisos = call.getArray("avisos", new JSArray());
        int n = Alarmas.programar(getContext(), avisos);
        JSObject r = estadoActual();
        r.put("programados", n);
        call.resolve(r);
    }

    @PluginMethod
    public void estado(PluginCall call) {
        call.resolve(estadoActual());
    }

    @PluginMethod
    public void probar(PluginCall call) {
        Alarmas.probar(
            getContext(),
            call.getString("nivel", "sound"),
            call.getInt("segundos", 0),
            call.getString("titulo", "Prueba de aviso"),
            call.getString("texto", "Así sonará este aviso")
        );
        call.resolve();
    }

    @PluginMethod
    public void descartar(PluginCall call) {
        Alarmas.pararId(getContext(), call.getInt("id", 0));
        call.resolve();
    }

    /** Sonido y volumen: { alarma, aviso, volAlarma (-1 = el del móvil), volAviso, avisoFuerte }; lo que no venga no cambia */
    @PluginMethod
    public void configurarSonido(PluginCall call) {
        Sonidos.configurar(
            getContext(),
            call.getString("alarma", null),
            call.getString("aviso", null),
            call.getInt("volAlarma", null),
            call.getInt("volAviso", null),
            call.getBoolean("avisoFuerte", null)
        );
        call.resolve(estadoActual());
    }

    /** Escucha el sonido elegido ({ tipo: 'alarma' | 'aviso' }); si ya sonaba, lo para */
    @PluginMethod
    public void escuchar(PluginCall call) {
        if (Sonidos.escuchando()) {
            Sonidos.pararEscucha(getContext());
            call.resolve(new JSObject().put("sonando", false));
            return;
        }
        boolean alarma = !"aviso".equals(call.getString("tipo", "alarma"));
        try {
            Sonidos.escuchar(getContext(), alarma, alarma ? 6 : 4);
            call.resolve(new JSObject().put("sonando", true));
        } catch (Exception e) {
            call.reject("No se pudo reproducir ese sonido: " + e.getMessage());
        }
    }

    /** Abre el selector de tonos de Android para elegir uno del móvil ({ tipo: 'alarma' | 'aviso' }) */
    @PluginMethod
    public void elegirTono(PluginCall call) {
        boolean alarma = !"aviso".equals(call.getString("tipo", "alarma"));
        Intent i = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER)
            .putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, alarma ? RingtoneManager.TYPE_ALARM : RingtoneManager.TYPE_NOTIFICATION)
            .putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, alarma ? "Sonido de las alarmas" : "Sonido de los avisos")
            .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
            .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, false)
            .putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, Sonidos.uriActual(getContext(), alarma));
        tonoParaAlarma = alarma;
        try {
            startActivityForResult(call, i, "tonoElegido");
        } catch (Exception e) {
            call.reject("Este móvil no tiene selector de tonos");
        }
    }

    private boolean tonoParaAlarma = true;

    @ActivityCallback
    private void tonoElegido(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
        if (result.getResultCode() == Activity.RESULT_OK && uri != null) {
            String nombre = "";
            try {
                Ringtone r = RingtoneManager.getRingtone(getContext(), uri);
                if (r != null) nombre = r.getTitle(getContext());
            } catch (Exception ignored) {}
            Sonidos.elegido(getContext(), tonoParaAlarma, uri, nombre);
        }
        call.resolve(estadoActual());
    }

    @PluginMethod
    public void abrirAjustes(PluginCall call) {
        Context ctx = getContext();
        String pkg = ctx.getPackageName();
        String tipo = call.getString("tipo", "app");
        Intent i;
        if ("exactas".equals(tipo) && Build.VERSION.SDK_INT >= 31) {
            i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + pkg));
        } else if ("bateria".equals(tipo)) {
            i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
        } else if ("avisos".equals(tipo)) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(i);
        } catch (Exception e) {
            // Algunas capas (MIUI…) no tienen esa pantalla: abrir la ficha de la app
            Intent ficha = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
            ficha.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(ficha);
        }
        call.resolve();
    }

    private JSObject estadoActual() {
        Context ctx = getContext();
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        PowerManager pm = ctx.getSystemService(PowerManager.class);
        JSObject r = new JSObject();
        r.put("notificaciones", nm.areNotificationsEnabled());
        r.put("exactas", Alarmas.exactasPermitidas(ctx));
        r.put("bateria", pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        r.put("programados", Alarmas.leerLista(ctx, "lista").length());
        r.put("siguiente", Alarmas.siguiente(ctx));
        r.put("android", Build.VERSION.SDK_INT);
        r.put("fabricante", Build.MANUFACTURER);
        // Para explicar por qué algo no suena: modo del móvil, volúmenes, No molestar y canales
        AudioManager am = ctx.getSystemService(AudioManager.class);
        int modo = am.getRingerMode();
        r.put("modo", modo == AudioManager.RINGER_MODE_SILENT ? "silencio" : modo == AudioManager.RINGER_MODE_VIBRATE ? "vibracion" : "normal");
        r.put("volNotif", am.getStreamVolume(AudioManager.STREAM_NOTIFICATION));
        r.put("maxNotif", am.getStreamMaxVolume(AudioManager.STREAM_NOTIFICATION));
        r.put("volAlarmaMovil", am.getStreamVolume(AudioManager.STREAM_ALARM));
        r.put("maxAlarma", am.getStreamMaxVolume(AudioManager.STREAM_ALARM));
        r.put("noMolestar", nm.getCurrentInterruptionFilter() > NotificationManager.INTERRUPTION_FILTER_ALL);
        r.put("sonido", Sonidos.config(ctx));
        r.put("canales", Sonidos.canales(ctx));
        r.put("escuchando", Sonidos.escuchando());
        return r;
    }
}
