// The redesign's building blocks for the three modal tiers and list rows. Screens pick a tier:
// PUSH (a page on the stack: "‹ Back" in accent, a save bar once something changed, rare actions
// behind •••), MODAL (a full-screen flow: ✕ top-left, one sticky primary at the bottom, steps when
// it has more than one screen), SHEET (see Sheet in components.tsx). Styling only through useTheme().
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme, hitSize } from './theme';
import { PRESSED_OPACITY, ROW_HEIGHT } from './components';

type IconName = keyof typeof Ionicons.glyphMap;

/** PUSH tier top bar. `title` adds the large title block below the bar. */
export function PushHeader({
  backLabel,
  onBack,
  right,
  title,
  subtitle,
  leading,
}: {
  backLabel: string;
  onBack: () => void;
  right?: ReactNode;
  title?: string;
  subtitle?: string;
  leading?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View>
      <View
        style={{ height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}
      >
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          hitSlop={4}
          style={({ pressed }) => ({
            minHeight: hitSize,
            flexDirection: 'row',
            alignItems: 'center',
            paddingRight: 8,
            opacity: pressed ? PRESSED_OPACITY : 1,
          })}
        >
          <Ionicons name="chevron-back" size={24} color={t.color.accent} />
          <Text style={{ fontSize: 17, lineHeight: 22, color: t.color.accent }}>{backLabel}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {title != null && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space.md,
            paddingHorizontal: t.space.xl,
            paddingBottom: t.space.md,
          }}
        >
          {leading}
          <View style={{ flex: 1 }}>
            <Text style={[t.type.title, { fontSize: 28, lineHeight: 34, color: t.color.text }]}>
              {title}
            </Text>
            {!!subtitle && (
              <Text style={[t.type.body, { color: t.color.textMuted }]}>{subtitle}</Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

/** The ••• in a PUSH header: rare actions live behind it, not in the bar. */
export function MoreButton({ onPress, label }: { onPress: () => void; label: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({
        width: hitSize,
        height: hitSize,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? PRESSED_OPACITY : 1,
      })}
    >
      <Ionicons name="ellipsis-horizontal" size={24} color={t.color.text} />
    </Pressable>
  );
}

/** MODAL tier top bar: ✕ on the left, and step bars when the flow has more than one screen. */
export function ModalHeader({
  title,
  onClose,
  step,
  steps,
  stepLabel,
  right,
}: {
  title: string;
  onClose: () => void;
  /** 1-based current step. */
  step?: number;
  steps?: number;
  /** "Step 1 of 2"; read by screen readers on the progress bars too. */
  stepLabel?: string;
  right?: React.ReactNode;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View>
      <View
        style={{
          height: 56,
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.sm,
          paddingHorizontal: 8,
        }}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={tr('common.cancel')}
          hitSlop={4}
          style={({ pressed }) => ({
            width: hitSize,
            height: hitSize,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? PRESSED_OPACITY : 1,
          })}
        >
          <Ionicons name="close" size={22} color={t.color.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[t.type.heading, { color: t.color.text }]} numberOfLines={1}>
            {title}
          </Text>
          {!!stepLabel && (
            <Text style={[t.type.label, { color: t.color.textMuted }]}>{stepLabel}</Text>
          )}
        </View>
        {right}
      </View>
      {steps != null && steps > 1 && (
        <View
          accessibilityLabel={stepLabel}
          style={{
            flexDirection: 'row',
            gap: 6,
            paddingHorizontal: 16,
            paddingBottom: t.space.sm,
          }}
        >
          {Array.from({ length: steps }, (_, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                backgroundColor: i < (step ?? 0) ? t.color.accent : t.color.border,
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/** MODAL tier footer: one primary button (flex 2) beside Back (flex 1), pinned above the home indicator. */
export function StickyFooter({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: t.color.border,
        backgroundColor: t.color.bg,
        paddingTop: 12,
        paddingHorizontal: t.space.lg,
        paddingBottom: Math.max(insets.bottom, 12),
        flexDirection: 'row',
        gap: 10,
      }}
    >
      {children}
    </View>
  );
}

/** A segmented control: one option is selected, the track sits on surfaceAlt. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: 'row',
        backgroundColor: t.color.surfaceAlt,
        borderRadius: t.radius.sm,
        padding: 2,
      }}
    >
      {options.map((o) => {
        const selected = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? t.color.surface : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: '600',
                color: selected ? t.color.text : t.color.textMuted,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type TileTone = 'accent' | 'warn' | 'income' | 'danger' | 'muted';

/** A rounded square holding an icon: the leading mark of a row or a PUSH header. */
export function Tile({
  icon,
  tone = 'accent',
  size = 28,
  iconSize,
}: {
  icon: IconName;
  tone?: TileTone;
  size?: number;
  iconSize?: number;
}) {
  const t = useTheme();
  const { bg, fg } = tileColors(t, tone);
  return (
    <View
      style={{
        width: size,
        height: size,
        // 8 at 28, 14 at 52: one ratio, so the corner scales with the tile.
        borderRadius: Math.round(size * 0.27),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
      }}
    >
      <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.57)} color={fg} />
    </View>
  );
}

function tileColors(t: ReturnType<typeof useTheme>, tone: TileTone): { bg: string; fg: string } {
  switch (tone) {
    case 'warn':
      return { bg: t.color.warnSoft, fg: t.color.warn };
    case 'income':
      return { bg: t.color.surfaceAlt, fg: t.color.income };
    case 'danger':
      return { bg: t.color.dangerSoft, fg: t.color.danger };
    case 'muted':
      return { bg: t.color.surfaceAlt, fg: t.color.textMuted };
    case 'accent':
      return { bg: t.color.accentSoft, fg: t.color.accent };
  }
}

/**
 * A row inside a `<Card flush>` group. The hairline above it starts after the leading tile, or at
 * the row's own inset when there is none. `first` drops the hairline.
 */
export function ListRow({
  label,
  sub,
  leading,
  trailing,
  chevron,
  onPress,
  onLongPress,
  first,
  tone,
}: {
  label: string;
  sub?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  first?: boolean;
  tone?: 'default' | 'danger';
}) {
  const t = useTheme();
  const interactive = !!onPress || !!onLongPress;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      style={({ pressed }) => ({
        minHeight: ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        opacity: pressed ? PRESSED_OPACITY : 1,
      })}
    >
      {!first && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            left: leading ? 56 : 16,
            height: 1,
            backgroundColor: t.color.border,
          }}
        />
      )}
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={[t.type.body, { color: tone === 'danger' ? t.color.danger : t.color.text }]}>
          {label}
        </Text>
        {!!sub && (
          <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {trailing}
      {chevron && <Ionicons name="chevron-forward" size={16} color={t.color.textFaint} />}
    </Pressable>
  );
}

/** A footnote under a group: indented to sit with the card's text, not its edge. */
export function GroupFooter({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text
      style={{
        marginHorizontal: t.space.lg,
        paddingHorizontal: t.space.xs,
        paddingTop: 6,
        fontSize: 13,
        lineHeight: 17,
        color: t.color.textMuted,
      }}
    >
      {children}
    </Text>
  );
}
