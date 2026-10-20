import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, Sheet } from './kit';
import { useTheme } from './theme';

export interface DateSheetProps {
  visible: boolean;
  onClose: () => void;
  dateMode: 'today' | 'yesterday' | 'custom';
  onPickToday: () => void;
  onPickYesterday: () => void;
  onPickCustom: () => void;
}

export function DateSheet({
  visible,
  onClose,
  dateMode,
  onPickToday,
  onPickYesterday,
  onPickCustom,
}: DateSheetProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <Sheet visible={visible} onClose={onClose} title={tr('fields.date')}>
      <View style={{ gap: t.space.sm }}>
        <Button
          title={tr('capture.today')}
          variant={dateMode === 'today' ? 'primary' : 'secondary'}
          onPress={onPickToday}
        />
        <Button
          title={tr('capture.yesterday')}
          variant={dateMode === 'yesterday' ? 'primary' : 'secondary'}
          onPress={onPickYesterday}
        />
        <Button title={tr('capture.pickDate')} variant="secondary" onPress={onPickCustom} />
      </View>
    </Sheet>
  );
}
