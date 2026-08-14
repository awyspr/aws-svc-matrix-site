(async () => {
  const res = await fetch('data.json');
  if (!res.ok) { document.body.innerHTML = '<p>data.json missing. Run collector/merge.py first.</p>'; return; }
  const data = await res.json();

  // Optional changes overlay (from data/changes.json → site/changes.json).
  let changes = null;
  try {
    const cr = await fetch('changes.json');
    if (cr.ok) {
      const raw = await cr.json();
      if (!raw.empty) changes = raw;
    }
  } catch (_) { /* no changes.json yet */ }

  const addedCell = new Set(), removedCell = new Set();
  const regionRollup = {}; // code -> {added, removed}
  if (changes) {
    for (const c of changes.cell_added || []) addedCell.add(`${c.service}|${c.region}`);
    for (const c of changes.cell_removed || []) removedCell.add(`${c.service}|${c.region}`);
    Object.assign(regionRollup, changes.region_rollup || {});
  }

  const meta = document.getElementById('meta');
  let metaText = `generated ${data.generated}  ·  ${data.services.length} services  ·  ${data.regions.length} regions`;
  if (changes) metaText += `  ·  diff vs ${changes.prior_snapshot}: +${(changes.cell_added || []).length} / -${(changes.cell_removed || []).length} cells`;
  meta.textContent = metaText;

  // Populate categories.
  const cats = [...new Set(data.services.map(s => s.category))].sort();
  const catSel = document.getElementById('category');
  for (const c of cats) {
    const o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
  }

  // Populate geo prefixes (region code = "<geo>-<direction>-<n>").
  const GEO_NAMES = {
    'us': 'US', 'ca': 'Canada', 'sa': 'South America', 'eu': 'Europe',
    'af': 'Africa', 'me': 'Middle East', 'il': 'Israel', 'ap': 'Asia Pacific',
    'mx': 'Mexico', 'cn': 'China', 'us-gov': 'US GovCloud',
  };
  const geoOf = code => code.startsWith('us-gov') ? 'us-gov' : code.split('-')[0];
  const geos = [...new Set(data.regions.map(r => geoOf(r.code)))].sort();
  const geoSel = document.getElementById('geo');
  for (const g of geos) {
    const o = document.createElement('option');
    o.value = g;
    o.textContent = `${g} — ${GEO_NAMES[g] || g}`;
    geoSel.appendChild(o);
  }

  const matrixSet = {}; // slug -> Set(region)
  for (const [slug, regions] of Object.entries(data.matrix)) matrixSet[slug] = new Set(regions);

  const render = () => {
    const q = document.getElementById('q').value.trim().toLowerCase();
    const rf = document.querySelector('input[name=region-filter]:checked').value;
    const cat = catSel.value;

    const geo = geoSel.value;
    // Apply structural filters (opt-in class, geo, category) first.
    let regions = data.regions.filter(r => {
      if (rf !== 'all' && (rf === 'optin' ? !r.opt_in : r.opt_in)) return false;
      if (geo && geoOf(r.code) !== geo) return false;
      return true;
    });
    let services = data.services.filter(s => !cat || s.category === cat);

    // Search: comma-separated terms; each term filters either axis (OR within axis).
    // e.g. "ap-southeast-2, ca-west-1" -> both region columns.
    // e.g. "bedrock, macie" -> both service rows.
    // Mixed: "bedrock, ap-southeast-2" -> bedrock rows × ap-southeast-2 column.
    if (q) {
      const terms = q.split(',').map(t => t.trim()).filter(Boolean);
      const svcHit = services.filter(s => terms.some(t =>
        s.slug.toLowerCase().includes(t) || s.name.toLowerCase().includes(t) || s.category.toLowerCase().includes(t)));
      const regHit = regions.filter(r => terms.some(t =>
        r.code.toLowerCase().includes(t) || r.name.toLowerCase().includes(t)));
      if (svcHit.length && regHit.length) { services = svcHit; regions = regHit; }
      else if (svcHit.length) { services = svcHit; }
      else if (regHit.length) { regions = regHit; }
      else { services = []; regions = []; }
    }

    const table = document.getElementById('matrix');
    if (!services.length || !regions.length) { table.innerHTML = '<tbody><tr><td>No matches.</td></tr></tbody>'; return; }
    const parts = ['<thead><tr><th>Service</th>'];
    for (const r of regions) {
      const rr = regionRollup[r.code];
      let badge = '';
      if (rr && (rr.added || rr.removed)) {
        badge = ` <span class="rollup" title="since ${changes.prior_snapshot}">+${rr.added || 0}/-${rr.removed || 0}</span>`;
      }
      parts.push(`<th class="rot ${r.opt_in ? 'optin' : ''}" title="${r.name}${r.opt_in ? ' (opt-in)' : ''}">${badge}${r.code}</th>`);
    }
    parts.push('</tr></thead><tbody>');
    for (const s of services) {
      parts.push(`<tr><th title="${s.slug}"><div class="svc-name">${s.name}</div><div class="cat-tag">${s.category}</div></th>`);
      const set = matrixSet[s.slug] || new Set();
      for (const r of regions) {
        const key = `${s.slug}|${r.code}`;
        const cls = ['y', 'n'][set.has(r.code) ? 0 : 1];
        const change = addedCell.has(key) ? ' added' : removedCell.has(key) ? ' removed' : '';
        parts.push(`<td class="${cls}${change}" title="${s.name} × ${r.code}${change ? ' — ' + change.trim() + ' since ' + changes.prior_snapshot : ''}"></td>`);
      }
      parts.push('</tr>');
    }
    parts.push('</tbody>');
    table.innerHTML = parts.join('');
    // Match intro / controls / footer width to the rendered table so all
    // page sections share the same horizontal boundary.
    requestAnimationFrame(() => {
      const wrap = document.getElementById('matrix-wrap');
      // Two-pass: size wrap to table content, then add the scrollbar gutter
      // so the vertical scrollbar doesn't overlap the last column.
      if (wrap) wrap.style.width = table.scrollWidth + 'px';
      requestAnimationFrame(() => {
        const gutter = wrap ? (wrap.offsetWidth - wrap.clientWidth) : 0;
        const w = table.scrollWidth + gutter;
        if (!w) return;
        if (wrap) { wrap.style.width = w + 'px'; wrap.style.maxWidth = w + 'px'; }
        for (const sel of ['header', '.controls', 'footer']) {
          const el = document.querySelector(sel);
          if (el) el.style.maxWidth = w + 'px';
        }
      });
    });
  };

  document.getElementById('q').addEventListener('input', render);
  for (const el of document.querySelectorAll('input[name=region-filter]')) el.addEventListener('change', render);
  catSel.addEventListener('change', render);
  geoSel.addEventListener('change', render);
  render();
})();
