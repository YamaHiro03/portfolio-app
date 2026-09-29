import { useEffect } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { isNativeApp } from '../mobile-runtime';

// Preserve the same close-dialog / back-navigation order on Android.
export function useMobileBackButton({
  modal,
  setModal,
  mobile,
  setMobile,
  page,
  currentFolder,
  setCurrentFolder,
  entries,
  go,
}) {
  useEffect(() => {
    if (!isNativeApp()) return;
    const registration = NativeApp.addListener('backButton', () => {
      const viewer = document.querySelector('.pdf-viewer');
      if (viewer) {
        const cancel = viewer.querySelector('.pdf-action-dialog .text-btn');
        if (cancel) {
          cancel.click();
          return;
        }
        viewer.querySelector('[aria-label="PDFを閉じる"]')?.click();
        return;
      }
      const cancel = document.querySelector('.explorer-dialog [aria-label="操作をキャンセル"]');
      if (cancel) {
        cancel.click();
        return;
      }
      if (modal) {
        setModal(null);
        return;
      }
      if (mobile) {
        setMobile(false);
        return;
      }
      if (page === 'すべての資料' && currentFolder !== null) {
        setCurrentFolder(entries.find((e) => e.id === currentFolder)?.parentId ?? null);
        return;
      }
      if (page !== 'ホーム') {
        go('ホーム');
        return;
      }
      NativeApp.minimizeApp();
    });
    return () => {
      registration.then((handle) => handle.remove());
    };
  }, [modal, mobile, page, currentFolder, entries]);
}
