import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme, hitSize } from '../theme';
import { PRESSED_OPACITY } from './rows';

/**
 * Every top bar is this tall, whatever it holds (a title with a subtitle, a search field, a
 * selection count and its actions), so switching between them never moves the screen below.
 */
const BAR_HEIGHT = 72;
/** Icon buttons and buttons in a top bar are all this tall. */
const BAR_CONTROL_SIZE = 40;

/** The hairline under a screen's header, wherever that header ends. */
function barDivider(border: string, gap?: number): ViewStyle {
  return {
    borderBottomWidth: 1,
    borderBottomColor: border,
    ...(gap ? { marginBottom: gap } : null),
  };
}

/**
 * The row every top bar is laid out in; AppBar uses it, and so does a bar that swaps in a search field.
 * @deprecated Kit V2: use PushHeader, ModalHeader or the tab large title (docs/UI_KIT.md §3)
 */
export function BarRow({ children, divider = true }: { children: ReactNode; divider?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        height: BAR_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        // The hairline a screen's content scrolls under, so a list that runs off the top ends
        // somewhere rather than simply stopping. The list touches this line directly; any
        // breathing room before the first row belongs in its contentContainerStyle.
        ...(divider ? barDivider(t.color.border) : null),
      }}
    >
      {children}
    </View>
  );
}

/**
 * @deprecated Kit V2: use PushHeader, ModalHeader or the tab large title (docs/UI_KIT.md §3)
 */
export function AppBar({
  title,
  subtitle,
  left,
  right,
  divider,
}: {
  title: string;
  subtitle?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  /** See BarRow: off when the screen draws the line under more header of its own. */
  divider?: boolean;
}) {
  const t = useTheme();
  return (
    <BarRow divider={divider}>
      {left}
      <View style={{ flex: 1 }}>
        <Text style={[t.type.title, { color: t.color.text }]} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle &&
          (typeof subtitle === 'string' ? (
            <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : (
            subtitle
          ))}
      </View>
      {!!right && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>{right}</View>
      )}
    </BarRow>
  );
}

/**
 * The one look for an icon action in a top bar (close, search, more, settings).
 * @deprecated Kit V2: use PushHeader, ModalHeader or MoreButton (docs/UI_KIT.md §3)
 */
export function BarIconButton({
  icon,
  label,
  onPress,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({
        width: BAR_CONTROL_SIZE,
        height: BAR_CONTROL_SIZE,
        borderRadius: t.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? PRESSED_OPACITY : 1,
        backgroundColor: active ? t.color.accentSoft : undefined,
      })}
    >
      <Ionicons name={icon} size={24} color={active ? t.color.accent : t.color.text} />
    </Pressable>
  );
}

/**
 * The ✕ in a screen's top bar, which every full-screen route has.
 * @deprecated Kit V2: use ModalHeader or PushHeader (docs/UI_KIT.md §3)
 */
export function CloseButton({ onPress }: { onPress: () => void }) {
  const { t: tr } = useTranslation();
  return <BarIconButton icon="close" label={tr('common.close')} onPress={onPress} />;
}

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
        style={{
          height: hitSize,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: t.space.sm,
        }}
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
            paddingRight: t.space.sm,
            opacity: pressed ? PRESSED_OPACITY : 1,
          })}
        >
          <Ionicons name="chevron-back" size={24} color={t.color.accent} />
          <Text style={[t.type.heading, { color: t.color.accent }]}>{backLabel}</Text>
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
            <Text style={[leading ? t.type.amount : t.type.largeTitle, { color: t.color.text }]}>
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

/** TAB tier top bar. Large title (34/41 bold) with optional right-aligned action buttons or subtitle. */
export function TabHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: t.space.xl,
        paddingTop: t.space.xs,
        paddingBottom: t.space.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[t.type.largeTitle, { flex: 1, color: t.color.text }]} numberOfLines={1}>
          {title}
        </Text>
        {right}
      </View>
      {!!subtitle &&
        (typeof subtitle === 'string' ? (
          <Text style={[t.type.body, { color: t.color.textMuted }]}>{subtitle}</Text>
        ) : (
          subtitle
        ))}
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
