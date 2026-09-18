package app.folio.student;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FolioFiles")
public class FolioFilesPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private boolean saving = false;
    private File pendingFile;

    @PluginMethod
    public synchronized void saveFile(PluginCall call) {
        if (saving) { call.reject("保存処理が進行中です。"); return; }
        String name = call.getString("name");
        String data = call.getString("data");
        if (name == null || name.trim().isEmpty() || name.contains("/") || name.contains("\\") || data == null) {
            call.reject("保存するファイルの情報が不正です。"); return;
        }
        saving = true;
        worker.execute(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                if (bytes.length == 0) throw new IllegalArgumentException("empty file");
                pendingFile = File.createTempFile("folio-export-", ".bin", getContext().getCacheDir());
                try (FileOutputStream file = new FileOutputStream(pendingFile)) { file.write(bytes); }
                // Activity state must not contain megabytes of Base64 when the OS backgrounds us.
                call.getData().remove("data");
                call.getData().put("_exportCache", pendingFile.getName());
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(call.getString("mimeType", "application/pdf"));
                intent.putExtra(Intent.EXTRA_TITLE, name);
                getActivity().runOnUiThread(() -> {
                    try { startActivityForResult(call, intent, "fileChosen"); }
                    catch (Exception error) { reset(); call.reject("端末の保存画面を開けませんでした。", error); }
                });
            } catch (Exception error) { reset(); call.reject("ファイルを準備できませんでした。", error); }
        });
    }

    @ActivityCallback
    private void fileChosen(PluginCall call, ActivityResult result) {
        if (call == null) { reset(); return; }
        if (result.getResultCode() != Activity.RESULT_OK) {
            reset(); JSObject response = new JSObject(); response.put("cancelled", true); call.resolve(response); return;
        }
        String cacheName = call.getString("_exportCache", "");
        if (cacheName.matches("folio-export-[A-Za-z0-9-]+\\.bin")) pendingFile = new File(getContext().getCacheDir(), cacheName);
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (uri == null || pendingFile == null || !pendingFile.isFile()) { reset(); call.reject("保存先を取得できませんでした。もう一度保存してください。"); return; }
        final File source = pendingFile;
        worker.execute(() -> {
            try (FileInputStream input = new FileInputStream(source); OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new IllegalStateException("No output stream");
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
            } catch (Exception error) { reset(); call.reject("ファイルを保存できませんでした。保存先と空き容量を確認してください。", error); return; }
            reset(); JSObject response = new JSObject(); response.put("cancelled", false); call.resolve(response);
        });
    }

    private synchronized void reset() { saving = false; if (pendingFile != null) pendingFile.delete(); pendingFile = null; }
    @Override protected void handleOnDestroy() { worker.shutdown(); }
}
