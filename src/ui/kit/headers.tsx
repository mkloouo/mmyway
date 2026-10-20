import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, type ScrollViewProps, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme, hitSize } from '../theme';
import { PRESSED_OPACITY } from './rows';
import { Screen } from './layout';
import { Button, StickyFooter } from './actions';

/**
 * The unified icon action button (accent, 44×44 touch area).
 * Used across TabHeader, PushHeader, ModalHeader, Sheet and in-screen actions.
 */
export function IconButton({
  icon,
  label,
  accessibilityLabel,
  onPress,
  active,
  variant = 'standard',
  color,
  size = 24,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  accessibilityLabel?: string;
  onPress: () => void;
  active?: boolean;
  variant?: 'standard' | 'tinted';
  color?: string;
  size?: number;
  disabled?: boolean;
}) {
  const t = useTheme();
  const accLabel = accessibilityLabel ?? label ?? '';
  const iconColor = color ?? t.color.accent;
  const isTinted = variant === 'tinted' || active;
  const dimension = variant === 'tinted' ? 28 : hitSize;
  const iconSize = variant === 'tinted' && size === 24 ? 18 : size;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accLabel}
      hitSlop={variant === 'tinted' ? 8 : 4}
      style={({ pressed }) => ({
        width: dimension,
        height: dimension,
        borderRadius: t.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? PRESSED_OPACITY : 1,
        backgroundColor: isTinted ? t.color.accentSoft : undefined,
      })}
    >
      <Ionicons name={icon} size={iconSize} color={iconColor} />
    </Pressable>
  );
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
  left,
  children,
}: {
  title?: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  left?: ReactNode;
  children?: ReactNode;
}) {
  const t = useTheme();
  if (children) {
    return (
      <View
        style={{
          minHeight: hitSize,
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.md,
          paddingHorizontal: t.space.xl,
          paddingTop: t.space.xs,
          paddingBottom: t.space.md,
        }}
      >
        {children}
      </View>
    );
  }
  return (
    <View
      style={{
        paddingHorizontal: t.space.xl,
        paddingTop: t.space.xs,
        paddingBottom: t.space.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        {left}
        {title != null && (
          <Text style={[t.type.largeTitle, { flex: 1, color: t.color.text }]} numberOfLines={1}>
            {title}
          </Text>
        )}
        {!!right && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
            {right}
          </View>
        )}
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
        <IconButton
          icon="close"
          accessibilityLabel={tr('common.cancel')}
          onPress={onClose}
          color={t.color.text}
          size={22}
        />
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

export interface ModalWizardPrimaryAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  hint?: string;
  testID?: string;
}

export interface ModalWizardProps {
  title: string;
  step: number;
  total: number;
  onClose: () => void;
  stepLabel?: string;
  problem?: string | null;
  onBack?: () => void;
  backLabel?: string;
  primary: ModalWizardPrimaryAction;
  children?: ReactNode;
  afterFooter?: ReactNode;
  scrollProps?: Partial<ScrollViewProps>;
}

/**
 * MODAL tier multi-step frame (kit board 3, MKL-85).
 * Composes ModalHeader, a scrolling content area with keyboard avoidance,
 * an optional problem text above the pinned StickyFooter, and primary/back actions.
 */
export function ModalWizard({
  title,
  step,
  total,
  onClose,
  stepLabel,
  problem,
  onBack,
  backLabel,
  primary,
  children,
  afterFooter,
  scrollProps,
}: ModalWizardProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <Screen modal bottom avoidKeyboard>
      <ModalHeader
        title={title}
        onClose={onClose}
        step={step}
        steps={total}
        stepLabel={stepLabel ?? tr('account.stepOf', { step, total })}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: t.space.xl, paddingTop: t.space.sm }}
        keyboardShouldPersistTaps="handled"
        {...scrollProps}
      >
        {children}
      </ScrollView>

      {!!problem && (
        <Text
          style={[
            t.type.label,
            { color: t.color.danger, marginHorizontal: t.space.lg, marginTop: t.space.sm },
          ]}
        >
          {problem}
        </Text>
      )}

      <StickyFooter>
        {!!onBack && (
          <View style={{ flex: 1 }}>
            <Button
              title={backLabel ?? tr('account.back')}
              size="lg"
              variant="secondary"
              onPress={onBack}
            />
          </View>
        )}
        <View style={{ flex: onBack ? 2 : 1 }} testID={primary.testID}>
          <Button
            title={primary.label}
            size="lg"
            disabled={primary.disabled}
            hint={primary.hint}
            onPress={primary.onPress}
          />
        </View>
      </StickyFooter>

      {afterFooter}
    </Screen>
  );
}
