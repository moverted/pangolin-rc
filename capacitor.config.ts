import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pangolinrc.remote',
  appName: 'PangolinRC',
  webDir: 'www',
  plugins: {
    // WKWebView does NOT feed window.visualViewport the soft-keyboard geometry, so the
    // flat app's visualViewport-based lift never fired and the composer stayed pinned
    // behind the keyboard. Keep the native webview un-resized ('none') and shrink the
    // panel ourselves off the reliable keyboardWillShow event (see flat_shell.js).
    Keyboard: { resize: 'none' as any, resizeOnFullScreen: true }
  }
};

export default config;
