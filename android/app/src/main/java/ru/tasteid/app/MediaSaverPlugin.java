package ru.tasteid.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;

// Снимок тир-листа/статистики/паспорта (tlExport и её аналоги в
// app/js/) на телефоне раньше шёл только через "Поделиться" — на
// компьютере <a download> сам кладёт файл в "Загрузки", а внутри
// приложения на телефоне такая ссылка не делает ничего (см. её же
// комментарий у installDownloads в mobile/src/main.js), и единственным
// способом было отдать файл системе целиком через шторку "Поделиться" —
// на шаг длиннее, чем в любом другом приложении, где снимок сразу
// падает в галерею, как обычный скриншот.
//
// MediaStore (ContentResolver.insert в EXTERNAL_CONTENT_URI) — начиная
// с Android 10 разрешение не нужно вовсе: приложение имеет право писать
// свои же файлы в общую галерею напрямую. До Android 10 (API < 29) это
// разрешение всё ещё обычное опасное (dangerous) и требует явного
// запроса в рантайме — см. saveImage()/storagePermsCallback() ниже.
@CapacitorPlugin(
    name = "MediaSaver",
    permissions = {
        @Permission(strings = { android.Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage")
    }
)
public class MediaSaverPlugin extends Plugin {

    @PluginMethod
    public void saveImage(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q || getPermissionState("storage") == PermissionState.GRANTED) {
            doSave(call);
            return;
        }
        requestPermissionForAlias("storage", call, "storagePermsCallback");
    }

    @PermissionCallback
    private void storagePermsCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            doSave(call);
        } else {
            call.reject("Нет разрешения на запись в галерею");
        }
    }

    private void doSave(PluginCall call) {
        String base64 = call.getString("base64");
        String filename = call.getString("filename", "tasteid.png");
        if (base64 == null) {
            call.reject("Нет данных картинки");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // На старых версиях этой колонки в MediaStore нет вовсе –
                // insert() сам кладёт файл в дефолтную публичную папку
                // (Pictures), запрашивать конкретный путь незачем.
                values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/TasteID");
            }

            Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("Не удалось создать файл в галерее");
                return;
            }

            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IOException("Не удалось открыть файл для записи");
                out.write(bytes);
            }

            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Не удалось сохранить в галерею: " + e.getMessage(), e);
        }
    }
}
