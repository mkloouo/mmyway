// Settings → Receipt reading: who reads a receipt photo (none, the local model, or the local model
// with Gemini as backup), the local model that reads it, and the Gemini key that reads it only when
// the local model can't. Writes go through the same setters, probe and secure store as they did in
// Settings.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import {
  Button,
  Card,
  Dot,
  GroupFooter,
  ListRow,
  PushHeader,
  RadioRow,
  SCREEN_TOP_PADDING,
  Screen,
  SectionHeader,
  Sheet,
} from '../../src/ui/kit';
import { AddressesSheet } from '../../src/ui/AddressesSheet';
import { TextField } from '../../src/ui/TextField';
import { useAction } from '../../src/ui/useAction';
import { confirmDestructive } from '../../src/ui/confirm';
import { loadSettings, SETTINGS_QUERY_KEY } from '../../src/settings/loadSettings';
import {
  getReceiptReader,
  setLocalModelBaseUrls,
  setLocalModelName,
  setReceiptReader,
  type ReceiptReader,
} from '../../src/settings/appSettings';
import { deleteGeminiKey, saveGeminiKey } from '../../src/settings/secrets';
import { probeLocalModel } from '../../src/receipt/providers/local';
import {
  testReaders,
  shortLabel,
  formatReaderSub,
  type ReaderTestResult,
  type ReadersTestSummary,
} from '../../src/receipt/testReaders';

function readerDot(r: ReaderTestResult | undefined, ok: string, err: string, faint: string) {
  return <Dot color={!r || r.status === 'not_configured' ? faint : r.status === 'ok' ? ok : err} />;
}

export default function ReceiptsScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => loadSettings(db),
  });
  // Under the settings key, so reload() refreshes it with the rest.
  const { data: receiptReader } = useQuery({
    queryKey: [...SETTINGS_QUERY_KEY, 'receiptReader'],
    queryFn: () => getReceiptReader(db),
  });
  /** Re-reads every setting. Called after a write and when a sheet that wrote one closes. */
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
  };

  const localModelUrls = settings?.localModelUrls ?? [];
  const localModelActiveUrl = settings?.localModelActiveUrl ?? null;
  const hasGeminiKey = settings?.hasGeminiKey ?? false;
  const geminiKeyTail = settings?.geminiKeyTail ?? null;
  // The one setting that is typed before it's saved, so it needs a draft of its own.
  const [localModelNameInput, setLocalModelNameInput] = useState<string | null>(null);
  const localModelName = localModelNameInput ?? settings?.localModelName ?? '';

  // Only one sheet is ever open, so it is one state rather than a boolean each.
  const [sheet, setSheet] = useState<'localModel' | 'localAddresses' | 'gemini' | null>(null);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');

  // Reader testing state
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<ReadersTestSummary | null>(null);
  const [testSheetVisible, setTestSheetVisible] = useState(false);

  const activeUrl = localModelActiveUrl ?? localModelUrls[0] ?? null;
  const { data: modelReachable = false } = useQuery({
    queryKey: ['localModelReachable', activeUrl],
    queryFn: () => (activeUrl ? probeLocalModel(activeUrl) : Promise.resolve(false)),
    enabled: !!activeUrl,
  });

  /** Keeps a double-tap on any Save from writing the same secret or setting twice. */
  const saveOnce = act(tr('common.save'), (write: () => Promise<void>) => write());
  const saving = act.pending(tr('common.save'));

  const chooseReader = act(tr('receiptSettings.whoReads'), async (next: ReceiptReader) => {
    if (next === receiptReader) return;
    await setReceiptReader(db, next);
    reload();
  });

  const removeKey = act(tr('receiptSettings.removeKey'), async () => {
    if (
      !(await confirmDestructive(
        tr('receiptSettings.removeKeyTitle'),
        tr('receiptSettings.removeKeyVerb'),
      ))
    )
      return;
    await deleteGeminiKey();
    reload();
    setSheet(null);
  });

  const runTest = act(tr('receiptSettings.testBothNow'), async () => {
    setTesting(true);
    try {
      const results = await testReaders(db);
      setTestResults(results);
      setTestSheetVisible(true);
    } finally {
      setTesting(false);
    }
  });

  const readerOptions: { value: ReceiptReader; label: string; sub: string }[] = [
    {
      value: 'none',
      label: tr('receiptSettings.readerNone'),
      sub: tr('receiptSettings.readerNoneSub'),
    },
    {
      value: 'local',
      label: tr('receiptSettings.readerLocal'),
      sub: tr('receiptSettings.readerLocalSub'),
    },
    {
      value: 'auto',
      label: tr('receiptSettings.readerAuto'),
      sub: tr('receiptSettings.readerAutoSub'),
    },
  ];

  const activeHost = activeUrl ? shortLabel(activeUrl) : null;
  const moreCount = Math.max(0, localModelUrls.length - 1);
  const addressSub = !activeHost ? (
    tr('settings.none')
  ) : (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
      <Dot color={modelReachable ? t.color.income : t.color.textFaint} />
      <Text style={[t.type.label, { color: t.color.textMuted }]}>
        {moreCount > 0
          ? tr('receiptSettings.addressAnswersMore', { host: activeHost, count: moreCount })
          : tr('receiptSettings.addressAnswers', { host: activeHost })}
      </Text>
    </View>
  );

  return (
    <Screen bottom>
      <PushHeader backLabel={tr('settings.title')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ paddingTop: SCREEN_TOP_PADDING, paddingBottom: t.space.xxl }}
      >
        <Text
          style={[
            t.type.largeTitle,
            { color: t.color.text, paddingHorizontal: t.space.lg, paddingBottom: t.space.xs },
          ]}
        >
          {tr('receiptSettings.title')}
        </Text>
        <Text
          style={[
            t.type.body,
            { color: t.color.textMuted, paddingHorizontal: t.space.lg, paddingBottom: t.space.md },
          ]}
        >
          {tr('receiptSettings.intro')}
        </Text>

        <SectionHeader title={tr('receiptSettings.whoReads')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          {readerOptions.map((option, index) => (
            <RadioRow
              key={option.value}
              first={index === 0}
              label={option.label}
              sub={option.sub}
              selected={receiptReader === option.value}
              onPress={() => chooseReader(option.value)}
            />
          ))}
        </Card>

        <SectionHeader title={tr('receiptSettings.yourModel')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('receiptSettings.modelName')}
            value={localModelName || tr('settings.notSet')}
            onPress={() => setSheet('localModel')}
          />
          <ListRow
            label={tr('receiptSettings.whereItRuns')}
            sub={addressSub}
            onPress={() => setSheet('localAddresses')}
          />
        </Card>

        <SectionHeader title={tr('receiptSettings.googleGemini')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('receiptSettings.apiKey')}
            value={geminiKeyTail ? `•••• ${geminiKeyTail}` : tr('settings.notSet')}
            onPress={() => setSheet('gemini')}
          />
        </Card>
        <GroupFooter>{tr('receiptSettings.getKey')}</GroupFooter>

        <View style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.xxl }}>
          <Button
            variant="ghost"
            title={testing ? tr('common.testing') : tr('receiptSettings.testBothNow')}
            disabled={testing}
            onPress={() => void runTest()}
            style={{
              borderWidth: 1,
              borderColor: t.color.border,
              backgroundColor: t.color.surface,
              minHeight: 48,
              borderRadius: t.radius.md,
            }}
          />
        </View>
      </ScrollView>

      <Sheet
        visible={sheet === 'localModel'}
        onClose={() => {
          setSheet(null);
          setLocalModelNameInput(null); // drop an unsaved edit, so the sheet reopens on the stored name
        }}
        title={tr('sync.providerLocal')}
        footer={
          <Button
            title={saving ? tr('common.saving') : tr('common.save')}
            disabled={saving}
            onPress={() =>
              saveOnce(async () => {
                await setLocalModelName(db, localModelName);
                setLocalModelNameInput(null);
                reload();
                setSheet(null);
              })
            }
          />
        }
      >
        <Card>
          <TextField
            value={localModelName}
            onChangeText={setLocalModelNameInput}
            placeholder={tr('settings.localModelPlaceholder')}
            autoCapitalize="none"
          />
        </Card>
      </Sheet>

      <AddressesSheet
        visible={sheet === 'localAddresses'}
        onClose={() => {
          setSheet(null);
          reload();
        }}
        title={tr('settings.localModelAddresses')}
        addresses={localModelUrls}
        activeAddress={localModelActiveUrl}
        onSave={async (list) => {
          await setLocalModelBaseUrls(db, list);
          reload();
        }}
        probe={probeLocalModel}
      />

      <Sheet
        visible={sheet === 'gemini'}
        onClose={() => setSheet(null)}
        title={tr('receiptSettings.apiKey')}
        footer={
          <View style={{ gap: t.space.sm }}>
            <Button
              title={saving ? tr('common.saving') : tr('common.save')}
              disabled={saving || !geminiKeyInput.trim()}
              onPress={() =>
                saveOnce(async () => {
                  await saveGeminiKey(geminiKeyInput);
                  reload();
                  setGeminiKeyInput('');
                  setSheet(null);
                })
              }
            />
            {hasGeminiKey && (
              <Button
                variant="ghost"
                textStyle={{ color: t.color.danger }}
                title={tr('receiptSettings.removeKey')}
                onPress={() => void removeKey()}
              />
            )}
          </View>
        }
      >
        <Card>
          <TextField
            value={geminiKeyInput}
            onChangeText={setGeminiKeyInput}
            placeholder={tr('settings.apiKeyPlaceholder')}
            secureTextEntry
            autoCapitalize="none"
          />
        </Card>
        <Text
          style={[
            t.type.label,
            { color: t.color.textMuted, marginHorizontal: t.space.xs, marginTop: t.space.sm },
          ]}
        >
          {tr('settings.geminiPrivacy')}
        </Text>
      </Sheet>

      <Sheet
        visible={testSheetVisible}
        onClose={() => setTestSheetVisible(false)}
        title={tr('receiptSettings.testTitle')}
      >
        <Card flush>
          <ListRow
            first
            leading={readerDot(
              testResults?.local,
              t.color.income,
              t.color.danger,
              t.color.textFaint,
            )}
            label={tr('sync.providerLocal')}
            sub={formatReaderSub(testResults?.local, tr, 'receiptSettings.testModelAnswered')}
            action={
              testResults?.local.status === 'error'
                ? {
                    label: tr('receiptSettings.fix'),
                    onPress: () => {
                      setTestSheetVisible(false);
                      setSheet('localModel');
                    },
                  }
                : undefined
            }
          />
          <ListRow
            leading={readerDot(
              testResults?.gemini,
              t.color.income,
              t.color.danger,
              t.color.textFaint,
            )}
            label={tr('receiptSettings.googleGemini')}
            sub={formatReaderSub(testResults?.gemini, tr, 'receiptSettings.testGeminiAnswered')}
            action={
              testResults?.gemini.status === 'error'
                ? {
                    label: tr('receiptSettings.fix'),
                    onPress: () => {
                      setTestSheetVisible(false);
                      setSheet('gemini');
                    },
                  }
                : undefined
            }
          />
        </Card>
      </Sheet>
    </Screen>
  );
}
