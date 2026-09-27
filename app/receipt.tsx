// Receipt capture (design §6.8) — nearly invisible by design: the camera (or, from the Inbox's
// gallery shortcut, the gallery) opens on arrival, not after a form.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
import { Screen, AppBar, Button, Card, Row, Sheet } from '../src/ui/components';
import { captureReceipt, attachReceiptToJournal } from '../src/receipt/ingest';
import { pickPhoto, type PhotoSource } from '../src/receipt/pickPhoto';

const PARSE_WAIT_MS = 2000;

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

      // C2: attaching to an already-synced transaction — no inbox item, no parsing, just the upload.
      if (attachToJournalId) {
        await attachReceiptToJournal(db, { uri: photo.uri, transactionJournalId: attachToJournalId });
        router.back();
        return;
      }

      const result = await captureReceipt(db, { uri: photo.uri, base64: photo.base64, hint: hint || undefined });
      if (result.kind === 'duplicate') {
        router.replace(`/draft/${result.itemId}`);
        return;
      }

      // A fast parse opens straight into the draft; a slow one leaves the "Reading receipt…"
      // card in the Inbox as the notification instead of blocking here, and a failed one shows
      // up there under Needs attention.
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
      {/* After the photo is taken: hashing, saving and the first seconds of the parse. The
          screen used to sit empty here. */}
      {busy && !showChooser && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space.md, padding: t.space.xxl }}>
          <ActivityIndicator size="large" color={t.color.accent} />
          <Text style={[t.type.heading, { color: t.color.text }]}>{attachToJournalId ? 'Attaching…' : 'Reading receipt…'}</Text>
          {!attachToJournalId && (
            <Text style={[t.type.body, { color: t.color.textMuted, textAlign: 'center' }]}>
              If it takes longer than a moment, it carries on in the Inbox.
            </Text>
          )}
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
