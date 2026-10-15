const DASH = '—';
const MINUS = '−';
const ok = (n) => typeof n === 'number' && Number.isFinite(n);

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });

export function fmtInt(n) { return ok(n) ? intFmt.format(Math.round(n)) : DASH; }

export function fmtNum(n, digits = 2) {
  return ok(n) ? new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n) : DASH;
}

export function fmtUsd(n) { return ok(n) ? usdFmt.format(n) : DASH; }

export function fmtUsdCompact(n) { return ok(n) ? usdCompact.format(n) : DASH; }

export function fmtXbt(sats, minDigits = 2, maxDigits = 2) {
  if (!ok(sats)) return DASH;
  const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits }).format(sats / 1e8);
  return `${s} XBT`;
}

export function fmtPct(n, digits = 2) { return ok(n) ? `${n.toFixed(digits)}%` : DASH; }

export function change(pct, digits = 2) {
  if (!ok(pct)) return { text: DASH, dir: 'flat' };
  const rounded = Number(pct.toFixed(digits));
  if (rounded === 0) return { text: `${(0).toFixed(digits)}%`, dir: 'flat' };
  const abs = Math.abs(rounded).toFixed(digits);
  return rounded > 0 ? { text: `▲ +${abs}%`, dir: 'up' } : { text: `▼ ${MINUS}${abs}%`, dir: 'down' };
}

function scaled(n, units) {
  let i = 0;
  let v = n;
  while (Math.abs(v) >= 1000 && i < units.length - 1) { v /= 1000; i += 1; }
  return [v, units[i]];
}

export function fmtHashrate(hps) {
  if (!ok(hps)) return DASH;
  const [v, unit] = scaled(hps, ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s', 'ZH/s']);
  return `${v.toFixed(2)} ${unit}`;
}

export function fmtDifficulty(d) {
  if (!ok(d)) return DASH;
  const [v, unit] = scaled(d, ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z']);
  return unit ? `${v.toFixed(2)} ${unit}` : v.toFixed(2);
}

export function fmtClock(seconds) {
  if (!ok(seconds)) return DASH;
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function fmtAgo(ms) {
  if (!ok(ms)) return DASH;
  const s = Math.max(0, ms / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function fmtDate(ms, timeZone) {
  if (!ok(ms)) return DASH;
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(ms);
  } catch {
    return DASH;
  }
}

const twoDp = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Price change as "+371.48 (0.45%)" / "−61.22 (−6.87%)" / "0.00 (0.00%)".
// Sign and colour (dir) carry the direction; no dollar sign and no arrow.
// Chain charts pass their own formatter for the amount.
export function changeLine(usd, pct, fmtAmount) {
  if (!ok(usd) || !ok(pct)) return { text: DASH, dir: 'flat' };
  const u = Number(usd.toFixed(2));
  const p = Number(pct.toFixed(2));
  const sign = Math.sign(u) || Math.sign(p);
  const amount = fmtAmount ? fmtAmount(sign === 0 ? 0 : Math.abs(usd)) : twoDp.format(Math.abs(u));
  const percent = `${Math.abs(p).toFixed(2)}%`;
  if (sign > 0) return { text: `+${amount} (${percent})`, dir: 'up' };
  if (sign < 0) return { text: `${MINUS}${amount} (${p === 0 ? '' : MINUS}${percent})`, dir: 'down' };
  return { text: `${amount} (${percent})`, dir: 'flat' };
}

export function fmtAxisPrice(n) { return ok(n) ? twoDp.format(n) : DASH; }

export function fmtDateTime(ms, timeZone) {
  if (!ok(ms)) return DASH;
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone,
    }).format(ms);
  } catch {
    return DASH;
  }
}

export function fmtVsize(vbytes) { return ok(vbytes) ? `${(vbytes / 1e6).toFixed(2)} vMB` : DASH; }

export function fmtSatVb(n) { return ok(n) ? `${Number(n.toFixed(1))} sat/vB` : DASH; }

// Hover text for the ATH value: what it means and when it was set.
export function athTitle(athAt, historySince, timeZone) {
  if (!ok(athAt)) return '';
  const since = ok(historySince) ? ` since ${fmtDate(historySince, timeZone)}` : '';
  return `Highest hourly close${since} · set ${fmtDate(athAt, timeZone)}`;
}

// "~6d 16h" / "~5h 12m" / "~12m": a rough time span from milliseconds, floored.
export function fmtRelative(ms) {
  if (!ok(ms)) return DASH;
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `~${d}d ${h}h`;
  if (h > 0) return `~${h}h ${m}m`;
  return `~${m}m`;
}

// "Oct 17", no year.
export function fmtDayMonth(ms, timeZone) {
  if (!ok(ms)) return DASH;
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(ms);
  } catch {
    return DASH;
  }
}

export function fmtKb(bytes) { return ok(bytes) ? `${intFmt.format(Math.round(bytes / 1000))} kB` : DASH; }

const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
export function fmtUsdWhole(n) { return ok(n) ? usdWhole.format(n) : DASH; }
