import { divisionForPostcode, fixtureBankHolidays, localParts, parseGovUkBankHolidays, schoolHoliday, showCalendar, slotOf } from './calendar';

describe('Pulse calendar', () => {
  it('classifies slots, with bank holidays as Saturdays and the day before as Friday', () => {
    expect(slotOf(2, 12 * 60 + 30)).toBe('weekday-day');
    expect(slotOf(2, 18 * 60 + 10)).toBe('weekday-evening');
    expect(slotOf(5, 20 * 60 + 50)).toBe('fri-sat-evening');
    expect(slotOf(0, 15 * 60)).toBe('weekend-day');
    expect(slotOf(0, 18 * 60)).toBe('weekday-evening');
    expect(slotOf(3, 22 * 60)).toBe('late');
    expect(slotOf(1, 12 * 60, { bankHoliday: true })).toBe('weekend-day');
    expect(slotOf(1, 19 * 60, { bankHoliday: true })).toBe('fri-sat-evening');
    expect(slotOf(4, 19 * 60, { dayBeforeBankHoliday: true })).toBe('fri-sat-evening');
  });

  it('reads local time in the venue time zone', () => {
    const p = localParts(new Date('2026-07-03T17:10:00Z'), 'Europe/London');
    expect(p).toMatchObject({ ymd: '2026-07-03', dow: 5, minutes: 18 * 60 + 10 });
  });

  it('knows the nation from a postcode', () => {
    expect(divisionForPostcode('LS1 4AB')).toBe('england-and-wales');
    expect(divisionForPostcode('EH1 1YZ')).toBe('scotland');
    expect(divisionForPostcode('G2 3AB')).toBe('scotland');
    expect(divisionForPostcode('GL1 2AB')).toBe('england-and-wales');
    expect(divisionForPostcode('BT1 5GS')).toBe('northern-ireland');
  });

  it('loads bank holidays from the gov.uk fixture and parses the live feed', () => {
    const bh = fixtureBankHolidays();
    expect(bh['england-and-wales'].has('2026-12-25')).toBe(true);
    expect(bh.scotland.has('2027-01-04')).toBe(true);
    expect(bh['england-and-wales'].has('2027-01-04')).toBe(false);
    const rows = parseGovUkBankHolidays({ 'england-and-wales': { events: [{ date: '2027-05-03', title: 'Early May bank holiday' }, { date: 'bad' }] } });
    expect(rows).toEqual([{ division: 'england-and-wales', date: '2027-05-03', title: 'Early May bank holiday' }]);
  });

  it('marks approximate school holidays and bank holidays on a show', () => {
    expect(schoolHoliday('2026-08-10')).toBe('Summer');
    expect(schoolHoliday('2026-09-20')).toBeNull();
    const c = showCalendar(new Date('2026-12-25T13:00:00Z'), 'Europe/London', 'england-and-wales', fixtureBankHolidays());
    expect(c.bankHoliday).toBe(true);
    expect(c.slot).toBe('weekend-day');
  });
});
