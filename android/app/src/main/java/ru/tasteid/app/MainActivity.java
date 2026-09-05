package ru.tasteid.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Свои плагины — регистрируются до super.onCreate(), как того
        // требует Capacitor для всех registerPlugin(). См. их же
        // комментарии в InstallPermissionPlugin.java/MediaSaverPlugin.java.
        registerPlugin(InstallPermissionPlugin.class);
        registerPlugin(MediaSaverPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
