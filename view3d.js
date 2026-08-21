/* =====================================================================
   VIEW3D — Visualisation 3D (Plotly) et export STL
   =====================================================================
   Nouveautés / corrections :
     • la carte des écarts (déblai/remblai) est calculée avec la MÊME
       convention et les MÊMES surfaces de référence que la cubature :
       ce qui est affiché en bleu correspond bien au volume « déblai » ;
     • export STL réellement implémenté (le bouton existait mais la
       fonction n'était pas définie : un clic déclenchait une erreur) ;
     • grille bornée pour rester fluide sur mobile.
   ===================================================================== */

'use strict';

const VIEW3D = (() => {
  let lastGrid = null;      // pour l'export STL
  let captures = [];

  function gridFor(d, maxCells = 90000) {
    const l93 = ptsToL93(d.ptsGPS);
    const poly = (d.type === 'circle' && d.center)
      ? GEOM.circlePolygonL93(toL93(d.center.lng, d.center.lat), d.radius) : l93;
    const bb = GEOM.bboxOf(poly);
    let step = Math.sqrt((bb.w * bb.h) / maxCells);
    step = Math.max(0.25, step);

    const border = [];
    poly.forEach((p, i) => {
      const z = (d.type === 'circle') ? getZ(p) : effectiveZ(d.ptsGPS[i]);
      if (isValidZ(z)) border.push({ x: p[0], y: p[1], z });
    });

    const planeFn = border.length >= 3 ? GEOM.makePlaneSurface(border, poly) : null;
    const smoothFn = border.length >= 3 ? GEOM.makeSmoothSurface(border, 2) : null;

    const x0 = bb.minX - step, x1 = bb.maxX + step;
    const y0 = bb.minY - step, y1 = bb.maxY + step;

    const xs = [], ys = [];
    for (let x = x0; x <= x1; x += step) xs.push(x);
    for (let y = y0; y <= y1; y += step) ys.push(y);

    const zT = [], zP = [], zC = [], dP = [];
    for (const y of ys) {
      const rT = [], rP = [], rC = [], rD = [];
      for (const x of xs) {
        if (!GEOM.pointInPoly(x, y, poly)) { rT.push(null); rP.push(null); rC.push(null); rD.push(null); continue; }
        const t = getZ([x, y]);
        rT.push(isValidZ(t) ? t : null);
        const p = planeFn ? planeFn(x, y) : null;
        const c = smoothFn ? smoothFn(x, y) : null;
        rP.push(isValidZ(p) ? p : null);
        rC.push(isValidZ(c) ? c : null);
        rD.push(isValidZ(t) && isValidZ(p) ? t - p : null);   // > 0 : déblai
      }
      zT.push(rT); zP.push(rP); zC.push(rC); dP.push(rD);
    }
    return { xs, ys, zT, zP, zC, dP, bb, step, border, poly };
  }

  function open(id) {
    const d = findFeature(id);
    if (!d || (d.type !== 'area' && d.type !== 'circle')) { toast('La vue 3D nécessite une surface.', 'warn'); return; }
    if (!hasMNT()) { toast('Activez un MNT pour la vue 3D.', 'warn'); return; }

    const win = document.getElementById('window-3d');
    win.style.display = 'flex';
    document.getElementById('plot-3d').innerHTML = '<div class="plot-wait">Génération du modèle 3D…</div>';
    document.getElementById('title-3d').textContent = `Vue 3D — ${d.name}`;

    busy(true, 'Génération du modèle 3D…');
    setTimeout(() => {
      const g = gridFor(d);
      lastGrid = { feature: d, ...g };

      const X = g.xs.map(x => x - g.bb.minX);
      const Y = g.ys.map(y => y - g.bb.minY);
      const hov = 'X %{x:.1f} m · Y %{y:.1f} m<br>Z %{z:.2f} m<extra></extra>';

      const traces = [
        { z: g.zT, x: X, y: Y, type: 'surface', name: 'Terrain naturel', colorscale: 'Earth', showscale: false, hovertemplate: hov },
        { z: g.zP, x: X, y: Y, type: 'surface', name: 'Projet — plan (TIN)', colorscale: 'Blues', showscale: false, opacity: 0.75, visible: false, hovertemplate: hov },
        { z: g.zC, x: X, y: Y, type: 'surface', name: 'Projet — courbe', colorscale: 'Greens', showscale: false, opacity: 0.75, visible: false, hovertemplate: hov },
        {
          z: g.zT, x: X, y: Y, surfacecolor: g.dP, type: 'surface', name: 'Écarts terrain / projet',
          colorscale: [[0, '#c0392b'], [0.5, '#f7f7f7'], [1, '#2471a3']], cmid: 0,
          showscale: true, colorbar: { title: 'Δ (m)', thickness: 12, len: 0.6 },
          visible: false, hovertemplate: 'Δ %{surfacecolor:.2f} m<extra></extra>'
        },
        {
          x: [...g.border.map(p => p.x - g.bb.minX), g.border[0] ? g.border[0].x - g.bb.minX : 0],
          y: [...g.border.map(p => p.y - g.bb.minY), g.border[0] ? g.border[0].y - g.bb.minY : 0],
          z: [...g.border.map(p => p.z), g.border[0] ? g.border[0].z : 0],
          mode: 'lines', type: 'scatter3d', name: 'Contour', line: { color: d.color, width: 6 }
        }
      ];

      const layout = {
        margin: { l: 0, r: 0, b: 0, t: 0 },
        scene: {
          aspectmode: 'data',
          xaxis: { title: 'X (m)', backgroundcolor: '#1b1b1f', gridcolor: '#333' },
          yaxis: { title: 'Y (m)', backgroundcolor: '#1b1b1f', gridcolor: '#333' },
          zaxis: { title: 'Z (m NGF)', backgroundcolor: '#1b1b1f', gridcolor: '#333' }
        },
        paper_bgcolor: '#1b1b1f', font: { color: '#eee' }, showlegend: false
      };

      Plotly.newPlot('plot-3d', traces, layout, { responsive: true, displaylogo: false }).then(() => {
        document.getElementById('layers-3d').innerHTML = `
          <label><input type="checkbox" checked onchange="VIEW3D.setTrace(0,this.checked)"> Terrain naturel</label>
          <label><input type="checkbox" onchange="VIEW3D.setTrace(1,this.checked)"> Projet — plan (TIN)</label>
          <label><input type="checkbox" onchange="VIEW3D.setTrace(2,this.checked)"> Projet — courbe</label>
          <label><input type="checkbox" onchange="VIEW3D.setTrace(3,this.checked)"> Carte des écarts</label>
          <label><input type="checkbox" checked onchange="VIEW3D.setTrace(4,this.checked)"> Contour</label>`;
        const plot = document.getElementById('plot-3d');
        plot.on('plotly_hover', ev => {
          const p = ev.points && ev.points[0]; if (!p) return;
          const g2 = toWGS(p.x + lastGrid.bb.minX, p.y + lastGrid.bb.minY);
          hoverOnMap(g2.lat, g2.lng, p.z);
        });
        busy(false);
      });
    }, 60);
  }

  let hoverMarker = null;
  function hoverOnMap(lat, lng, z) {
    if (!hoverMarker) hoverMarker = L.circleMarker([lat, lng], { radius: 7, color: '#f1c40f', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(APP.map);
    else hoverMarker.setLatLng([lat, lng]);
    const el = document.getElementById('hover-3d');
    if (el) el.textContent = `Z ${fmt(z)} m`;
  }

  function setTrace(i, on) { Plotly.restyle('plot-3d', { visible: on }, [i]); }

  function close() {
    document.getElementById('window-3d').style.display = 'none';
    if (hoverMarker) { APP.map.removeLayer(hoverMarker); hoverMarker = null; }
  }

  /** Comparaison de plusieurs surfaces dans une même scène. */
  function compare() {
    const surfaces = allFeatures().filter(f => (f.type === 'area' || f.type === 'circle') && f.visible);
    if (surfaces.length < 2) { toast('Il faut au moins 2 surfaces visibles.', 'warn'); return; }
    if (!hasMNT()) { toast('Activez un MNT.', 'warn'); return; }

    const win = document.getElementById('window-3d');
    win.style.display = 'flex';
    document.getElementById('title-3d').textContent = `Vue 3D — comparaison (${surfaces.length} surfaces)`;
    document.getElementById('plot-3d').innerHTML = '<div class="plot-wait">Calcul des surfaces…</div>';

    busy(true, 'Calcul des surfaces…');
    setTimeout(() => {
      let gMinX = Infinity, gMinY = Infinity;
      const grids = surfaces.map(d => {
        const g = gridFor(d, Math.max(6000, 40000 / surfaces.length));
        gMinX = Math.min(gMinX, g.bb.minX); gMinY = Math.min(gMinY, g.bb.minY);
        return { d, g };
      });
      const traces = [], ctl = [];
      grids.forEach(({ d, g }, i) => {
        const X = g.xs.map(x => x - gMinX), Y = g.ys.map(y => y - gMinY);
        traces.push({ z: g.zT, x: X, y: Y, type: 'surface', name: `Terrain — ${d.name}`, colorscale: 'Earth', showscale: false });
        traces.push({ z: g.zP, x: X, y: Y, type: 'surface', name: `Projet — ${d.name}`, colorscale: 'Blues', showscale: false, opacity: 0.7, visible: false });
        traces.push({
          x: [...g.border.map(p => p.x - gMinX), g.border[0] ? g.border[0].x - gMinX : 0],
          y: [...g.border.map(p => p.y - gMinY), g.border[0] ? g.border[0].y - gMinY : 0],
          z: [...g.border.map(p => p.z), g.border[0] ? g.border[0].z : 0],
          mode: 'lines', type: 'scatter3d', line: { color: d.color, width: 5 }, name: `Contour — ${d.name}`
        });
        const b = i * 3;
        ctl.push(`<div class="l3d-group" style="border-color:${d.color}"><b>${escapeHtml(d.name)}</b>
          <label><input type="checkbox" checked onchange="VIEW3D.setTrace(${b},this.checked)"> Terrain</label>
          <label><input type="checkbox" onchange="VIEW3D.setTrace(${b + 1},this.checked)"> Projet</label>
          <label><input type="checkbox" checked onchange="VIEW3D.setTrace(${b + 2},this.checked)"> Contour</label></div>`);
      });
      const layout = {
        margin: { l: 0, r: 0, b: 0, t: 0 },
        scene: { aspectmode: 'data', xaxis: { title: 'X (m)' }, yaxis: { title: 'Y (m)' }, zaxis: { title: 'Z (m)' } },
        paper_bgcolor: '#1b1b1f', font: { color: '#eee' }, showlegend: false
      };
      Plotly.newPlot('plot-3d', traces, layout, { responsive: true, displaylogo: false })
        .then(() => busy(false));
      document.getElementById('layers-3d').innerHTML = ctl.join('');
      lastGrid = { feature: surfaces[0], ...grids[0].g };
    }, 60);
  }

  /* ---------------- Export STL ---------------- */

  /**
   * Écrit un STL binaire du maillage courant.
   * @param {string} which 'terrain' | 'plan' | 'courbe'
   */
  function exportSTL(which = 'terrain') {
    if (!lastGrid) { toast('Ouvrez d’abord une vue 3D.', 'warn'); return; }
    const g = lastGrid;
    const Z = which === 'plan' ? g.zP : which === 'courbe' ? g.zC : g.zT;
    const tris = [];
    for (let j = 0; j < g.ys.length - 1; j++) {
      for (let i = 0; i < g.xs.length - 1; i++) {
        const z00 = Z[j][i], z10 = Z[j][i + 1], z01 = Z[j + 1][i], z11 = Z[j + 1][i + 1];
        const x0 = g.xs[i] - g.bb.minX, x1 = g.xs[i + 1] - g.bb.minX;
        const y0 = g.ys[j] - g.bb.minY, y1 = g.ys[j + 1] - g.bb.minY;
        if (z00 !== null && z10 !== null && z11 !== null) tris.push([[x0, y0, z00], [x1, y0, z10], [x1, y1, z11]]);
        if (z00 !== null && z11 !== null && z01 !== null) tris.push([[x0, y0, z00], [x1, y1, z11], [x0, y1, z01]]);
      }
    }
    if (!tris.length) { toast('Maillage vide.', 'err'); return; }

    const buf = new ArrayBuffer(84 + tris.length * 50);
    const dv = new DataView(buf);
    const head = `Terrassement SB - ${g.feature.name} - ${which}`;
    for (let i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? head.charCodeAt(i) : 32);
    dv.setUint32(80, tris.length, true);
    let o = 84;
    for (const t of tris) {
      const n = normal(t);
      dv.setFloat32(o, n[0], true); dv.setFloat32(o + 4, n[1], true); dv.setFloat32(o + 8, n[2], true);
      o += 12;
      for (const v of t) { dv.setFloat32(o, v[0], true); dv.setFloat32(o + 4, v[1], true); dv.setFloat32(o + 8, v[2], true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
    EXPORTS.saveBlob(new Blob([buf], { type: 'model/stl' }),
      `${slug(g.feature.name)}_${which}.stl`);
    toast(`STL exporté (${fmt(tris.length, 0)} triangles).`, 'ok');
  }

  function normal(t) {
    const u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]];
    const v = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    return n.map(c => c / l);
  }

  function slug(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_'); }

  /* ---------------- Captures pour le rapport ---------------- */

  async function capture() {
    const plot = document.getElementById('plot-3d');
    if (!plot || !plot.data) { toast('Aucune vue 3D à capturer.', 'warn'); return; }
    if (captures.length >= 4) { toast('4 captures maximum par rapport.', 'warn'); return; }
    const url = await Plotly.toImage(plot, { format: 'png', width: 1200, height: 800 });
    captures.push(url);
    document.getElementById('btn-capture-3d').textContent = `📸 Capturer (${captures.length}/4)`;
    toast('Vue ajoutée au rapport PDF.', 'ok');
  }
  function getCaptures() { return captures; }
  function clearCaptures() {
    captures = [];
    const b = document.getElementById('btn-capture-3d'); if (b) b.textContent = '📸 Capturer (0/4)';
  }

  function fullscreen() {
    const win = document.getElementById('window-3d');
    if (!document.fullscreenElement) win.requestFullscreen?.().then(() => Plotly.Plots.resize('plot-3d'));
    else document.exitFullscreen();
  }

  function resize() { const p = document.getElementById('plot-3d'); if (p && p.data) Plotly.Plots.resize(p); }

  return { open, close, compare, setTrace, exportSTL, capture, getCaptures, clearCaptures, fullscreen, resize, gridFor, lastGrid: () => lastGrid };
})();

window.VIEW3D = VIEW3D;
