package ru.tasteid.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// "Установка неизвестных приложений" — не обычное runtime-разрешение
// вроде камеры или геолокации, которое система сама спрашивает через
// стандартный диалог "Разрешить/Запретить": начиная с Android 8 это
// отдельный тумблер в настройках на каждое приложение отдельно
// (canRequestPackageInstalls), и включить его можно только вручную,
// открыв нужный экран через Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES.
// Без этого плагина mobile/src/main.js не мог ни проверить, включён ли
// тумблер, ни открыть нужный экран сам — обновление внутри приложения
// (FileOpener.openFile на apk) просто тихо падало и откатывалось на
// «Поделиться» без единого объяснения почему.
@CapacitorPlugin(name = "InstallPermission")
public class InstallPermissionPlugin extends Plugin {

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ret.put("value", getContext().getPackageManager().canRequestPackageInstalls());
        } else {
            // До Android 8 разрешение на установку — обычное, выдаётся
            // при установке самого приложения, отдельно включать нечего.
            ret.put("value", true);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        }
        call.resolve();
    }
}
