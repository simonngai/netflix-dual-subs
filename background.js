// Background service worker — handles file downloads (Save As dialog)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SAVE_FILE') {
    const blob = new Blob([msg.text], { type: 'text/plain' });
    const reader = new FileReader();
    reader.onload = () => {
      chrome.downloads.download({
        url: reader.result,
        filename: msg.filename,
        saveAs: true,
      }, (downloadId) => {
        sendResponse({ success: true, downloadId });
      });
    };
    reader.readAsDataURL(blob);
    return true; // keep sendResponse alive for async
  }
});
