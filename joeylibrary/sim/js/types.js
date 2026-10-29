// The "Book types" view: every format in a table and drawn side by side to scale.
(function () {
  const B = window.Books, F = B.FORMATS, $ = id => document.getElementById(id);
  const inch = mm => (mm / 25.4).toFixed(2).replace(/\.?0+$/, '');
  const tb = $('typeTable').tBodies[0];
  F.forEach(f => {
    const s = B.bookSize({ format: f.id, pages: 400 }), tr = document.createElement('tr');
    tr.innerHTML = `<td>${{ US: 'American', UK: 'British', DK: 'Danish' }[f.region]}</td><td><b>${f.kind === 'hardcover' ? 'Hardcover' : 'Paperback'}</b> · ${f.name}</td>` +
      `<td class="num">${f.w} × ${f.h} mm<br><span class="muted">${inch(f.w)} × ${inch(f.h)} in</span></td>` +
      `<td class="num">${s.hc ? `${s.w} × ${s.h} mm` : '–'}<br><span class="muted">400 pages ≈ ${Math.round(s.t)} mm thick</span></td><td>${f.note}</td>`;
    tb.append(tr);
  });
  // to scale: outer size of each type, standing on one baseline, grouped by region
  const svg = $('scale'), k = 0.75, pad = 14, base = 290 * k + 34;
  let x = pad, out = '';
  ['US', 'UK', 'DK'].forEach((r, ri) => {
    if (ri) x += 18;
    out += `<text x="${x}" y="18" style="font-weight:700;font-size:18px">${{ US: 'American', UK: 'British', DK: 'Danish' }[r]}</text>`;
    F.filter(f => f.region === r).forEach(f => {
      const s = B.bookSize({ format: f.id, pages: 400 }), w = s.w * k, h = s.h * k;
      const fill = s.hc ? 'var(--accent)' : 'var(--amber)';
      out += `<rect x="${x}" y="${base - h}" width="${w}" height="${h}" rx="2" fill="${fill}" fill-opacity=".22" stroke="${fill}"><title>${f.name}: ${Math.round(s.w)} × ${Math.round(s.h)} mm</title></rect>`;
      out += `<text x="${x + w / 2}" y="${base + 14}" text-anchor="middle">${f.h}</text>`;
      out += `<text transform="translate(${x + w / 2 + 4},${base - 6}) rotate(-90)">${f.name.replace(/ \(.*\)/, '')}</text>`;
      x += w + 6;
    });
  });
  out += `<line x1="${pad}" x2="${x}" y1="${base}" y2="${base}" stroke="var(--muted)"/>`;
  out += `<text x="${pad}" y="${base + 30}">Heights in mm. Every book is drawn to the same scale. Green = hardcover, amber = paperback.</text>`;
  svg.setAttribute('viewBox', `0 0 ${x + pad} ${base + 40}`); svg.style.minWidth = Math.round((x + pad) * 0.6) + 'px'; svg.innerHTML = out;
})();
