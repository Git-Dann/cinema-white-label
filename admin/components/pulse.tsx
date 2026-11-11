'use client';

import { PulseBasis, PulseDriver, PulseForecast } from '@/lib/api';
import { Sheet } from '@/components/Sheet';

/*
 * Shared pieces for Seatfold Pulse (docs/pulse.md). Every panel says what its numbers are
 * based on, and marks demo history clearly, so nobody mistakes a demo for their own trading.
 */

const isDemo = (b: PulseBasis | null | undefined) => !!b && ((b.demoShows ?? 0) > 0 || (b.demoOrders ?? 0) > 0 || (b.demoCustomers ?? 0) > 0 || b.mix === 'demo');

/** "Based on 26 weeks of demo history", with a Demo history badge when it is. */
export function PulseBasisLine({ basis, className }: { basis: PulseBasis | null | undefined; className?: string }) {
  if (!basis) return null;
  return (
    <p className={`pulse-basis small${className ? ` ${className}` : ''}`}>
      <span className="pulse-mark" aria-hidden="true" />
      <span className="muted">{basis.note}</span>
      {isDemo(basis) && <span className="badge badge-sample">Demo history</span>}
    </p>
  );
}

/** Pace in words. Very large ratios read as "far ahead" rather than a meaningless ×28. */
/** Status line when there is no pace figure to show. */
export function paceFallback(basis: 'live' | 'early' | 'untimed' | undefined): string {
  return basis === 'untimed' ? 'No sale times to judge pace' : 'Too early to judge pace';
}

export function paceText(pace: number | null | undefined): string | null {
  if (pace == null) return null;
  if (pace >= 3) return 'Far ahead of usual pace';
  if (pace >= 1.15) return `${pace.toFixed(1)}× usual pace`;
  if (pace > 0.85) return 'On usual pace';
  if (pace > 0.4) return `${pace.toFixed(1)}× usual pace`;
  return 'Well behind usual pace';
}

export function paceTone(pace: number | null | undefined): 'fast' | 'slow' | 'even' | null {
  if (pace == null) return null;
  if (pace >= 1.3) return 'fast';
  if (pace <= 0.7) return 'slow';
  return 'even';
}

export function PaceChip({ pace }: { pace: number | null | undefined }) {
  const text = paceText(pace);
  if (!text) return null;
  const tone = paceTone(pace);
  return <span className={`badge ${tone === 'fast' ? 'badge-success' : tone === 'slow' ? 'badge-warning' : 'badge-neutral'}`}>{tone === 'fast' ? 'Selling fast' : tone === 'slow' ? 'Selling slowly' : 'On pace'}</span>;
}

export function ConfidenceChip({ level }: { level: PulseForecast['confidence'] }) {
  const label = level === 'high' ? 'Sure' : level === 'medium' ? 'Fairly sure' : 'Early guess';
  return (
    <span className={`pulse-confidence ${level}`} title="How sure Pulse is, from how much it has seen and how far through sales the show is">
      <span aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i < (level === 'high' ? 3 : level === 'medium' ? 2 : 1) ? 'on' : undefined} />)}</span>
      {label}
    </span>
  );
}

/** Sold now (solid), forecast (lighter) and the likely range (bracket) against capacity. */
export function ForecastBar({ f }: { f: Pick<PulseForecast, 'soldNow' | 'expected' | 'low' | 'high' | 'capacity'> }) {
  const w = (n: number) => `${Math.min(100, Math.max(0, (n / Math.max(1, f.capacity)) * 100))}%`;
  return (
    <div className="pulse-bar" role="img" aria-label={`${f.soldNow} sold now, about ${f.expected} expected (${f.low} to ${f.high}) of ${f.capacity} seats`}>
      <span className="pulse-bar-expected" style={{ width: w(f.expected) }} />
      <span className="pulse-bar-sold" style={{ width: w(f.soldNow) }} />
      <span className="pulse-bar-range" style={{ left: w(f.low), width: `calc(${w(f.high)} - ${w(f.low)})` }} />
    </div>
  );
}

const effectText = (d: PulseDriver) => (d.effect >= 3 ? 'much higher' : `×${d.effect.toFixed(2)}`);

/** A driver's name without the "×1.26" the server appends; the chip shows it instead. */
const driverName = (label: string) => label.replace(/:\s*×[\d.]+\s*$/, '');

export function DriverList({ drivers }: { drivers: PulseDriver[] }) {
  return (
    <ul className="pulse-drivers">
      {drivers.map((d) => (
        <li key={d.label}>
          <span className={`pulse-effect ${d.effect > 1.04 ? 'up' : d.effect < 0.96 ? 'down' : ''}`}>{effectText(d)}</span>
          <div>
            <strong>{driverName(d.label)}</strong>
            <span className="muted small">{d.explanation}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The "Why" panel: how Pulse got to this show's forecast, in plain words. */
export function ForecastSheet({ f, basis, onClose }: { f: PulseForecast | null; basis: PulseBasis | null | undefined; onClose: () => void }) {
  return (
    <Sheet open={!!f} narrow title={f ? `${f.film.title} · ${f.localTime}` : 'Forecast'} subtitle={f ? `${f.screen.name} · ${f.venue.name}` : undefined} onClose={onClose}>
      {f && (
        <div className="pulse-why">
          <div className="pulse-why-head">
            <div>
              <div className="stat-label">Expected</div>
              <div className="stat-value num">{f.expected}</div>
              <div className="muted small num">
                likely {f.low} to {f.high} of {f.capacity} seats
              </div>
            </div>
            <div>
              <div className="stat-label">Sold now</div>
              <div className="stat-value num">{f.soldNow}</div>
              <div className="muted small">{paceText(f.paceIndex) ?? paceFallback(f.paceBasis)}</div>
            </div>
          </div>
          <ForecastBar f={f} />
          <p className="small pulse-why-start">
            Starts from a usual <strong>{f.baseline.label.toLowerCase()}</strong>: about {Math.round(f.baseline.occupancy * 100)}% of seats. Then:
          </p>
          <DriverList drivers={f.drivers} />
          <div className="pulse-why-foot">
            <ConfidenceChip level={f.confidence} />
            <PulseBasisLine basis={basis} />
          </div>
        </div>
      )}
    </Sheet>
  );
}
