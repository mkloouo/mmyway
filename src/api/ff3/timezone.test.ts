import { TimeZoneHandler } from './timezone';

describe('TimeZoneHandler', () => {
  it('shifts a device-local time to the server-equivalent instant', () => {
    // Warsaw (UTC+2 in September, DST) vs. New York (UTC-4 in September, DST): 6h difference.
    const handler = new TimeZoneHandler('Europe/Warsaw', 'America/New_York');
    const deviceNoon = new Date('2026-09-15T12:00:00-04:00');
    const result = handler.newTxTime(deviceNoon);
    // The server-equivalent instant is 6 hours earlier in absolute time.
    expect(result.getTime()).toBe(deviceNoon.getTime() - 6 * 60 * 60 * 1000);
  });

  it('uses raw device time when useServerTime is false', () => {
    const handler = new TimeZoneHandler('Europe/Warsaw', 'America/New_York');
    handler.setUseServerTime(false);
    const deviceNoon = new Date('2026-09-15T12:00:00-04:00');
    expect(handler.newTxTime(deviceNoon).getTime()).toBe(deviceNoon.getTime());
  });
});
