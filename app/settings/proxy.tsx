// Settings → Reverse proxy: extra headers sent with every Firefly III request, for an instance
// behind an authenticating proxy (Cloudflare Access). Storage and the rules live in
// src/api/ff3/proxyHeaders.ts; this screen only edits a list of pairs.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/ui/theme';
import {
  Button,
  Card,
  FieldRow,
  GroupFooter,
  ListRow,
  PushHeader,
  PRESSED_OPACITY,
  ROW_HEIGHT,
  SCREEN_TOP_PADDING,
  Screen,
  SectionHeader,
} from '../../src/ui/kit';
import { TextField } from '../../src/ui/TextField';
import { useAction } from '../../src/ui/useAction';
import { confirmDestructive } from '../../src/ui/confirm';
import {
  loadProxyHeaders,
  proxyHeaderProblem,
  writeProxyHeaders,
  type ProxyHeaderProblem,
} from '../../src/api/ff3/proxyHeaders';
import { SETTINGS_QUERY_KEY } from '../../src/settings/loadSettings';
import { RequireFlag } from '../../src/flags/RequireFlag';

interface Pair {
  name: string;
  value: string;
}

const CLOUDFLARE_PAIR: Pair[] = [
  { name: 'CF-Access-Client-Id', value: '' },
  { name: 'CF-Access-Client-Secret', value: '' },
];

function ProxyPage() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const queryClient = useQueryClient();
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void loadProxyHeaders().then((stored) => {
      setPairs(Object.entries(stored).map(([name, value]) => ({ name, value })));
      setLoaded(true);
    });
  }, []);

  const set = (index: number, patch: Partial<Pair>) =>
    setPairs((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const problemOf = (p: Pair): ProxyHeaderProblem | null =>
    p.name === '' && p.value === '' ? null : proxyHeaderProblem(p.name.trim(), p.value);

  const filled = pairs.filter((p) => p.name !== '' || p.value !== '');
  const problems = filled.map(problemOf);
  const firstProblem = problems.find((p): p is ProxyHeaderProblem => p !== null);
  const canSave = loaded && !firstProblem;

  const save = act(tr('proxy.save'), async () => {
    await writeProxyHeaders(
      Object.fromEntries(filled.map((p) => [p.name.trim(), p.value] as const)),
    );
    await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
  });

  const clear = act(tr('proxy.clearAll'), async () => {
    if (!(await confirmDestructive(tr('proxy.clearAllTitle'), tr('proxy.clearAll')))) return;
    await writeProxyHeaders({});
    setPairs([]);
    await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
  });

  return (
    <Screen bottom avoidKeyboard>
      <PushHeader
        backLabel={tr('settings.connectionBack')}
        onBack={() => router.back()}
        title={tr('proxy.title')}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: SCREEN_TOP_PADDING, paddingBottom: t.space.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={[
            t.type.body,
            { color: t.color.textMuted, paddingHorizontal: t.space.xl, paddingBottom: t.space.md },
          ]}
        >
          {tr('proxy.explainer')}
        </Text>

        <SectionHeader
          title={tr('proxy.headersSection')}
          action={
            <Pressable
              onPress={() => setPairs(CLOUDFLARE_PAIR.map((p) => ({ ...p })))}
              accessibilityRole="button"
              accessibilityLabel={tr('proxy.useCloudflare')}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? PRESSED_OPACITY : 1 })}
            >
              <Text style={[t.type.label, { color: t.color.accent, fontWeight: '500' }]}>
                {tr('proxy.useCloudflare')}
              </Text>
            </Pressable>
          }
        />

        {pairs.length > 0 && (
          <Card flush style={{ marginHorizontal: t.space.lg }}>
            {pairs.map((pair, index) => {
              const problem = problemOf(pair);
              return (
                <View key={index}>
                  <FieldRow first={index === 0} label={tr('proxy.name')} labelWidth={64}>
                    <TextField
                      value={pair.name}
                      onChangeText={(name) => set(index, { name })}
                      placeholder={tr('proxy.namePlaceholder')}
                      autoCapitalize="none"
                      autoCorrect={false}
                      invalid={problem === 'name' || problem === 'reserved'}
                      style={styles.fieldInput}
                    />
                  </FieldRow>
                  <FieldRow label={tr('proxy.value')} labelWidth={64}>
                    <View style={[styles.valueRow, { gap: t.space.sm }]}>
                      <TextField
                        value={pair.value}
                        onChangeText={(value) => set(index, { value })}
                        placeholder={tr('proxy.valuePlaceholder')}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                        invalid={problem === 'value'}
                        style={styles.fieldInput}
                      />
                      <Pressable
                        onPress={() => setPairs((list) => list.filter((_, i) => i !== index))}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={tr('proxy.removeHeader')}
                        style={({ pressed }) => [
                          styles.removeBtn,
                          { paddingVertical: t.space.xs, opacity: pressed ? PRESSED_OPACITY : 1 },
                        ]}
                      >
                        <Text style={[t.type.label, { color: t.color.danger }]}>
                          {tr('proxy.removeHeader')}
                        </Text>
                      </Pressable>
                    </View>
                  </FieldRow>
                </View>
              );
            })}
          </Card>
        )}

        <Card flush style={{ marginHorizontal: t.space.lg, marginTop: t.space.md }}>
          <ListRow
            first
            label={tr('proxy.addHeader')}
            tone="accent"
            onPress={() => setPairs((list) => [...list, { name: '', value: '' }])}
          />
        </Card>
        <GroupFooter>{tr('proxy.basicAuthFootnote')}</GroupFooter>
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.md,
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.sm,
          borderTopWidth: 1,
          borderTopColor: t.color.border,
          backgroundColor: t.color.bg,
        }}
      >
        <Pressable
          onPress={clear}
          disabled={pairs.length === 0}
          accessibilityRole="button"
          accessibilityLabel={tr('proxy.clearAll')}
          style={({ pressed }) => ({
            height: ROW_HEIGHT,
            justifyContent: 'center',
            paddingHorizontal: t.space.sm,
            opacity: pairs.length === 0 ? 0.4 : pressed ? PRESSED_OPACITY : 1,
          })}
        >
          <Text style={[t.type.body, { color: t.color.danger }]}>{tr('proxy.clearAll')}</Text>
        </Pressable>
        <Button
          title={tr('proxy.save')}
          size="lg"
          onPress={save}
          disabled={!canSave}
          hint={firstProblem ? tr(`proxy.problems.${firstProblem}`) : undefined}
          style={{ flex: 1 }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fieldInput: {
    flex: 1,
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    textAlign: 'right',
    backgroundColor: 'transparent',
  },
  valueRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  removeBtn: {
    justifyContent: 'center',
  },
});

export default function ProxyRoute() {
  return (
    <RequireFlag name="reverse_proxy">
      <ProxyPage />
    </RequireFlag>
  );
}
