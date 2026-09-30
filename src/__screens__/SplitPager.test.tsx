// A receipt is one page per item, and each page is a card of rows with its sheets. Building all
// of them made every edit on a 25-item receipt re-render 25 pages, so only the page in view and
// its neighbours are built.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import '../i18n';
import { SplitPager } from '../ui/SplitPager';

const pln = { symbol: 'zł', decimalPlaces: 2 };

function pager(index: number, renderPage: (i: number) => React.ReactNode, count = 25) {
  return (
    <SplitPager
      total="100.00"
      count={count}
      index={index}
      onIndexChange={jest.fn()}
      currency={pln}
      type="withdrawal"
      leftover={0n}
      onTotalPress={jest.fn()}
      onReassign={jest.fn()}
      renderPage={renderPage}
    />
  );
}

describe('SplitPager', () => {
  it('builds the page in view and the two next to it, not all 25', async () => {
    const renderPage = jest.fn((i: number) => <Text>{`page ${i}`}</Text>);
    await render(pager(3, renderPage));
    const built = new Set(renderPage.mock.calls.map(([i]) => i));
    expect([...built].sort((a, b) => a - b)).toEqual([2, 3, 4]);
    expect(screen.getByText('page 3')).toBeTruthy();
    expect(screen.queryByText('page 10')).toBeNull();
  });

  it('builds only one neighbour at the ends', async () => {
    const renderPage = jest.fn((i: number) => <Text>{`page ${i}`}</Text>);
    await render(pager(0, renderPage));
    expect(new Set(renderPage.mock.calls.map(([i]) => i))).toEqual(new Set([0, 1]));
  });

  it('builds the pages around the new one when the screen moves the pager', async () => {
    const renderPage = jest.fn((i: number) => <Text>{`page ${i}`}</Text>);
    const { rerender } = await render(pager(0, renderPage));
    await rerender(pager(20, renderPage));
    expect(screen.getByText('page 20')).toBeTruthy();
    expect(screen.getByText('page 21')).toBeTruthy();
    expect(screen.queryByText('page 0')).toBeNull();
  });

  it('keeps one dot per item so a far page can still be tapped', async () => {
    const onIndexChange = jest.fn();
    await render(
      <SplitPager
        total="1.00"
        count={5}
        index={0}
        onIndexChange={onIndexChange}
        currency={pln}
        type="withdrawal"
        leftover={0n}
        onTotalPress={jest.fn()}
        onReassign={jest.fn()}
        renderPage={() => null}
      />,
    );
    await fireEvent.press(screen.getByLabelText('Split 5 / 5'));
    expect(onIndexChange).toHaveBeenCalledWith(4);
  });
});
