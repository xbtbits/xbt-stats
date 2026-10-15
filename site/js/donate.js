// Donation card: shows the XBT address from data-address on #donate, with a copy button
// and a QR code. Until an address is set (or if it doesn't look like one) the card says
// "coming soon" and shows no QR, so a half-entered address can never be shown.
(() => {
  const card = document.getElementById('donate');
  if (!card) return;
  const text = card.querySelector('#donate-address');
  const copy = card.querySelector('.donate-copy');
  const qr = card.querySelector('.donate-qr');
  const address = (card.dataset.address ?? '').trim();
  // XBT uses bitcoin's address formats: bech32 (bc1…) or base58 (1… / 3…).
  const valid = /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(address);
  card.dataset.state = valid ? 'ready' : 'pending';
  if (!valid) return;

  text.textContent = address;
  copy.disabled = false;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(address);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Select and copy';
    }
    setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
  });

  // QR code: dark modules on gold with a quiet zone, the contrast scanners expect.
  if (typeof window.qrcode !== 'function') return;
  const code = window.qrcode(0, 'M');
  code.addData(address);
  code.make();
  const n = code.getModuleCount(), quiet = 4, cell = 4;
  const size = (n + quiet * 2) * cell;
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  qr.width = size * dpr; qr.height = size * dpr;
  qr.style.width = `${size}px`; qr.style.height = `${size}px`;
  const g = qr.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#eab448';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#0a0a0a';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (code.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
  }
  qr.hidden = false;
})();
