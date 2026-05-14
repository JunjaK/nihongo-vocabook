/**
 * Phase 0 PoC debug screen — drives `runPoc()` from a button tap.
 *
 * Dev-only — guarded by __DEV__. Production builds redirect to home.
 * Delete this file in Task 0.10 (PoC cleanup) after the gate decision lands.
 *
 * Navigate to /_debug-poc on the running dev client. Tap "Start" to run the
 * scenario catalog three times and capture per-scenario PASS/FAIL plus the
 * full raw model output. The full JSON dump appears in the Metro / device
 * console — save it as `_docs/ai-chat-poc-results-raw.json`.
 */

import { useState } from 'react';
import { Redirect } from 'expo-router';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  runPoc,
  formatReport,
  type ScenarioResult,
  type Summary,
} from '../../scripts/poc-tool-calling';

export default function DebugPocScreen() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState('');
  const [runCount, setRunCount] = useState(0);

  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  async function start() {
    setRunning(true);
    try {
      const { results, summary } = await runPoc();
      setReport(formatReport(summary, results));
      const dump = JSON.stringify(
        { runIndex: runCount + 1, summary, results },
        null,
        2,
      );
      // Visible in Metro / device console. Copy the whole block into
      // _docs/ai-chat-poc-results-raw[-runN].json.
      console.log('=== PoC FULL DUMP BEGIN ===');
      console.log(dump);
      console.log('=== PoC FULL DUMP END ===');
      setRunCount((n) => n + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setReport(`Runner crashed: ${msg}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>AI PoC Runner</Text>
        <Text style={styles.subtitle}>
          Runs the scenario catalog against on-device Gemma 4 E2B and reports
          tool-calling accuracy. Full dump goes to the console.
        </Text>
        <View style={styles.buttonRow}>
          <Button
            title={running ? 'Running…' : `Start (run ${runCount + 1})`}
            onPress={start}
            disabled={running}
          />
        </View>
        <Text style={styles.report}>{report || '(no run yet)'}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  scroll: { padding: 16 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  subtitle: { fontSize: 13, color: '#666', marginBottom: 16 },
  buttonRow: { marginBottom: 16 },
  report: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: '#222',
    lineHeight: 16,
  },
});
