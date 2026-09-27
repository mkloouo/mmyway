// Diagnostics: a production build leaves nothing behind when it fails on a
// real device, so the last few hundred warn/error lines are kept and can be shared out.
import { useState } from 'react';
import { FlatList, Share, Text, View } from 'react-native';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, Button, EmptyState } from '../../src/ui/components';
import { confirmDestructive } from '../../src/ui/confirm';
import { readLog, clearLog } from '../../src/utils/log';

export default function LogsScreen() {
  const t = useTheme();
  const [lines, setLines] = useState<string[]>(() => [...readLog()].reverse());

  async function shareLog() {
    if (lines.length === 0) return;
    await Share.share({ message: [...lines].reverse().join('\n') });
  }

  async function onClear() {
    if (!await confirmDestructive('Clear the log?', 'Clear')) return;
    clearLog();
    setLines([]);
  }

  return (
    <Screen bottom>
      <AppBar title="Diagnostics" subtitle={`${lines.length} lines, newest first`} />
      <FlatList
        data={lines}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.lg, gap: t.space.sm }}
        renderItem={({ item }) => (
          <Text selectable style={[t.type.label, { color: t.color.textMuted, fontFamily: 'monospace' }]}>{item}</Text>
        )}
        ListEmptyComponent={<EmptyState glyph="✓" title="Nothing logged" hint="Warnings and errors show up here." />}
      />
      <View style={{ flexDirection: 'row', gap: t.space.sm, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm }}>
        <Button title="Share" onPress={shareLog} disabled={lines.length === 0} style={{ flex: 1 }} />
        <Button title="Clear" variant="danger" onPress={onClear} disabled={lines.length === 0} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}
