import { newTxTime } from './timezone';

describe('newTxTime', () => {
  it('shifts a device-local time to the server-equivalent instant', () => {
    // Warsaw (UTC+2 in September, DST) vs. New York (UTC-4 in September, DST): 6h difference.
    const deviceNoon = new Date('2026-09-15T12:00:00-04:00');
    const result = newTxTime('Europe/Warsaw', deviceNoon, 'America/New_York');
    // The server-equivalent instant is 6 hours earlier in absolute time.
    expect(result.getTime()).toBe(deviceNoon.getTime() - 6 * 60 * 60 * 1000);
  });
});
