function offsetMinutesAt(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - at.getTime()) / 60000;
}

/** Mirrors Waterfly's getLocalTimeAsServerTime: shift a device-local instant by the
 * server/device offset difference so it reads correctly once the server applies its own tz. */
export function toServerEquivalent(
  serverTz: string,
  deviceLocal: Date,
  deviceTz: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Date {
  const diffMinutes =
    offsetMinutesAt(serverTz, deviceLocal) - offsetMinutesAt(deviceTz, deviceLocal);
  return new Date(deviceLocal.getTime() - diffMinutes * 60000);
}

/** Mirrors Waterfly's newTXTime(): the timestamp to send for a transaction created right now. */
export function newTxTime(serverTz: string, deviceNow: Date = new Date(), deviceTz?: string): Date {
  return toServerEquivalent(serverTz, deviceNow, deviceTz);
}
