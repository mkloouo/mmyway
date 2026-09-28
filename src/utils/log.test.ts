import { shareableLog } from './log';

describe('shareableLog', () => {
  it('masks amounts and payee/account/note text, keeps the rest', () => {
    const out = shareableLog([
      '2026-09-28T10:00:00.000Z ERROR Save failed: 422 {"description":"Żabka \\"big\\" shop","amount":"12.50","tags":["a","b"]}',
      '2026-09-28T10:00:01.000Z WARN sync: 340,00 PLN drift',
    ]);
    expect(out).toContain('"description":"‹redacted›"');
    expect(out).toContain('"tags":"‹redacted›"');
    expect(out).not.toContain('Żabka');
    expect(out).not.toContain('12.50');
    expect(out).not.toContain('340,00');
    expect(out).toContain('2026-09-28T10:00:00.000Z ERROR Save failed: 422');
  });
});
