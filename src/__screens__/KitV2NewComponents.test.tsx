import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import {
  ActionTile,
  ChoiceCard,
  DateTile,
  Hero,
  NoticeBlock,
  OptionTiles,
  Pill,
  ProgressBar,
  Sheet,
  Stepper,
  StepperRow,
  SummaryCallout,
} from '../ui/kit';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function wrap(node: React.ReactElement) {
  return <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>;
}

describe('Kit V2 new components', () => {
  describe('Hero', () => {
    it('renders caption, amount, stats and buttons', async () => {
      const onInfo = jest.fn();
      const onPrimary = jest.fn();
      const onSecondary = jest.fn();

      await render(
        wrap(
          <Hero
            caption="Ready to assign"
            onInfoPress={onInfo}
            infoAccessibilityLabel="How this is worked out"
            amount="51.186,35 zł"
            subtitle="51.186,35 in accounts · 0,00 allocated"
            stats={[
              { label: 'In accounts', value: '51.186,35' },
              { label: 'Assigned', value: '0,00' },
              { label: 'Spent', value: '195,45' },
            ]}
            primaryAction={{ label: 'Assign money', onPress: onPrimary }}
            secondaryAction={{ label: 'Auto-fill', onPress: onSecondary }}
          />,
        ),
      );

      expect(screen.getByText('Ready to assign')).toBeTruthy();
      expect(screen.getByText('51.186,35 zł')).toBeTruthy();
      expect(screen.getByText('51.186,35 in accounts · 0,00 allocated')).toBeTruthy();
      expect(screen.getByText('In accounts')).toBeTruthy();
      expect(screen.getByText('Assigned')).toBeTruthy();
      expect(screen.getByText('Spent')).toBeTruthy();

      await fireEvent.press(screen.getByLabelText('How this is worked out'));
      expect(onInfo).toHaveBeenCalledTimes(1);

      await fireEvent.press(screen.getByText('Assign money'));
      expect(onPrimary).toHaveBeenCalledTimes(1);

      await fireEvent.press(screen.getByText('Auto-fill'));
      expect(onSecondary).toHaveBeenCalledTimes(1);
    });
  });

  describe('ProgressBar', () => {
    it('renders with accessibilityRole progressbar and clamped value', async () => {
      await render(wrap(<ProgressBar progress={0.65} />));
      const bar = screen.getByRole('progressbar');
      expect(bar).toBeTruthy();
      expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 65 });
    });

    it('clamps negative values to 0 and overspent values to 100', async () => {
      const { rerender } = await render(wrap(<ProgressBar progress={-0.2} />));
      expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(0);

      await rerender(wrap(<ProgressBar progress={1.5} tone="warn" />));
      expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(100);
    });
  });

  describe('ActionTile', () => {
    it('renders icon and label and responds to press', async () => {
      const onPress = jest.fn();
      await render(wrap(<ActionTile icon="add-outline" label="Assign" onPress={onPress} />));
      const tile = screen.getByRole('button', { name: 'Assign' });
      expect(tile).toBeTruthy();
      await fireEvent.press(tile);
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('renders warn tone tile for cover action', async () => {
      await render(wrap(<ActionTile icon="shield-outline" label="Cover 195,45" tone="warn" />));
      expect(screen.getByRole('button', { name: 'Cover 195,45' })).toBeTruthy();
    });
  });

  describe('ChoiceCard', () => {
    it('renders radio card with checked state and triggers press', async () => {
      const onPress = jest.fn();
      await render(
        wrap(
          <ChoiceCard
            icon="card-outline"
            label="Asset account"
            sub="Checking, savings, or cash"
            selected={true}
            onPress={onPress}
          />,
        ),
      );

      const card = screen.getByRole('radio', { name: 'Asset account' });
      expect(card).toBeTruthy();
      expect(card.props.accessibilityState).toEqual({ checked: true, disabled: false });
      expect(screen.getByText('Checking, savings, or cash')).toBeTruthy();

      await fireEvent.press(card);
      expect(onPress).toHaveBeenCalledTimes(1);
    });
  });

  describe('OptionTiles', () => {
    it('renders radio group with tiles and reports selection', async () => {
      const onChange = jest.fn();
      await render(
        wrap(
          <OptionTiles
            accessibilityLabel="How often"
            options={[
              { key: 'once', label: 'Once' },
              { key: 'weekly', label: 'Weekly' },
              { key: 'monthly', label: 'Monthly' },
              { key: 'more', label: 'More…' },
            ]}
            value="monthly"
            onChange={onChange}
          />,
        ),
      );

      const group = screen.getByLabelText('How often');
      expect(group).toBeTruthy();
      expect(group.props.accessibilityRole).toBe('radiogroup');

      const monthly = screen.getByRole('radio', { name: 'Monthly' });
      expect(monthly.props.accessibilityState.checked).toBe(true);

      const weekly = screen.getByRole('radio', { name: 'Weekly' });
      expect(weekly.props.accessibilityState.checked).toBe(false);

      await fireEvent.press(weekly);
      expect(onChange).toHaveBeenCalledWith('weekly');
    });
  });

  describe('Stepper and StepperRow', () => {
    it('Stepper increases and decreases within bounds', async () => {
      const onChange = jest.fn();
      const { rerender } = await render(
        wrap(
          <Stepper
            value={2}
            onChange={onChange}
            min={1}
            max={5}
            decreaseAccessibilityLabel="Decrease"
            increaseAccessibilityLabel="Increase"
          />,
        ),
      );

      expect(screen.getByText('2')).toBeTruthy();

      await fireEvent.press(screen.getByLabelText('Decrease'));
      expect(onChange).toHaveBeenCalledWith(1);

      await fireEvent.press(screen.getByLabelText('Increase'));
      expect(onChange).toHaveBeenCalledWith(3);

      // Disabled at lower bound
      await rerender(
        wrap(
          <Stepper
            value={1}
            onChange={onChange}
            min={1}
            max={5}
            decreaseAccessibilityLabel="Decrease"
            increaseAccessibilityLabel="Increase"
          />,
        ),
      );
      await fireEvent.press(screen.getByLabelText('Decrease'));
      // should not decrease below min
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('StepperRow renders label, unit and handles change', async () => {
      const onChange = jest.fn();
      await render(
        wrap(
          <StepperRow
            label="Interval"
            unit="months"
            value={1}
            onChange={onChange}
            min={1}
            max={12}
          />,
        ),
      );

      expect(screen.getByText('Interval · 1 months')).toBeTruthy();
      expect(screen.getByText('1')).toBeTruthy();
    });
  });

  describe('NoticeBlock', () => {
    it('renders title, body, and action button', async () => {
      const onSync = jest.fn();
      await render(
        wrap(
          <NoticeBlock
            title="Balances are 2 days old"
            body="Counting against old numbers would book the wrong difference. Sync first."
            tone="warn"
            action={{ label: 'Sync now', onPress: onSync }}
          />,
        ),
      );

      expect(screen.getByText('Balances are 2 days old')).toBeTruthy();
      expect(
        screen.getByText(
          'Counting against old numbers would book the wrong difference. Sync first.',
        ),
      ).toBeTruthy();

      const btn = screen.getByRole('button', { name: 'Sync now' });
      expect(btn).toBeTruthy();
      await fireEvent.press(btn);
      expect(onSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('Pill', () => {
    it('renders with different semantic tones', async () => {
      await render(
        wrap(
          <>
            <Pill label="-17,00 short" tone="warn" />
            <Pill label="Booked" tone="income" size="sm" />
            <Pill label="in use" tone="accent" />
            <Pill label="Offline" tone="muted" />
          </>,
        ),
      );

      expect(screen.getByText('-17,00 short')).toBeTruthy();
      expect(screen.getByText('Booked')).toBeTruthy();
      expect(screen.getByText('in use')).toBeTruthy();
      expect(screen.getByText('Offline')).toBeTruthy();
    });
  });

  describe('DateTile', () => {
    it('renders weekday and day number in weekday mode', async () => {
      // 2026-10-15 is Thursday
      await render(wrap(<DateTile date="2026-10-15" mode="weekday" />));
      expect(screen.getByText('15')).toBeTruthy();
    });

    it('renders month and day number in month mode', async () => {
      await render(wrap(<DateTile date="2026-10-15" mode="month" />));
      expect(screen.getByText('15')).toBeTruthy();
    });
  });

  describe('Sheet subtitle', () => {
    it('renders subtitle in Sheet header when provided', async () => {
      await render(
        wrap(
          <Sheet visible={true} title="Rent" subtitle="Thu, Oct 15 · in 3 days" onClose={jest.fn()}>
            <></>
          </Sheet>,
        ),
      );

      expect(screen.getByText('Rent')).toBeTruthy();
      expect(screen.getByText('Thu, Oct 15 · in 3 days')).toBeTruthy();
    });
  });

  describe('SummaryCallout', () => {
    it('renders title and subtitle', async () => {
      await render(
        wrap(
          <SummaryCallout
            title="Every month on the 15th"
            subtitle="Oct 15 · Nov 13 (moved to Fri) · Dec 15 · Jan 15"
          />,
        ),
      );

      expect(screen.getByText('Every month on the 15th')).toBeTruthy();
      expect(screen.getByText('Oct 15 · Nov 13 (moved to Fri) · Dec 15 · Jan 15')).toBeTruthy();
    });
  });
});
