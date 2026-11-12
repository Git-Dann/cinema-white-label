import { filmRun, fitRetention, priorRetention, WeekRow, weeklyRows } from './filmrun';
import { PROGRAMME_DECAY_MEAN, SLOT_BASE } from './pulse';

const film = (genres = ['Drama']) => ({ id: 'f', title: 'Saltmarsh', genres, certificate: '15', releaseDate: new Date('2026-09-04T00:00:00Z') });
/** A run with known retention r: opening pull × r^(w−1), 20 shows a week of 150 seats on weekday evenings. */
function run(r: number, weeks: number, opening = 1 / PROGRAMME_DECAY_MEAN): WeekRow[] {
  const norm = 20 * 150 * SLOT_BASE['weekday-evening'];
  return Array.from({ length: weeks }, (_, i) => ({ filmWeek: i + 1, shows: 20, admissions: Math.round(norm * opening * Math.pow(r, i)), norm }));
}

describe('Film runs', () => {
  it('folds outcomes into weekly rows with a typical-film norm', () => {
    const w = weeklyRows([
      { filmWeek: 1, admissions: 30, capacity: 100, slot: 'weekday-evening' },
      { filmWeek: 1, admissions: 50, capacity: 100, slot: 'fri-sat-evening' },
      { filmWeek: 2, admissions: 10, capacity: 100, slot: 'weekday-evening' },
    ]);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ filmWeek: 1, shows: 2, admissions: 80 });
    expect(w[0].norm).toBeCloseTo(100 * SLOT_BASE['weekday-evening'] + 100 * SLOT_BASE['fri-sat-evening'], 6);
  });

  it('uses the genre prior with one week, and learns the film’s own decay as weeks arrive', () => {
    const prior = priorRetention(film(), 1 / PROGRAMME_DECAY_MEAN);
    expect(fitRetention(run(0.4, 1), prior).retention).toBeCloseTo(prior, 2);
    expect(fitRetention(run(0.4, 1), prior).dataWeight).toBe(0);
    const four = fitRetention(run(0.4, 4), prior);
    expect(four.retention).toBeLessThan(0.48);
    expect(four.retention).toBeGreaterThan(0.36);
    expect(four.dataWeight).toBeGreaterThan(0.8);
  });

  it('nudges the prior by the opening surprise, within bounds', () => {
    const normal = priorRetention(film(), 1 / PROGRAMME_DECAY_MEAN);
    expect(priorRetention(film(), 2 / PROGRAMME_DECAY_MEAN)).toBeGreaterThan(normal);
    expect(priorRetention(film(), 0.5 / PROGRAMME_DECAY_MEAN)).toBeLessThan(normal);
    expect(priorRetention(film(), null)).toBe(normal);
  });

  it('says grow for a film still well above the average, trim or end for one fading fast', () => {
    const strong = filmRun(film(), run(0.85, 3, 3 / PROGRAMME_DECAY_MEAN), 3);
    expect(strong.verdict).toBe('grow');
    expect(strong.nextWeek).toBe(4);
    expect(strong.reason).toContain('Worth more shows');
    const fading = filmRun(film(['Horror']), run(0.3, 3), 3);
    expect(['trim', 'end']).toContain(fading.verdict);
    expect(fading.weeks.map((w) => w.filmWeek)).toEqual([1, 2, 3]);
  });
});
