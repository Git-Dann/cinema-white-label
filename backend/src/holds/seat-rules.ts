import { AuditoriumLayout, Seat } from '@cinema/contracts';

/**
 * Operator-configurable seat selection rules, evaluated on the server.
 *
 * Errors block the hold. Warnings are returned to the app so it can explain
 * them (e.g. "this is a wheelchair space"); they never block. Accessibility
 * related rules are deliberately warnings so legitimate bookings are never
 * excluded by a blanket rule.
 */

export interface RuleViolation {
  code: string;
  message: string;
  seatIds: string[];
}

export interface SeatRulePolicy {
  maxTickets: number;
  orphanSeatPolicy: 'allow' | 'warn' | 'block';
}

export interface SeatRuleResult {
  errors: RuleViolation[];
  warnings: RuleViolation[];
}

/** Seats adjacent in the same row and block (an aisle gap breaks adjacency). */
export function rowNeighbours(layout: AuditoriumLayout): Map<string, { left?: string; right?: string }> {
  const out = new Map<string, { left?: string; right?: string }>();
  const byRow = new Map<string, Seat[]>();
  for (const s of layout.seats) byRow.set(s.rowId, [...(byRow.get(s.rowId) ?? []), s]);
  for (const seats of byRow.values()) {
    seats.sort((a, b) => a.order - b.order);
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      const entry: { left?: string; right?: string } = {};
      const prev = seats[i - 1];
      const next = seats[i + 1];
      const touching = (a: Seat, b: Seat) => Math.hypot(a.x - b.x, a.y - b.y) <= ((a.width + b.width) / 2) * 1.35;
      if (prev && touching(prev, s)) entry.left = prev.id;
      if (next && touching(s, next)) entry.right = next.id;
      out.set(s.id, entry);
    }
  }
  return out;
}

export function evaluateSeatRules(
  layout: AuditoriumLayout,
  selected: string[],
  /** Seats unavailable to this customer (sold, blocked, held by others). */
  unavailable: Set<string>,
  policy: SeatRulePolicy,
): SeatRuleResult {
  const errors: RuleViolation[] = [];
  const warnings: RuleViolation[] = [];
  const seatById = new Map(layout.seats.map((s) => [s.id, s]));
  const sel = new Set(selected);

  const unknown = selected.filter((id) => !seatById.has(id));
  if (unknown.length) errors.push({ code: 'unknown_seat', message: 'Some seats do not exist in this auditorium', seatIds: unknown });
  if (sel.size !== selected.length) errors.push({ code: 'duplicate_seat', message: 'A seat was selected more than once', seatIds: selected });
  if (selected.length === 0) errors.push({ code: 'empty', message: 'Select at least one seat', seatIds: [] });
  if (selected.length > policy.maxTickets) {
    errors.push({ code: 'max_tickets', message: `You can book up to ${policy.maxTickets} seats in one booking`, seatIds: selected });
  }
  if (errors.length) return { errors, warnings };

  // Grouped seats (sofas) are sold as a unit.
  const groups = new Map<string, string[]>();
  for (const s of layout.seats) if (s.groupId) groups.set(s.groupId, [...(groups.get(s.groupId) ?? []), s.id]);
  for (const [, members] of groups) {
    const chosen = members.filter((m) => sel.has(m));
    if (chosen.length > 0 && chosen.length < members.length) {
      errors.push({ code: 'group_incomplete', message: 'Sofa seats are sold in pairs. Select both seats of the sofa.', seatIds: members });
    }
  }

  // Wheelchair spaces and companion seats: inform, never block.
  const wheelchair = selected.filter((id) => seatById.get(id)!.type === 'wheelchair');
  if (wheelchair.length) warnings.push({ code: 'wheelchair_space', message: 'This is a wheelchair space with no fixed seat.', seatIds: wheelchair });
  const companions = selected.filter((id) => seatById.get(id)!.type === 'companion');
  if (companions.length) warnings.push({ code: 'companion_seat', message: 'Companion seats are next to a wheelchair space and may be reassigned for access needs.', seatIds: companions });
  const restricted = selected.filter((id) => seatById.get(id)!.restrictedView);
  if (restricted.length) warnings.push({ code: 'restricted_view', message: seatById.get(restricted[0])!.restrictedView!, seatIds: restricted });

  // Orphan seats: a single free seat stranded between taken/selected seats.
  if (policy.orphanSeatPolicy !== 'allow') {
    const nb = rowNeighbours(layout);
    const taken = (id: string | undefined) => id === undefined || unavailable.has(id) || sel.has(id);
    const orphans: string[] = [];
    for (const s of layout.seats) {
      if (sel.has(s.id) || unavailable.has(s.id) || s.type === 'wheelchair') continue;
      const n = nb.get(s.id)!;
      // Only flag orphans the customer's selection creates.
      const touchesSelection = (n.left && sel.has(n.left)) || (n.right && sel.has(n.right));
      if (touchesSelection && taken(n.left) && taken(n.right)) orphans.push(s.id);
    }
    if (orphans.length) {
      const v = { code: 'orphan_seat', message: 'Your selection leaves a single empty seat. Consider moving along one seat.', seatIds: orphans };
      if (policy.orphanSeatPolicy === 'block') errors.push(v);
      else warnings.push(v);
    }
  }

  return { errors, warnings };
}
