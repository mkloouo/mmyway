import { act, render } from '@testing-library/react-native';
import { Snackbar, type SnackbarEntry } from '../ui/Snackbar';

describe('Snackbar', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('dismisses 5 s after it appears, however often the screen re-renders with a new onDismiss', async () => {
    const entry: SnackbarEntry = { id: 'a', message: 'Confirmed', actionLabel: 'Undo', onAction: jest.fn() };
    const dismissed = jest.fn();
    // A new arrow on every render: what the Inbox used to pass, which restarted the timer.
    const view = await render(<Snackbar entry={entry} onDismiss={() => dismissed()} />);
    for (let i = 0; i < 4; i++) {
      await act(async () => { jest.advanceTimersByTime(1000); });
      await view.rerender(<Snackbar entry={entry} onDismiss={() => dismissed()} />);
    }
    expect(dismissed).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(dismissed).toHaveBeenCalledTimes(1);
  });
});
