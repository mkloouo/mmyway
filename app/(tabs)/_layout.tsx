import { Tabs, useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../../src/ui/theme';
import { useInboxSections } from '../../src/inbox/useInboxSections';

export default function TabsLayout() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  // The badge waits while a modal (a draft, Capture) is open over the tabs, and catches up after.
  const focused = useIsFocused();
  const { actionableCount } = useInboxSections({ enabled: focused });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.color.accent,
        tabBarInactiveTintColor: t.color.textFaint,
        tabBarStyle: {
          backgroundColor: t.color.surface,
          borderTopColor: t.color.border,
          borderTopWidth: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: tr('tabs.inbox'),
          tabBarBadge: actionableCount > 0 ? actionableCount : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="file-tray-full" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: tr('activity.title'),
          tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="planned"
        options={{
          title: tr('planned.title'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: tr('settings.title'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
