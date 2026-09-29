import * as SecureStore from 'expo-secure-store';
import { readHosts, writeHosts, resolveAddress, withTimeout } from './hosts';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const getItemAsync = SecureStore.getItemAsync as jest.Mock;
const setItemAsync = SecureStore.setItemAsync as jest.Mock;

beforeEach(() => {
  getItemAsync.mockReset();
  setItemAsync.mockReset();
});

describe('readHosts', () => {
  it('reads the JSON array when present', async () => {
    getItemAsync.mockResolvedValueOnce(
      JSON.stringify(['https://a.example.com', 'https://b.example.com']),
    );
    expect(await readHosts()).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('falls back to the legacy single ff3_host key as a one-element list', async () => {
    getItemAsync
      .mockResolvedValueOnce(null) // ff3_hosts: not present
      .mockResolvedValueOnce('https://legacy.example.com'); // ff3_host: legacy value
    expect(await readHosts()).toEqual(['https://legacy.example.com']);
  });

  it('returns an empty list when nothing is stored', async () => {
    getItemAsync.mockResolvedValue(null);
    expect(await readHosts()).toEqual([]);
  });
});

describe('writeHosts', () => {
  it('stores the list as JSON under the hosts key', async () => {
    await writeHosts(['https://a.example.com']);
    expect(setItemAsync).toHaveBeenCalledWith(
      'ff3_hosts',
      JSON.stringify(['https://a.example.com']),
    );
  });
});

describe('resolveAddress', () => {
  it('tries the remembered address first, even if it is not first in the list', async () => {
    const order: string[] = [];
    const probe = async (address: string) => {
      order.push(address);
      return true;
    };
    const result = await resolveAddress(
      ['https://a', 'https://b', 'https://c'],
      'https://c',
      probe,
    );
    expect(order[0]).toBe('https://c');
    expect(result.winner).toBe('https://c');
  });

  it('falls through to the next address when the first fails', async () => {
    const probe = async (address: string) => address === 'https://b';
    const result = await resolveAddress(['https://a', 'https://b'], null, probe);
    expect(result.winner).toBe('https://b');
    expect(result.results).toEqual([
      { address: 'https://a', ok: false },
      { address: 'https://b', ok: true },
    ]);
  });

  it('running out of addresses is the only failure — no throw, winner is null', async () => {
    const probe = async () => false;
    const result = await resolveAddress(['https://a', 'https://b'], null, probe);
    expect(result.winner).toBeNull();
    expect(result.results).toHaveLength(2);
  });

  it('an empty address list resolves to no winner immediately', async () => {
    const probe = jest.fn(async () => true);
    const result = await resolveAddress([], null, probe);
    expect(result.winner).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('withTimeout', () => {
  it('resolves false instead of hanging when the probe never settles', async () => {
    jest.useFakeTimers();
    const neverResolves = () => new Promise<boolean>(() => {});
    const wrapped = withTimeout(neverResolves, 50);
    const promise = wrapped('https://slow.example.com');
    jest.advanceTimersByTime(50);
    await expect(promise).resolves.toBe(false);
    jest.useRealTimers();
  });

  it('resolves false instead of throwing when the probe rejects', async () => {
    const wrapped = withTimeout(async () => {
      throw new Error('network down');
    }, 1000);
    await expect(wrapped('https://a')).resolves.toBe(false);
  });
});
