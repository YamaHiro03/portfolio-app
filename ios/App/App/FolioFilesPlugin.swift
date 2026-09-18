import Foundation
import UIKit
import Capacitor

@objc(FolioFilesPlugin)
public class FolioFilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FolioFilesPlugin"
    public let jsName = "FolioFiles"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "saveFile", returnType: CAPPluginReturnPromise)]
    private var pending: CAPPluginCall?
    private var temporaryDirectory: URL?

    @objc func saveFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil else { call.reject("保存処理が進行中です。"); return }
            guard let name = call.getString("name"), !name.isEmpty, name != ".", name != "..",
                  !name.contains("/"), !name.contains("\\"), let encoded = call.getString("data") else {
                call.reject("保存するファイルの情報が不正です。"); return
            }
            self.pending = call
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    guard let data = Data(base64Encoded: encoded), !data.isEmpty else { throw CocoaError(.fileReadCorruptFile) }
                    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("folio-export-" + UUID().uuidString, isDirectory: true)
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    let file = directory.appendingPathComponent(name)
                    do { try data.write(to: file, options: .atomic) }
                    catch { try? FileManager.default.removeItem(at: directory); throw error }
                    DispatchQueue.main.async {
                        self.temporaryDirectory = directory
                        guard let presenter = self.bridge?.viewController, presenter.presentedViewController == nil else {
                            self.finish(error: "保存画面を開けませんでした。もう一度お試しください。"); return
                        }
                        let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
                        picker.delegate = self
                        picker.modalPresentationStyle = .formSheet
                        presenter.present(picker, animated: true)
                    }
                } catch {
                    DispatchQueue.main.async { self.finish(error: "ファイルを準備できませんでした。端末の空き容量を確認してください。") }
                }
            }
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if urls.isEmpty { finish(error: "保存先を取得できませんでした。") } else { finish(cancelled: false) }
    }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(cancelled: true) }
    private func finish(cancelled: Bool = false, error: String? = nil) {
        let call = pending
        pending = nil
        if let directory = temporaryDirectory { try? FileManager.default.removeItem(at: directory) }
        temporaryDirectory = nil
        if let error = error { call?.reject(error) } else { call?.resolve(["cancelled": cancelled]) }
    }
}
