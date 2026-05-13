import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NivocaAi from '../../modules/nivoca-ai';
import { AppWebView } from '../components/webview/app-webview';
import { getDeviceEligibility } from '../lib/ai/device-eligibility';

/**
 * Home screen — loads the web app in a WebView.
 * Mobile app enforces auth-only: no guest mode.
 *
 * SafeAreaView edges=['top'] pushes WebView below the notch/status bar.
 * Bottom is NOT included — the web app handles home indicator area.
 */
export default function HomeScreen() {
  const colorScheme = useColorScheme();
  // Match the web app's `--background` variable so the home-indicator
  // strip below the WebView and the status-bar strip above it blend with
  // the rendered HTML, avoiding the white iOS chrome flash on keyboard
  // dismiss or first paint.
  const bg = colorScheme === 'dark' ? '#0a0a0a' : '#ffffff';

  useEffect(() => {
    // Phase A verification beacon — proves the native module is wired all
    // the way through autolinking + JSI on the running device. Will be
    // removed in Phase C once real status emission takes over.
    try {
      // eslint-disable-next-line no-console
      console.log('[nivoca-ai]', NivocaAi.ping());
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[nivoca-ai] ping failed:', err);
    }
    // Phase B sanity log — confirm the device-eligibility whitelist resolves
    // a real `Device.modelId`. Removed once the bridge wires this through
    // `AI_MODEL_STATUS_RESULT.deviceSupported` in Phase C.
    // eslint-disable-next-line no-console
    console.log('[nivoca-ai] eligibility', JSON.stringify(getDeviceEligibility()));
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top']}>
      <AppWebView />
    </SafeAreaView>
  );
}
