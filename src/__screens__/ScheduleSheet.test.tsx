import { fireEvent, render, screen } from '@testing-library/react-native';
import { type ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { ScheduleSheet } from '../ui/ScheduleSheet';
import type { Repetition } from '../planned/repetition';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function wrap(ui: ReactElement) {
  return <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>;
}

describe('ScheduleSheet', () => {
  const defaultRep: Repetition = {
    type: 'monthly',
    moment: '15',
    skip: 0,
    weekend: 1,
  };

  it('renders summary callout with schedule and until you change it', async () => {
    const onChange = jest.fn();
    await render(
      wrap(
        <ScheduleSheet
          visible={true}
          onClose={jest.fn()}
          repeats={true}
          repetitions={[defaultRep]}
          end={{ kind: 'forever' }}
          date="2026-10-15"
          onChange={onChange}
        />,
      ),
    );

    // Callout title contains until you change it
    expect(screen.getByText(/until you change it/i)).toBeTruthy();
    // Starts card with First date and Time
    expect(screen.getByText('First date')).toBeTruthy();
    expect(screen.getByText('Time')).toBeTruthy();
    // Frequency segmented control options
    expect(screen.getByText('Month')).toBeTruthy();
    expect(screen.getByText('Week')).toBeTruthy();
    expect(screen.getByText('Day')).toBeTruthy();
    expect(screen.getByText('Year')).toBeTruthy();
    expect(screen.getByText('Once')).toBeTruthy();
  });

  it('switches frequency via segmented control', async () => {
    const onChange = jest.fn();
    await render(
      wrap(
        <ScheduleSheet
          visible={true}
          onClose={jest.fn()}
          repeats={true}
          repetitions={[defaultRep]}
          end={{ kind: 'forever' }}
          date="2026-10-15"
          onChange={onChange}
        />,
      ),
    );

    await fireEvent.press(screen.getByText('Week'));
    expect(onChange).toHaveBeenCalledWith({
      repeats: true,
      repetitions: [expect.objectContaining({ type: 'weekly' })],
    });

    await fireEvent.press(screen.getByText('Once'));
    expect(onChange).toHaveBeenCalledWith({
      repeats: false,
    });
  });

  it('changes interval with stepper row', async () => {
    const onChange = jest.fn();
    await render(
      wrap(
        <ScheduleSheet
          visible={true}
          onClose={jest.fn()}
          repeats={true}
          repetitions={[defaultRep]}
          end={{ kind: 'forever' }}
          date="2026-10-15"
          onChange={onChange}
        />,
      ),
    );

    // Stepper + button increases interval
    const moreBtn = screen.getByLabelText('Increase Every');
    await fireEvent.press(moreBtn);
    expect(onChange).toHaveBeenCalledWith({
      repetitions: [expect.objectContaining({ skip: 1 })],
    });
  });

  it('switches end conditions via RadioRows', async () => {
    const onChange = jest.fn();
    await render(
      wrap(
        <ScheduleSheet
          visible={true}
          onClose={jest.fn()}
          repeats={true}
          repetitions={[defaultRep]}
          end={{ kind: 'forever' }}
          date="2026-10-15"
          onChange={onChange}
        />,
      ),
    );

    await fireEvent.press(screen.getByText('On a date'));
    expect(onChange).toHaveBeenCalledWith({
      end: expect.objectContaining({ kind: 'until' }),
    });

    await fireEvent.press(screen.getByText('After a number of times'));
    expect(onChange).toHaveBeenCalledWith({
      end: expect.objectContaining({ kind: 'times' }),
    });
  });
});
