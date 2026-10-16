// Settings → Receipt reading: who reads a receipt photo (none, the local model, or the local model
// with Gemini as backup), the local model that reads it, and the Gemini key that reads it only when
// the local model can't. Writes go through the same setters, probe and secure store as they did in
// Settings.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import {
  Button,
  Card,
  GroupFooter,
  ListRow,
  PushHeader,
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

function shortLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
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
  // The one setting that is typed before it's saved, so it needs a draft of its own.
  const [localModelNameInput, setLocalModelNameInput] = useState<string | null>(null);
  const localModelName = localModelNameInput ?? settings?.localModelName ?? '';

  // Only one sheet is ever open, so it is one state rather than a boolean each.
  const [sheet, setSheet] = useState<'localModel' | 'localAddresses' | 'gemini' | null>(null);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');

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

  // Set up means the model has a name and at least one address to reach it on.
  const localReady = (settings?.localModelName ?? '').trim() !== '' && localModelUrls.length > 0;
  let statusText: string | null = null;
  if (settings && receiptReader) {
    // Gemini only reads under 'auto', so a saved key counts for nothing under the other two.
    const geminiBackup = receiptReader === 'auto' && hasGeminiKey;
    if (receiptReader === 'none') {
      statusText = tr('receiptSettings.statusOff');
    } else if (receiptReader === 'local' && localReady) {
      statusText = tr('receiptSettings.statusLocalOnly');
    } else if (localReady) {
      statusText = geminiBackup
        ? tr('receiptSettings.statusBoth')
        : tr('receiptSettings.statusLocal');
    } else {
      statusText = geminiBackup
        ? tr('receiptSettings.statusGemini')
        : tr('receiptSettings.statusNone');
    }
  }

  return (
    <Screen bottom>
      <PushHeader
        backLabel={tr('settings.title')}
        onBack={() => router.back()}
        title={tr('receiptSettings.title')}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: SCREEN_TOP_PADDING, paddingBottom: t.space.xxl }}
      >
        <Text
          style={[
            t.type.body,
            { color: t.color.textMuted, paddingHorizontal: t.space.lg, paddingBottom: t.space.sm },
          ]}
        >
          {tr('receiptSettings.intro')}
        </Text>
        {statusText && (
          <Text style={[t.type.body, { color: t.color.text, paddingHorizontal: t.space.lg }]}>
            {statusText}
          </Text>
        )}

        <SectionHeader title={tr('receiptSettings.whoReads')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          {readerOptions.map((option, index) => (
            <ListRow
              key={option.value}
              first={index === 0}
              label={option.label}
              sub={option.sub}
              trailing={
                receiptReader === option.value ? (
                  <Ionicons name="checkmark" size={18} color={t.color.accent} />
                ) : undefined
              }
              onPress={() => chooseReader(option.value)}
            />
          ))}
        </Card>

        <SectionHeader title={tr('receiptSettings.yourModel')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('receiptSettings.modelName')}
            chevron
            value={localModelName || tr('settings.notSet')}
            onPress={() => setSheet('localModel')}
          />
          <ListRow
            label={tr('settings.addresses')}
            chevron
            value={
              localModelUrls.length > 0
                ? `${shortLabel(localModelActiveUrl ?? localModelUrls[0]!)}${localModelUrls.length > 1 ? ` +${localModelUrls.length - 1}` : ''}`
                : tr('settings.none')
            }
            onPress={() => setSheet('localAddresses')}
          />
        </Card>

        <SectionHeader title={tr('receiptSettings.googleGemini')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('settings.geminiKey')}
            chevron
            value={hasGeminiKey ? tr('settings.set') : tr('settings.notSet')}
            onPress={() => setSheet('gemini')}
          />
        </Card>
        <GroupFooter>{tr('receiptSettings.getKey')}</GroupFooter>
        <GroupFooter>{tr('settings.geminiPrivacy')}</GroupFooter>
        {hasGeminiKey && (
          <Card flush style={{ marginHorizontal: t.space.lg, marginTop: t.space.md }}>
            <ListRow
              first
              label={tr('receiptSettings.removeKey')}
              tone="danger"
              onPress={removeKey}
            />
          </Card>
        )}
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
        title={tr('settings.geminiApiKey')}
        footer={
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
      </Sheet>
    </Screen>
  );
}
