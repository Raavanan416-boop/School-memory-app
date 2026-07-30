// Security protection — Anti-inspect, anti-copy, and content protection
// Protects app content while maintaining usability

(function() {
  'use strict';

  // 1. Disable right-click context menu on app content
  document.addEventListener('contextmenu', (e) => {
    // Allow right-click on message bubbles (handled by chat context menu)
    if (e.target.closest('.msg-sent, .msg-received, .msg-bubble-wrap')) return;
    // Allow right-click on input fields
    if (e.target.matches('input, textarea')) return;
    e.preventDefault();
  });

  // 2. Disable text selection on non-input elements
  document.addEventListener('selectstart', (e) => {
    if (e.target.matches('input, textarea, [contenteditable]')) return;
    if (e.target.closest('.msg-text-content')) return; // Allow selecting message text
    e.preventDefault();
  });

  // 3. Block developer tool shortcuts
  document.addEventListener('keydown', (e) => {
    // F12
    if (e.key === 'F12') { e.preventDefault(); return; }
    // Ctrl+Shift+I (Inspector)
    if (e.ctrlKey && e.shiftKey && e.key === 'I') { e.preventDefault(); return; }
    // Ctrl+Shift+J (Console)
    if (e.ctrlKey && e.shiftKey && e.key === 'J') { e.preventDefault(); return; }
    // Ctrl+Shift+C (Element picker)
    if (e.ctrlKey && e.shiftKey && e.key === 'C') { e.preventDefault(); return; }
    // Ctrl+U (View source)
    if (e.ctrlKey && e.key === 'u') { e.preventDefault(); return; }
    // Ctrl+S (Save page)
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); return; }
    // Ctrl+A (Select all — only block on non-inputs)
    if (e.ctrlKey && e.key === 'a' && !e.target.matches('input, textarea')) { e.preventDefault(); return; }
  });

  // 4. Disable copy on non-input elements (except message text for copy feature)
  document.addEventListener('copy', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.target.closest('.msg-text-content')) return;
    e.preventDefault();
  });

  // 5. Disable drag on images and links
  document.addEventListener('dragstart', (e) => {
    if (e.target.matches('img, a')) e.preventDefault();
  });

  // 6. Basic dev tools detection with blur overlay
  let devToolsOpen = false;
  const devToolsOverlay = document.createElement('div');
  devToolsOverlay.className = 'devtools-warning-overlay';
  devToolsOverlay.style.display = 'none';
  devToolsOverlay.innerHTML = `
    <div class="text-5xl mb-4">🔒</div>
    <h2>Content Protected</h2>
    <p>Developer tools are not allowed while using this app. Please close developer tools to continue.</p>
  `;
  document.body.appendChild(devToolsOverlay);

  function checkDevTools() {
    const threshold = 160;
    const widthThreshold = window.outerWidth - window.innerWidth > threshold;
    const heightThreshold = window.outerHeight - window.innerHeight > threshold;
    
    if (widthThreshold || heightThreshold) {
      if (!devToolsOpen) {
        devToolsOpen = true;
        devToolsOverlay.style.display = 'flex';
      }
    } else {
      if (devToolsOpen) {
        devToolsOpen = false;
        devToolsOverlay.style.display = 'none';
      }
    }
  }

  // Check periodically
  setInterval(checkDevTools, 1000);
  window.addEventListener('resize', checkDevTools);

  // 7. Console warning
  console.log(
    '%c⚠️ STOP!',
    'color: red; font-size: 40px; font-weight: bold;'
  );
  console.log(
    '%cThis browser feature is for developers. If someone told you to copy-paste something here, it\'s a scam.',
    'color: #333; font-size: 14px;'
  );

  // 8. Prevent iframe embedding
  if (window.top !== window.self) {
    window.top.location = window.self.location;
  }

  // 9. Platform-Specific Screenshot Protection
  // If running as a native Android app: Disable screenshots using the Android secure flag (FLAG_SECURE).
  // If running in a web browser: Do not attempt to block screenshots because browsers do not support reliable screenshot detection.
  function applyNativeScreenshotProtection() {
    const isAndroidNative = (
      (window.Android && typeof window.Android.enableFLAG_SECURE === 'function') ||
      (window.Android && typeof window.Android.setFlagSecure === 'function') ||
      (window.AndroidInterface && typeof window.AndroidInterface.enableFLAG_SECURE === 'function') ||
      (window.AndroidSecure && typeof window.AndroidSecure.enable === 'function') ||
      (window.NativeBridge && typeof window.NativeBridge.enableFLAG_SECURE === 'function') ||
      (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform() && window.Capacitor.getPlatform() === 'android') ||
      (window.cordova && window.cordova.platformId === 'android') ||
      window.isNativeAndroidApp === true
    );

    if (isAndroidNative) {
      try {
        if (window.Android && typeof window.Android.enableFLAG_SECURE === 'function') {
          window.Android.enableFLAG_SECURE();
        } else if (window.Android && typeof window.Android.setFlagSecure === 'function') {
          window.Android.setFlagSecure(true);
        } else if (window.AndroidInterface && typeof window.AndroidInterface.enableFLAG_SECURE === 'function') {
          window.AndroidInterface.enableFLAG_SECURE();
        } else if (window.AndroidSecure && typeof window.AndroidSecure.enable === 'function') {
          window.AndroidSecure.enable();
        } else if (window.NativeBridge && typeof window.NativeBridge.enableFLAG_SECURE === 'function') {
          window.NativeBridge.enableFLAG_SECURE();
        } else if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PrivacyScreen && typeof window.Capacitor.Plugins.PrivacyScreen.enable === 'function') {
          window.Capacitor.Plugins.PrivacyScreen.enable();
        } else if (window.plugins && window.plugins.preventscreenshot && typeof window.plugins.preventscreenshot.enable === 'function') {
          window.plugins.preventscreenshot.enable();
        }
        console.log('[Security] Native Android screenshot protection (FLAG_SECURE) activated.');
      } catch (err) {
        console.warn('[Security] Could not enable native FLAG_SECURE:', err);
      }
    } else {
      // In a web browser: Browsers do not support reliable screenshot detection.
      // Keep all existing functionality completely unchanged without attempting screenshot blocking.
    }
  }

  // Expose function globally for native bridge execution
  window.enableAndroidSecureFlag = applyNativeScreenshotProtection;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyNativeScreenshotProtection);
  } else {
    applyNativeScreenshotProtection();
  }
})();

