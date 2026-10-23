// Sheet explaining how Ready to assign is calculated (Board 01 info button).
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Button, Sheet } from '../ui/kit';
import { useTheme } from '../ui/theme';

export function RtaInfoSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <Sheet visible={visible} onClose={onClose} title={tr('budget.howRtaTitle')}>
      <View style={{ gap: t.space.md, paddingBottom: t.space.lg }}>
        <Text style={[t.type.body, { color: t.color.text }]}>{tr('budget.howRtaBody')}</Text>
        <Button title={tr('common.done')} onPress={onClose} />
      </View>
    </Sheet>
  );
}
