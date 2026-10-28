package io.github.ulisesfna.calendario;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONException;
import org.json.JSONObject;

/** Recibe la hora de cada aviso, los botones de la notificación y el reinicio del móvil */
public class AlarmaReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String accion = intent.getAction();
        if (accion == null) return;
        JSONObject a = null;
        String txt = intent.getStringExtra("aviso");
        if (txt != null) {
            try {
                a = new JSONObject(txt);
            } catch (JSONException e) {
                return;
            }
        }
        switch (accion) {
            case Alarmas.DISPARAR:
                if (a != null) Alarmas.mostrar(ctx, a, true);
                break;
            case Alarmas.REPETIR:
                // Alarma persistente: volver a sonar mientras no se haya parado
                if (a != null && Alarmas.activa(ctx, a.optInt("id"))) Alarmas.mostrar(ctx, a, true);
                break;
            case Alarmas.CALLAR:
                // Alarma normal: a los 3 minutos deja de sonar y queda como aviso
                if (a != null && Alarmas.activa(ctx, a.optInt("id"))) Alarmas.mostrar(ctx, a, false);
                break;
            case Alarmas.POSPONER:
                if (a != null) Alarmas.posponer(ctx, a, 10);
                break;
            case Alarmas.PARAR:
                if (a != null) Alarmas.parar(ctx, a);
                break;
            default:
                // Arranque del móvil, app actualizada o permiso de alarmas exactas concedido
                Alarmas.reprogramar(ctx);
        }
    }
}
