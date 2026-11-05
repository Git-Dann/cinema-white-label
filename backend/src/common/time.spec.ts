import { zonedDate, zonedDayBounds, zonedToUtc } from './time';

describe('time zones', () => {
  it('converts UK wall-clock times across BST and GMT', () => {
    expect(zonedToUtc('2026-07-01', '19:30', 'Europe/London').toISOString()).toBe('2026-07-01T18:30:00.000Z'); // BST
    expect(zonedToUtc('2026-12-01', '19:30', 'Europe/London').toISOString()).toBe('2026-12-01T19:30:00.000Z'); // GMT
  });

  it('handles the clocks-go-back day (25 hours long)', () => {
    const { start, end } = zonedDayBounds('2026-10-25', 'Europe/London');
    expect((end.getTime() - start.getTime()) / 3600_000).toBe(25);
  });

  it('formats local dates', () => {
    expect(zonedDate(new Date('2026-07-01T23:30:00Z'), 'Europe/London')).toBe('2026-07-02');
  });
});
