// A date picked on the keypad screen keeps the device's current clock time, never local
// midnight (design §6.2): midnight in Europe/Warsaw is 22:00 UTC the day before, and a naive
// `new Date(pickedDate).toISOString()` backdates the entry by a day more than the user chose.
export function buildEntryDate(pickedYearMonthDay: Date, clockTime: Date = new Date()): Date {
  return new Date(
    pickedYearMonthDay.getFullYear(),
    pickedYearMonthDay.getMonth(),
    pickedYearMonthDay.getDate(),
    clockTime.getHours(),
    clockTime.getMinutes(),
    clockTime.getSeconds(),
    clockTime.getMilliseconds(),
  );
}

export function yesterday(clockTime: Date = new Date()): Date {
  const d = new Date(clockTime);
  d.setDate(d.getDate() - 1);
  return d;
}
