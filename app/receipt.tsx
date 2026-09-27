// Receipt capture (design §6.8) — nearly invisible by design: the camera opens on arrival, not
// after a form.
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
import { Screen, AppBar, Button, Row, Sheet } from '../src/ui/components';
import { captureReceipt, attachReceiptToJournal } from '../src/receipt/ingest';

const PARSE_WAIT_MS = 2000;

async function pickImage(source: 'camera' | 'gallery') {
  const permission = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 })
    : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7 });
  if (result.canceled || !result.assets[0]?.base64) return null;
  return result.assets[0];
}

export default function ReceiptScreen() {
  const db = useDb();
  const t = useTheme();
  const { attachToJournalId } = useLocalSearchParams<{ attachToJournalId?: string }>();
  const [hint, setHint] = useState('');
  const [hintSheetOpen, setHintSheetOpen] = useState(false);
  const [showChooser, setShowChooser] = useState(false);
  const [busy, setBusy] = useState(false);
  const autoLaunched = useRef(false);

  async function capture(source: 'camera' | 'gallery') {
    if (busy) return;
    setBusy(true);
    setShowChooser(false);
    try {
      const asset = await pickImage(source);
      if (!asset?.base64) {
        setShowChooser(true);
        return;
      }

      // C2: attaching to an already-synced transaction — no inbox item, no parsing, just the upload.
      if (attachToJournalId) {
        await attachReceiptToJournal(db, { uri: asset.uri, transactionJournalId: attachToJournalId });
        router.back();
        return;
      }

      const result = await captureReceipt(db, { uri: asset.uri, base64: asset.base64, hint: hint || undefined });
      if (result.kind === 'duplicate') {
        router.replace(`/draft/${result.itemId}`);
        return;
      }

      // A fast local-model parse (~2s) opens straight into the draft; a slow one leaves the
      // "Reading receipt…" card in the Inbox as the notification instead of blocking here, and a
      // failed one shows up there under Needs attention.
      const parsed = await Promise.race([
        result.parse,
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), PARSE_WAIT_MS)),
      ]);
      router.replace(parsed === 'parsed' ? `/draft/${result.itemId}` : '/');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoLaunched.current) return;
    autoLaunched.current = true;
    capture('camera');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen bottom>
      <AppBar title={attachToJournalId ? 'Attach receipt' : 'Receipt'} />
      {showChooser && (
        <View style={{ padding: t.space.lg, gap: t.space.md }}>
          <Button title="Take photo" onPress={() => capture('camera')} disabled={busy} />
          <Button title="Choose from gallery" onPress={() => capture('gallery')} disabled={busy} />
          {!attachToJournalId && (
            <Row label="Hint" value={hint || 'Optional'} chevron onPress={() => setHintSheetOpen(true)} />
          )}
        </View>
      )}

      <Sheet
        visible={hintSheetOpen}
        onClose={() => setHintSheetOpen(false)}
        title="Hint for the provider"
        footer={<Button title="Done" onPress={() => setHintSheetOpen(false)} />}
      >
        <Text style={[t.type.label, { color: t.color.textMuted }]}>A short note to help the model read this receipt.</Text>
        <TextInput
          value={hint}
          onChangeText={setHint}
          placeholder="e.g. this is a fuel receipt"
          placeholderTextColor={t.color.textFaint}
          style={{
            borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm,
            padding: t.space.md, color: t.color.text, marginTop: t.space.sm,
          }}
        />
      </Sheet>
    </Screen>
  );
}
