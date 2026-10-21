import { useTranslation } from 'react-i18next';
import { Image, Pressable } from 'react-native';
import { Card, ListRow, SectionHeader, Tile } from '../kit';
import { useTheme } from '../theme';

export interface DraftReceiptSectionProps {
  rowKind: string;
  receiptImagePath: string | null | undefined;
  rowState: string;
  itemCount: number;
  readBy?: { provider: string; model: string } | null;
  onAttachPhoto: () => void;
  onShowPhoto: () => void;
}

export function DraftReceiptSection({
  rowKind,
  receiptImagePath,
  rowState,
  itemCount,
  readBy,
  onAttachPhoto,
  onShowPhoto,
}: DraftReceiptSectionProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  const isReceiptOrHasImage = rowKind === 'receipt' || !!receiptImagePath;
  const canAttach = rowKind !== 'receipt' && !receiptImagePath && rowState !== 'synced';

  if (!canAttach && !isReceiptOrHasImage) {
    return null;
  }

  if (canAttach) {
    return (
      <Card flush style={{ marginHorizontal: t.space.lg }}>
        <ListRow
          first
          leading={<Tile icon="camera" size={40} />}
          label={tr('capture.receiptPhoto')}
          subtitle={tr('capture.cameraOrLibrary')}
          chevron
          onPress={onAttachPhoto}
        />
      </Card>
    );
  }

  return (
    <>
      <SectionHeader title={tr('capture.receiptPhoto')} />
      <Card flush style={{ marginHorizontal: t.space.lg }}>
        <Pressable
          onPress={onShowPhoto}
          accessibilityRole="button"
          accessibilityLabel={tr('draft.showPhoto')}
        >
          <ListRow
            first
            leading={
              receiptImagePath ? (
                <Image
                  source={{ uri: receiptImagePath }}
                  resizeMode="cover"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: t.radius.sm,
                    backgroundColor: t.color.surfaceAlt,
                  }}
                />
              ) : (
                <Tile icon="receipt-outline" size={40} />
              )
            }
            label={
              itemCount > 0 ? tr('draft.itemCount', { count: itemCount }) : tr('draft.receipt')
            }
            subtitle={
              readBy
                ? tr('draft.readBy', {
                    provider: readBy.provider,
                    model: readBy.model,
                  })
                : undefined
            }
            chevron
          />
        </Pressable>
      </Card>
    </>
  );
}
