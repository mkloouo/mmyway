// The bottom of an edit screen: why it can't be saved yet (if it can't), over a full-width Save.
// With `onUndo` it is the "appears on changes" bar (kit board 2): a hairline strip with a summary,
// a ghost Undo and a Save at its natural width. The caller shows it only while there are changes.
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Button } from './kit';
import { useTheme } from './theme';

export function SaveBar({
  problemText,
  saving,
  disabled,
  onSave,
  summary,
  onUndo,
}: {
  problemText: string | null;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
  /** What changed, e.g. "Name changed". Only shown with `onUndo`. */
  summary?: string;
  /** Given: the appears-on-changes bar, with an Undo beside Save. */
  onUndo?: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const saveTitle = saving ? tr('common.saving') : tr('common.save');
  if (onUndo) {
    return (
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: t.color.border,
          backgroundColor: t.color.bg,
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.md,
          gap: t.space.sm,
        }}
      >
        {!!problemText && (
          <Text style={[t.type.label, { color: t.color.warn, textAlign: 'center' }]}>
            {problemText}
          </Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
          <Text style={[t.type.label, { color: t.color.textMuted, flex: 1 }]}>{summary}</Text>
          <Button title={tr('common.undo')} onPress={onUndo} variant="ghost" />
          <Button title={saveTitle} onPress={onSave} disabled={disabled} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ padding: t.space.lg, gap: t.space.sm }}>
      {!!problemText && (
        <Text style={[t.type.label, { color: t.color.warn, textAlign: 'center' }]}>
          {problemText}
        </Text>
      )}
      <Button title={saveTitle} onPress={onSave} disabled={disabled} size="lg" />
    </View>
  );
}
