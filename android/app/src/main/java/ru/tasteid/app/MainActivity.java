package ru.tasteid.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Свой плагин — регистрируется до super.onCreate(), как того
        // требует Capacitor для всех registerPlugin(). См. его же
        // комментарий в InstallPermissionPlugin.java.
        registerPlugin(InstallPermissionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
