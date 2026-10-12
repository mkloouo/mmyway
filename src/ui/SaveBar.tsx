// The bottom of an edit screen: why it can't be saved yet (if it can't), over a full-width Save.
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Button } from './components';
import { useTheme } from './theme';

export function SaveBar({
  problemText,
  saving,
  disabled,
  onSave,
}: {
  problemText: string | null;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View style={{ padding: t.space.lg, gap: t.space.sm }}>
      {!!problemText && (
        <Text style={[t.type.label, { color: t.color.warn, textAlign: 'center' }]}>
          {problemText}
        </Text>
      )}
      <Button
        title={saving ? tr('common.saving') : tr('common.save')}
        onPress={onSave}
        disabled={disabled}
        size="lg"
      />
    </View>
  );
}
