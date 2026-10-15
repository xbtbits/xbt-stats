export function summarize(label, points, format) {
  if (!points || points.length === 0) return `${label}: no data yet.`;
  const first = points[0][1];
  const last = points.at(-1)[1];
  if (points.length < 2 || first === 0) return `${label} ${format(last)}.`;
  const pct = ((last - first) / first) * 100;
  if (Math.abs(pct) < 0.05) return `${label} ${format(last)}, flat over this range.`;
  // From a near-zero start a percentage gets silly (+16016%); say how many times bigger instead.
  if (pct >= 900) {
    const times = last / first;
    return `${label} ${format(last)}, up ${times >= 100 ? Math.round(times) : times.toFixed(1)}x over this range.`;
  }
  return `${label} ${format(last)}, ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(1)}% over this range.`;
}
