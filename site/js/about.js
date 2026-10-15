// About page live cards: Network history (blocks and days since the BLAKE2b switch, chain
// upgrades from /data/upgrades.json) and Sources and status (where chain data comes from,
// how fresh it is, and the overall status).
import { getSnapshot } from './api.js';
import * as f from './format.js';
import { el, setText } from './dom.js';
import { sourceStatus } from './status.js';

async function loadUpgrades() {
  try {
    const items = await (await fetch('/data/upgrades.json')).json();
    document.getElementById('upgrades').replaceChildren(...items.map((u) => {
      const li = el('li');
      li.append(el('strong', '', `${u.title}`), ` · block ${f.fmtInt(u.height)} · ${f.fmtDate(Date.parse(`${u.date}T00:00:00Z`), 'UTC')}. ${u.text}`);
      return li;
    }));
  } catch {
    // the list is optional; leave it empty
  }
}

let snapshot = null;
let offline = false;

function renderLive(now) {
  const s = snapshot;
  const chain = s?.sources?.chain;
  setText('history.blocksSinceSwitch', f.fmtInt(s?.chain?.blocksSinceSwitch));
  setText('history.daysSinceSwitch', s?.chain ? f.fmtInt(Math.floor((now / 1000 - s.chain.switchTime) / 86400)) : '—');
  setText('chain.source', chain?.name ?? '—');
  setText('chain.updated', chain ? f.fmtAgo(now - chain.fetchedAt) : '—');
  setText('chain.crossCheck', s?.sources?.crossCheck?.tip != null ? `cross-checked with ${s.sources.crossCheck.name}` : 'cross-check unavailable');
  setText('status.line', s ? sourceStatus(s, now, offline).line : offline ? 'Server unreachable' : '—');
}

async function refresh() {
  try {
    snapshot = await getSnapshot();
    offline = false;
  } catch {
    offline = true; // keep the last snapshot, report the server as unreachable
  }
  renderLive(Date.now());
}

loadUpgrades();
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 30_000);
setInterval(() => renderLive(Date.now()), 1_000);
