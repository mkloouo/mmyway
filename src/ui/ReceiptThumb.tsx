// One receipt thumbnail on the transaction screen. A photo on the phone shows at once; one FF3
// holds is downloaded into the cache first (src/receipt/attachmentFiles.ts), with a spinner while
// it loads and a line saying it couldn't be loaded instead of a silent grey box.
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { attachmentFile } from '../receipt/attachmentFiles';
import type { ReceiptPreview } from '../receipt/journalAttachments';
import { useTheme } from './theme';

const HEIGHT = 140;

export function ReceiptThumb({ preview, onOpen }: { preview: ReceiptPreview; onOpen: (uri: string) => void }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { headers } = preview.source;
  const download = useQuery({
    queryKey: ['attachment-file', preview.key],
    queryFn: () => attachmentFile(preview.key, { uri: preview.source.uri, headers: headers! }),
    enabled: !!headers,
    staleTime: Infinity,
    retry: 1,
  });
  const uri = headers ? download.data : preview.source.uri;
  const box = { width: '100%' as const, height: HEIGHT, borderRadius: t.radius.sm, backgroundColor: t.color.surfaceAlt };

  if (!uri) {
    return (
      <View style={[box, { alignItems: 'center', justifyContent: 'center', padding: t.space.md }]}>
        {download.isError
          ? <Text style={[t.type.label, { color: t.color.textMuted, textAlign: 'center' }]}>{tr('transaction.photoLoadFailed')}</Text>
          : <ActivityIndicator color={t.color.accent} accessibilityLabel={tr('common.loading')} />}
      </View>
    );
  }
  return (
    <Pressable onPress={() => onOpen(uri)} accessibilityRole="imagebutton" accessibilityLabel={tr('draft.showPhoto')}>
      <Image source={{ uri }} resizeMode="cover" style={box} />
    </Pressable>
  );
}
