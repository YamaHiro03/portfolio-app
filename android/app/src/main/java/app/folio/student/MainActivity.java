package app.folio.student;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FolioFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
