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
        // Полоска прокрутки, которую видно поверх страницы при скролле, —
        // это собственный индикатор WebView, а не что-то из CSS/DOM: он
        // рисуется системой поверх содержимого независимо от страницы.
        // Раньше это пытались выключить через android:scrollbars="none"
        // в res/layout/activity_main.xml — не сработало, потому что тот
        // layout вообще не используется: BridgeActivity.onCreate() (в
        // самой библиотеке Capacitor) ставит СВОЙ layout
        // (capacitor_bridge_layout_main) и создаёт WebView программно —
        // до этой правки наш activity_main.xml просто никогда не
        // подключался. Настоящий WebView достаём здесь же, сразу после
        // super.onCreate(), когда bridge и сам WebView уже созданы.
        getBridge().getWebView().setVerticalScrollBarEnabled(false);
    }
}
