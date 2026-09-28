// Diagnostics: a production build leaves nothing behind when it fails on a
// real device, so the last few hundred warn/error lines are kept and can be shared out.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Share, Text, View } from 'react-native';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, Button, EmptyState } from '../../src/ui/components';
import { confirmDestructive } from '../../src/ui/confirm';
import { readLog, clearLog, shareableLog } from '../../src/utils/log';

export default function LogsScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [lines, setLines] = useState<string[]>(() => [...readLog()].reverse());

  async function shareLog() {
    if (lines.length === 0) return;
    await Share.share({ message: shareableLog([...lines].reverse()) });
  }

  async function onClear() {
    if (!await confirmDestructive(tr('logs.clearTitle'), tr('logs.clear'))) return;
    clearLog();
    setLines([]);
  }

  return (
    <Screen bottom>
      <AppBar title={tr('logs.title')} subtitle={tr('logs.subtitle', { count: lines.length })} />
      <FlatList
        data={lines}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.lg, gap: t.space.sm }}
        renderItem={({ item }) => (
          <Text selectable style={[t.type.label, { color: t.color.textMuted, fontFamily: 'monospace' }]}>{item}</Text>
        )}
        ListEmptyComponent={<EmptyState glyph="✓" title={tr('logs.emptyTitle')} hint={tr('logs.emptyHint')} />}
      />
      <View style={{ flexDirection: 'row', gap: t.space.sm, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm }}>
        <Button title={tr('logs.share')} onPress={shareLog} disabled={lines.length === 0} style={{ flex: 1 }} />
        <Button title={tr('logs.clear')} variant="danger" onPress={onClear} disabled={lines.length === 0} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}
