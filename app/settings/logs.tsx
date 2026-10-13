// Diagnostics: a production build leaves nothing behind when it fails on a
// real device, so the last few hundred warn/error lines are kept and can be shared out.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Share, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/ui/theme';
import { Button, EmptyState, PushHeader, SCREEN_TOP_PADDING, Screen } from '../../src/ui/kit';
import { confirmDestructive } from '../../src/ui/confirm';
import { readLog, clearLog, shareableLog } from '../../src/utils/log';
import { useAction } from '../../src/ui/useAction';

export default function LogsScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const [lines, setLines] = useState<string[]>(() => [...readLog()].reverse());

  const shareLog = act(tr('logs.share'), async () => {
    if (lines.length === 0) return;
    await Share.share({ message: shareableLog([...lines].reverse()) });
  });

  const onClear = act(tr('logs.clear'), async () => {
    if (!(await confirmDestructive(tr('logs.clearTitle'), tr('logs.clear')))) return;
    clearLog();
    setLines([]);
  });

  return (
    <Screen bottom>
      <PushHeader
        backLabel={tr('settings.title')}
        onBack={() => router.back()}
        title={tr('logs.title')}
        subtitle={tr('logs.subtitle', { count: lines.length })}
      />
      <FlatList
        data={lines}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{
          paddingHorizontal: t.space.lg,
          paddingTop: SCREEN_TOP_PADDING,
          paddingBottom: t.space.lg,
          gap: t.space.sm,
        }}
        renderItem={({ item }) => (
          <Text
            selectable
            style={[t.type.label, { color: t.color.textMuted, fontFamily: 'monospace' }]}
          >
            {item}
          </Text>
        )}
        ListEmptyComponent={
          <EmptyState glyph="✓" title={tr('logs.emptyTitle')} hint={tr('logs.emptyHint')} />
        }
      />
      <View
        style={{
          flexDirection: 'row',
          gap: t.space.sm,
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.sm,
        }}
      >
        <Button
          title={tr('logs.share')}
          onPress={shareLog}
          disabled={lines.length === 0}
          style={{ flex: 1 }}
        />
        <Button
          title={tr('logs.clear')}
          variant="danger"
          onPress={onClear}
          disabled={lines.length === 0}
          style={{ flex: 1 }}
        />
      </View>
    </Screen>
  );
}
