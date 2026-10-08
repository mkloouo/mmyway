import { Tabs, useIsFocused } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../../src/ui/theme';
import { useActionableCount } from '../../src/inbox/useActionableCount';

export default function TabsLayout() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  // The badge waits while a modal (a draft, Capture) is open over the tabs, and catches up after.
  const focused = useIsFocused();
  const actionableCount = useActionableCount({ enabled: focused });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Tabs default to no animation at all: switching was a hard cut between two full screens,
        // the most-used move in the app. A cross-fade, the same as a push (app/_layout.tsx), so
        // every move in the app reads the same way.
        animation: 'fade',
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
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: tr('settings.title'),
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
