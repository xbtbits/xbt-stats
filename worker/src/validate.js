import { SWITCH_HEIGHT } from './calc.js';

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function num(value, label) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ValidationError(`${label}: not a finite number`);
  return n;
}

export function nonNeg(value, label) {
  const n = num(value, label);
  if (n < 0) throw new ValidationError(`${label}: negative`);
  return n;
}

export function positive(value, label) {
  const n = num(value, label);
  if (n <= 0) throw new ValidationError(`${label}: not positive`);
  return n;
}

export function validTip(value, lastGoodTip) {
  const h = num(value, 'tip');
  if (!Number.isInteger(h) || h < SWITCH_HEIGHT) throw new ValidationError(`tip: invalid height ${h}`);
  if (lastGoodTip != null && h < lastGoodTip - 10) throw new ValidationError(`tip: ${h} far behind ${lastGoodTip}`);
  return h;
}

export function validPrice(value, label) {
  const p = positive(value, label);
  if (p >= 10_000_000) throw new ValidationError(`${label}: implausible price ${p}`);
  return p;
}
