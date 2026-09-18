import Capacitor

class FolioViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(FolioFilesPlugin())
    }
}
