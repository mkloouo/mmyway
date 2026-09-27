import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../../src/ui/theme';
import { useInboxSections } from '../../src/inbox/useInboxSections';

export default function TabsLayout() {
  const t = useTheme();
  const { actionableCount } = useInboxSections();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.color.accent,
        tabBarInactiveTintColor: t.color.textFaint,
        tabBarStyle: { backgroundColor: t.color.surface, borderTopColor: t.color.border, borderTopWidth: 1 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inbox',
          tabBarBadge: actionableCount > 0 ? actionableCount : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="file-tray-full" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
