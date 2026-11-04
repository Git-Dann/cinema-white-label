import { curvedLayout, luxeLayout, standardLayout } from '../fixtures/layouts';
import { evaluateSeatRules, rowNeighbours } from './seat-rules';

const policy = { maxTickets: 10, orphanSeatPolicy: 'warn' as const };

describe('seat rules', () => {
  const standard = standardLayout('s');

  it('treats the central aisle as a break in adjacency', () => {
    const nb = rowNeighbours(standard);
    expect(nb.get('C-7')!.right).toBeUndefined(); // aisle between 7 and 8
    expect(nb.get('C-8')!.left).toBeUndefined();
    expect(nb.get('C-6')!.right).toBe('C-7');
  });

  it('works on curved rows', () => {
    const nb = rowNeighbours(curvedLayout('c'));
    expect(nb.get('E-6')!.left).toBe('E-5');
    expect(nb.get('E-6')!.right).toBe('E-7');
  });

  it('rejects unknown, duplicate and too many seats', () => {
    expect(evaluateSeatRules(standard, ['Z-99'], new Set(), policy).errors[0].code).toBe('unknown_seat');
    expect(evaluateSeatRules(standard, ['C-1', 'C-1'], new Set(), policy).errors[0].code).toBe('duplicate_seat');
    const many = Array.from({ length: 11 }, (_, i) => `D-${i + 1}`);
    expect(evaluateSeatRules(standard, many, new Set(), policy).errors[0].code).toBe('max_tickets');
  });

  it('requires both sofa seats', () => {
    const luxe = luxeLayout('l');
    const r = evaluateSeatRules(luxe, ['E-1'], new Set(), policy);
    expect(r.errors.map((e) => e.code)).toEqual(['group_incomplete']);
    expect(evaluateSeatRules(luxe, ['E-1', 'E-2'], new Set(), policy).errors).toEqual([]);
  });

  it('warns, never blocks, for wheelchair and companion seats', () => {
    const r = evaluateSeatRules(standard, ['A-W1', 'A-1'], new Set(), policy);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code).sort()).toEqual(['companion_seat', 'restricted_view', 'wheelchair_space']);
  });

  it('detects orphan seats created by the selection', () => {
    // C-3 is sold; choosing C-1 leaves C-2 stranded.
    const r = evaluateSeatRules(standard, ['C-1'], new Set(['C-3']), policy);
    expect(r.warnings.find((w) => w.code === 'orphan_seat')?.seatIds).toEqual(['C-2']);
    const blocking = evaluateSeatRules(standard, ['C-1'], new Set(['C-3']), { ...policy, orphanSeatPolicy: 'block' });
    expect(blocking.errors[0].code).toBe('orphan_seat');
    expect(evaluateSeatRules(standard, ['C-1'], new Set(['C-3']), { ...policy, orphanSeatPolicy: 'allow' }).warnings).toEqual([]);
  });

  it('does not flag pre-existing gaps the customer did not create', () => {
    const r = evaluateSeatRules(standard, ['F-10'], new Set(['C-1', 'C-3']), policy);
    expect(r.warnings.find((w) => w.code === 'orphan_seat')).toBeUndefined();
  });
});
