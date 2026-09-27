// Receipt capture (design §6.8) — nearly invisible by design: the camera (or, from the Inbox's
// gallery shortcut, the gallery) opens on arrival, not after a form.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
import { Screen, AppBar, Button, Card, Row, Sheet } from '../src/ui/components';
import { captureReceipt, attachReceiptToJournal } from '../src/receipt/ingest';
import { pickPhoto, type PhotoSource } from '../src/receipt/pickPhoto';
import { requestSync, SYNC_DELAY } from '../src/sync/syncTrigger';

function SourceTile({ icon, label, onPress, disabled }: { icon: 'camera' | 'images'; label: string; onPress: () => void; disabled: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1, aspectRatio: 1, borderRadius: t.radius.lg, backgroundColor: t.color.accentSoft,
        alignItems: 'center', justifyContent: 'center', gap: t.space.md, opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={40} color={t.color.accent} />
      <Text style={[t.type.heading, { color: t.color.accent }]}>{label}</Text>
    </Pressable>
  );
}

export default function ReceiptScreen() {
  const db = useDb();
  const t = useTheme();
  const { attachToJournalId, source } = useLocalSearchParams<{ attachToJournalId?: string; source?: PhotoSource }>();
  const [hint, setHint] = useState('');
  const [hintSheetOpen, setHintSheetOpen] = useState(false);
  const [showChooser, setShowChooser] = useState(false);
  const [busy, setBusy] = useState(false);
  const autoLaunched = useRef(false);

  async function capture(from: PhotoSource) {
    if (busy) return;
    setBusy(true);
    setShowChooser(false);
    try {
      const photo = await pickPhoto(from);
      if (!photo) {
        setShowChooser(true);
        return;
      }

      // Nothing below waits on the photo being hashed, copied or read: the screen closes as soon as
      // the picker hands the photo over, so the next receipt is one tap away. The card appears in
      // the Inbox ("Reading receipt…") when the insert lands, and fills in when the parse does.
      if (attachToJournalId) {
        // C2: attaching to an already-synced transaction — no inbox item, no parsing, just the upload.
        attachReceiptToJournal(db, { uri: photo.uri, transactionJournalId: attachToJournalId })
          .then(() => requestSync(SYNC_DELAY.afterWrite))
          .catch((err) => Alert.alert('Couldn\u2019t attach the photo', err instanceof Error ? err.message : String(err)));
        router.back();
        return;
      }

      captureReceipt(db, { uri: photo.uri, base64: photo.base64, hint: hint || undefined })
        .then((result) => {
          if (result.kind === 'duplicate') {
            Alert.alert('Already in the Inbox', 'This photo was captured before.', [
              { text: 'OK', style: 'cancel' },
              { text: 'Open it', onPress: () => router.push(`/draft/${result.itemId}`) },
            ]);
          }
        })
        .catch((err) => Alert.alert('Couldn\u2019t save the receipt', err instanceof Error ? err.message : String(err)));
      router.replace('/');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoLaunched.current) return;
    autoLaunched.current = true;
    capture(source === 'gallery' ? 'gallery' : 'camera');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen bottom>
      <AppBar
        title={attachToJournalId ? 'Attach receipt' : 'Receipt'}
        left={(
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={t.color.text} />
          </Pressable>
        )}
      />
      {/* Only while the camera/gallery is opening — the screen closes the moment a photo comes back. */}
      {busy && !showChooser && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space.md, padding: t.space.xxl }}>
          <ActivityIndicator size="large" color={t.color.accent} />
        </View>
      )}
      {showChooser && (
        <View style={{ flex: 1, padding: t.space.lg, gap: t.space.xl, justifyContent: 'center' }}>
          <Text style={[t.type.body, { color: t.color.textMuted, textAlign: 'center' }]}>
            {attachToJournalId ? 'Pick the photo to attach to this transaction.' : 'Photograph the receipt, or pick a photo or screenshot you already have.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: t.space.md }}>
            <SourceTile icon="camera" label="Camera" onPress={() => capture('camera')} disabled={busy} />
            <SourceTile icon="images" label="Gallery" onPress={() => capture('gallery')} disabled={busy} />
          </View>
          {!attachToJournalId && (
            <Card>
              <Row first label="Hint for the reader" value={hint || 'Optional'} chevron onPress={() => setHintSheetOpen(true)} />
            </Card>
          )}
        </View>
      )}

      <Sheet
        visible={hintSheetOpen}
        onClose={() => setHintSheetOpen(false)}
        title="Hint for the reader"
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
