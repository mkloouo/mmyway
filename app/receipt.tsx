// Receipt capture (design §6.8) — nearly invisible by design: the camera (or, from the Inbox's
// gallery shortcut, the gallery) opens on arrival, not after a form.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
import { Screen, AppBar, BarIconButton, Button, Card, Row, Sheet } from '../src/ui/components';
import { captureReceipt, attachReceiptToJournal } from '../src/receipt/ingest';
import { pickPhoto, type PhotoSource } from '../src/receipt/pickPhoto';
import { requestSync, SYNC_DELAY } from '../src/sync/syncTrigger';
import { TextField } from '../src/ui/TextField';

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
  const { t: tr } = useTranslation();
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
          .catch((err) => Alert.alert(tr('receipt.attachFailed'), err instanceof Error ? err.message : String(err)));
        router.back();
        return;
      }

      captureReceipt(db, { uri: photo.uri, base64: photo.base64, hint: hint || undefined })
        .then((result) => {
          if (result.kind === 'duplicate') {
            Alert.alert(tr('receipt.duplicateTitle'), tr('receipt.duplicateBody'), [
              { text: tr('common.ok'), style: 'cancel' },
              { text: tr('receipt.openIt'), onPress: () => router.push(`/draft/${result.itemId}`) },
            ]);
          }
        })
        .catch((err) => Alert.alert(tr('receipt.saveFailed'), err instanceof Error ? err.message : String(err)));
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
        title={attachToJournalId ? tr('receipt.attachTitle') : tr('draft.receipt')}
        left={<BarIconButton icon="close" label={tr('common.close')} onPress={() => router.back()} />}
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
            {attachToJournalId ? tr('receipt.attachIntro') : tr('receipt.intro')}
          </Text>
          <View style={{ flexDirection: 'row', gap: t.space.md }}>
            <SourceTile icon="camera" label={tr('photo.camera')} onPress={() => capture('camera')} disabled={busy} />
            <SourceTile icon="images" label={tr('photo.gallery')} onPress={() => capture('gallery')} disabled={busy} />
          </View>
          {!attachToJournalId && (
            <Card>
              <Row first label={tr('receipt.hintTitle')} value={hint || tr('receipt.optional')} chevron onPress={() => setHintSheetOpen(true)} />
            </Card>
          )}
        </View>
      )}

      <Sheet
        visible={hintSheetOpen}
        onClose={() => setHintSheetOpen(false)}
        title={tr('receipt.hintTitle')}
        footer={<Button title={tr('common.done')} onPress={() => setHintSheetOpen(false)} />}
      >
        <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('receipt.hintBody')}</Text>
        <TextField
          value={hint}
          onChangeText={setHint}
          placeholder={tr('receipt.hintPlaceholder')}
          style={{ marginTop: t.space.sm }}
        />
      </Sheet>
    </Screen>
  );
}
