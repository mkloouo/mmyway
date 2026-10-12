// Settings → Reminders, and the first-time prompt sheet. The page's settings are read back from the
// test DB (src/db/testDb.ts) through the same getters the scheduler uses. New strings are not in
// en.json yet, so the tests find elements through i18n.t(key), which matches whatever the UI shows.
import type { ReactElement } from 'react';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import i18n from '../i18n';
import { createTestDb } from '../db/testDb';
import {
  getPlannedNotificationsEnabled,
  getReminderPromptShown,
  getReminderWhen,
} from '../settings/appSettings';
import { ReminderPromptSheet, shouldShowReminderPrompt } from '../planned/ReminderPromptSheet';
import RemindersScreen from '../../app/settings/reminders';

// `mock`-prefixed so Jest's hoisting lets the factories below close over it.
let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

// expo-router pulls in an untransformed ESM dependency under Jest; the navigation isn't under test.
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

// The live query's change listener needs the real expo-sqlite handle; a one-shot read is enough here.
jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

// The mock the planned notification tests use, plus the permission calls the page makes.
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('test-id'),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

// The first render of a screen is slow under Jest; the default 1s waits would give up on it.
configure({ asyncUtilTimeout: 10_000 });

function wrapSheet(ui: ReactElement) {
  return <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>;
}

function wrap(ui: ReactElement) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false, gcTime: Infinity },
              mutations: { gcTime: Infinity },
            },
          })
        }
      >
        {ui}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** Resolves once the stored settings are read: until then the switch shows off. */
async function renderPage() {
  await render(wrap(<RemindersScreen />));
  await waitFor(() => expect(screen.getByLabelText(i18n.t('reminders.enabled'))).toBeTruthy());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = createTestDb();
});

describe('Settings → Reminders', () => {
  it('renders with reminders off, so the When group is hidden', async () => {
    await renderPage();

    expect(screen.getByLabelText(i18n.t('reminders.enabled'))).toBeTruthy();
    expect(screen.queryByText(i18n.t('reminders.whenWeek'))).toBeNull();
  });

  it('turning reminders on checks OS permission and reveals the When group', async () => {
    await renderPage();

    await fireEvent.press(screen.getByLabelText(i18n.t('reminders.enabled')));

    await waitFor(() => expect(screen.getByText(i18n.t('reminders.whenWeek'))).toBeTruthy());
    expect(Notifications.getPermissionsAsync).toHaveBeenCalled();
    expect(await getPlannedNotificationsEnabled(mockDb)).toBe(true);
  });

  it('picking "A week before" stores week', async () => {
    await renderPage();
    await fireEvent.press(screen.getByLabelText(i18n.t('reminders.enabled')));
    await waitFor(() => expect(screen.getByText(i18n.t('reminders.whenWeek'))).toBeTruthy());

    await fireEvent.press(screen.getByText(i18n.t('reminders.whenWeek')));

    await waitFor(async () => expect(await getReminderWhen(mockDb)).toBe('week'));
  });
});

describe('ReminderPromptSheet', () => {
  it('"Not now" marks the prompt shown and calls onDone', async () => {
    const onDone = jest.fn();
    await render(
      wrapSheet(
        <ReminderPromptSheet visible plannedName="Rent" accountName="Checking" onDone={onDone} />,
      ),
    );

    await fireEvent.press(screen.getByText(i18n.t('reminders.notNow')));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(await getReminderPromptShown(mockDb)).toBe(true);
  });

  it('is due only until it has been shown, and only while reminders are off', async () => {
    expect(await shouldShowReminderPrompt(mockDb)).toBe(true);

    await renderPromptThenNotNow();

    expect(await shouldShowReminderPrompt(mockDb)).toBe(false);
  });
});

async function renderPromptThenNotNow() {
  const onDone = jest.fn();
  await render(wrapSheet(<ReminderPromptSheet visible plannedName="Rent" onDone={onDone} />));
  await fireEvent.press(screen.getByText(i18n.t('reminders.notNow')));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
}
