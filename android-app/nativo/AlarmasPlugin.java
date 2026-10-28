package io.github.ulisesfna.calendario;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
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
        return r;
    }
}
