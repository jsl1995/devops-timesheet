chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Relay theme detection from content script to side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'THEME_DETECTED') {
    // Store the detected theme
    chrome.storage.local.set({ detectedTheme: message.theme });
  }
});
