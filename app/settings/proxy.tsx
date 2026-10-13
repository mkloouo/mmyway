// Settings → Reverse proxy: extra headers sent with every Firefly III request, for an instance
// behind an authenticating proxy (Cloudflare Access). Storage and the rules live in
// src/api/ff3/proxyHeaders.ts; this screen only edits a list of pairs.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/ui/theme';
import {
  Button,
  Card,
  PushHeader,
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

  // Shown per row only once something has been typed into it, so a freshly added empty row
  // isn't already red.
  const problemOf = (p: Pair): ProxyHeaderProblem | null =>
    p.name === '' && p.value === '' ? null : proxyHeaderProblem(p.name.trim(), p.value);

  const filled = pairs.filter((p) => p.name !== '' || p.value !== '');
  const problems = filled.map(problemOf);
  const canSave = loaded && problems.every((problem) => problem === null);

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
    <Screen bottom>
      <PushHeader
        backLabel={tr('settings.connectionBack')}
        onBack={() => router.back()}
        title={tr('proxy.title')}
        subtitle={tr('proxy.subtitle')}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: SCREEN_TOP_PADDING, paddingBottom: t.space.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={[
            t.type.body,
            { color: t.color.textMuted, paddingHorizontal: t.space.lg, paddingBottom: t.space.md },
          ]}
        >
          {tr('proxy.explainer')}
        </Text>

        <SectionHeader
          title={tr('proxy.headersSection')}
          action={
            pairs.length === 0 ? (
              <Button
                title={tr('proxy.useCloudflare')}
                variant="ghost"
                onPress={() => setPairs(CLOUDFLARE_PAIR.map((p) => ({ ...p })))}
              />
            ) : undefined
          }
        />

        {pairs.length > 0 && (
          <Card flush style={{ marginHorizontal: t.space.lg }}>
            {pairs.map((pair, index) => {
              const problem = problemOf(pair);
              return (
                <View
                  key={index}
                  style={{
                    padding: t.space.md,
                    gap: t.space.sm,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: t.color.border,
                  }}
                >
                  <View style={{ gap: t.space.sm }}>
                    <TextField
                      value={pair.name}
                      onChangeText={(name) => set(index, { name })}
                      placeholder={tr('proxy.namePlaceholder')}
                      autoCapitalize="none"
                      autoCorrect={false}
                      invalid={problem === 'name' || problem === 'reserved'}
                    />
                    <TextField
                      value={pair.value}
                      onChangeText={(value) => set(index, { value })}
                      placeholder={tr('proxy.valuePlaceholder')}
                      autoCapitalize="none"
                      autoCorrect={false}
                      // A proxy secret is a credential; keep it off the screen like the API token.
                      secureTextEntry
                      invalid={problem === 'value'}
                    />
                    {problem && (
                      <Text style={[t.type.label, { color: t.color.danger }]}>
                        {tr(`proxy.problems.${problem}`)}
                      </Text>
                    )}
                    <Button
                      title={tr('proxy.removeHeader')}
                      variant="ghost"
                      onPress={() => setPairs((list) => list.filter((_, i) => i !== index))}
                    />
                  </View>
                </View>
              );
            })}
          </Card>
        )}

        <Card flush style={{ marginHorizontal: t.space.lg, marginTop: t.space.md }}>
          <View style={{ padding: t.space.xs }}>
            <Button
              title={tr('proxy.addHeader')}
              variant="ghost"
              onPress={() => setPairs((list) => [...list, { name: '', value: '' }])}
            />
          </View>
        </Card>
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          gap: t.space.sm,
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.sm,
        }}
      >
        <Button title={tr('proxy.save')} onPress={save} disabled={!canSave} style={{ flex: 1 }} />
        <Button
          title={tr('proxy.clearAll')}
          variant="danger"
          onPress={clear}
          disabled={pairs.length === 0}
          style={{ flex: 1 }}
        />
      </View>
    </Screen>
  );
}

export default function ProxyRoute() {
  return (
    <RequireFlag name="reverse_proxy">
      <ProxyPage />
    </RequireFlag>
  );
}
