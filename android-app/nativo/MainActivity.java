package io.github.ulisesfna.calendario;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Los plugins propios se registran antes de crear la app
        registerPlugin(AlarmasPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
