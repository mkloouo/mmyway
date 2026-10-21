import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme';

export interface DraftPartTabsProps {
  amounts: string[];
  pageIndex: number;
  onSelectPage: (index: number) => void;
}

export function DraftPartTabs({ amounts, pageIndex, onSelectPage }: DraftPartTabsProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <View
      style={{ flexDirection: 'row', gap: t.space.xs, paddingHorizontal: t.space.lg }}
      role="tablist"
      aria-label={tr('splits.partSelector')}
    >
      {amounts.map((amt, idx) => {
        const isSelected = idx === pageIndex;
        return (
          <Pressable
            key={idx}
            onPress={() => onSelectPage(idx)}
            role="tab"
            aria-selected={isSelected}
            style={{
              flex: 1,
              height: 44,
              borderRadius: t.radius.button,
              borderWidth: isSelected ? 2 : 1,
              borderColor: isSelected ? t.color.accent : t.color.border,
              backgroundColor: isSelected ? t.color.accentSoft : t.color.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={[
                t.type.caption,
                {
                  fontWeight: '600',
                  color: isSelected ? t.color.accent : t.color.textMuted,
                },
              ]}
            >
              {tr('splits.partN', { number: idx + 1, defaultValue: `Part ${idx + 1}` })}
            </Text>
            <Text
              style={[
                t.type.label,
                {
                  color: isSelected ? t.color.accent : t.color.text,
                  fontVariant: ['tabular-nums'],
                },
              ]}
            >
              {amt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
