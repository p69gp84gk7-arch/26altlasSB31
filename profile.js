/* =====================================================================
   PROFILE — Profil en long, ligne projet, déblai/remblai linéaire
   =====================================================================
   Convention identique au moteur de cubature 3D :
       DÉBLAI  = terrain au-dessus du projet
       REMBLAI = terrain en-dessous du projet
   La courbe « terrain naturel » provient TOUJOURS du MNT ; les altitudes
   forcées (Z) alimentent la ligne PROJET. Dans l'ancienne version les deux
   étaient mélangées sur la même courbe, ce qui produisait des marches et
   rendait le calcul déblai/remblai du profil incomparable avec la 3D.
   ===================================================================== */

'use strict';

const PROFILE = (() => {
  let chart = null;
  let current = null;        // tracé affiché
  let terrain = [];          // [{x, y}] terrain naturel
  let geo = [];              // positions géographiques correspondantes
  let editing = false;
  let dragIdx = null;
  let cursorMarker = null;

  /* ---------- Échantillonnage ---------- */

  function sample(d) {
    const l93 = ptsToL93(d.ptsGPS);
    let total = 0;
    for (let i = 1; i < l93.length; i++) total += Math.hypot(l93[i][0] - l93[i - 1][0], l93[i][1] - l93[i - 1][1]);
    const step = Math.max(0.5, Math.min(5, total / 800));

    const T = [], G = [], V = [];   // V : abscisses des sommets
    let dist = 0;
    const push = (x, xy) => {
      const z = getZ(xy);
      T.push({ x: +x.toFixed(2), y: isValidZ(z) ? +z.toFixed(2) : null });
      const g = toWGS(xy[0], xy[1]); G.push(g);
    };

    push(0, l93[0]); V.push({ x: 0, i: 0 });
    for (let i = 1; i < l93.length; i++) {
      const seg = Math.hypot(l93[i][0] - l93[i - 1][0], l93[i][1] - l93[i - 1][1]);
      for (let s = step; s < seg - 1e-6; s += step) {
        const t = s / seg;
        push(dist + s, [l93[i - 1][0] + (l93[i][0] - l93[i - 1][0]) * t,
                        l93[i - 1][1] + (l93[i][1] - l93[i - 1][1]) * t]);
      }
      dist += seg;
      push(dist, l93[i]); V.push({ x: +dist.toFixed(2), i });
    }
    return { terrain: T, geo: G, vertices: V, total: dist };
  }

  /** Ligne projet déduite des Z forcés saisis sur les sommets. */
  function projectFromForcedZ(d, vertices) {
    const out = [];
    vertices.forEach(v => {
      const pt = d.ptsGPS[v.i];
      if (pt && pt.customZ !== undefined && isValidZ(pt.customZ)) out.push({ x: v.x, y: +pt.customZ.toFixed(2) });
    });
    return out;
  }

  /* ---------- Calcul déblai / remblai (aires) ---------- */

  function terrainAt(x) { return sampleAt(terrain, x); }

  /**
   * Aires de déblai / remblai entre le terrain et la ligne projet.
   *
   * CORRECTION IMPORTANTE : la version d'origine n'intégrait qu'entre les
   * sommets de la ligne projet. Avec une ligne projet à deux points (le cas
   * le plus courant : une pente constante), le terrain n'était échantillonné
   * qu'à ses deux extrémités et le résultat valait donc toujours zéro.
   * On intègre désormais sur l'union des abscisses terrain + projet, avec
   * traitement exact des points de passage (changement de signe).
   *
   * @param {Array} project [{x,y}] ligne projet
   * @param {Array} [T]     échantillons terrain (défaut : profil affiché)
   */
  function areas(project, T) {
    T = T || terrain;
    if (!project || project.length < 2 || !T || T.length < 2) return { cut: 0, fill: 0, xCut: 0, xFill: 0 };

    const x0 = project[0].x, x1 = project[project.length - 1].x;

    const xs = [];
    for (const p of T) if (p.x >= x0 && p.x <= x1) xs.push(p.x);
    for (const p of project) if (p.x >= x0 && p.x <= x1) xs.push(p.x);
    xs.sort((a, b) => a - b);
    const uniq = xs.filter((v, i) => i === 0 || v - xs[i - 1] > 1e-6);
    if (uniq.length < 2) return { cut: 0, fill: 0, xCut: 0, xFill: 0 };

    let cut = 0, fill = 0, xCut = 0, xFill = 0;
    for (let i = 0; i < uniq.length - 1; i++) {
      const xa = uniq[i], xb = uniq[i + 1];
      const h = xb - xa;
      if (h <= 1e-9) continue;
      const ta = sampleAt(T, xa), tb = sampleAt(T, xb);
      const pa = interp(project, xa), pb = interp(project, xb);
      if (ta === null || tb === null || pa === null || pb === null) continue;
      const d1 = ta - pa;      // > 0 : terrain au-dessus du projet ⇒ déblai
      const d2 = tb - pb;

      if (d1 >= 0 && d2 >= 0) { cut += (d1 + d2) / 2 * h; xCut += h; }
      else if (d1 <= 0 && d2 <= 0) { fill += (-d1 - d2) / 2 * h; xFill += h; }
      else {
        const k = Math.abs(d1) / (Math.abs(d1) + Math.abs(d2));
        const h1 = k * h, h2 = h - h1;
        if (d1 > 0) { cut += d1 / 2 * h1; xCut += h1; fill += Math.abs(d2) / 2 * h2; xFill += h2; }
        else { fill += Math.abs(d1) / 2 * h1; xFill += h1; cut += d2 / 2 * h2; xCut += h2; }
      }
    }
    return { cut, fill, xCut, xFill };
  }

  /** Interpolation dans une série d'échantillons triée par abscisse. */
  function sampleAt(T, x) {
    if (!T || !T.length) return null;
    if (x <= T[0].x) return T[0].y;
    if (x >= T[T.length - 1].x) return T[T.length - 1].y;
    let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m].x <= x) lo = m; else hi = m; }
    const a = T[lo], b = T[hi];
    if (a.y === null || b.y === null) return a.y ?? b.y;
    const t = (x - a.x) / ((b.x - a.x) || 1);
    return a.y + t * (b.y - a.y);
  }

  /** Aires d'un tracé quelconque, hors affichage (rapport PDF). */
  function areasFor(d) {
    if (!d || !d.projectPts || d.projectPts.length < 2) return { cut: 0, fill: 0, xCut: 0, xFill: 0 };
    return areas(d.projectPts, sample(d).terrain);
  }

  /* ---------- Affichage ---------- */

  function open(d) {
    if (!d) return;
    if (!hasMNT()) { toast('Activez un MNT pour afficher un profil.', 'warn'); return; }
    current = d;
    if (!d.projectPts) d.projectPts = [];

    const s = sample(d);
    terrain = s.terrain; geo = s.geo;

    // Si aucune ligne projet n'existe encore, on propose celle des Z forcés
    if (!d.projectPts.length) {
      const auto = projectFromForcedZ(d, s.vertices);
      if (auto.length >= 2) d.projectPts = auto;
    }

    document.getElementById('profile-window').style.display = 'flex';
    document.getElementById('profile-title').textContent = `Profil en long — ${d.name}`;
    document.getElementById('profile-window').classList.remove('park-mode');
    document.getElementById('profile-mode-terra').style.display = 'flex';
    document.getElementById('profile-mode-park').style.display = 'none';
    document.getElementById('prof-width').value = d.profileWidth ?? 6;

    draw(d);
    updateResults(d);
    // Chart.js a besoin d'un layout stabilisé avant de mesurer son conteneur
    setTimeout(() => chart && chart.resize(), 60);
  }

  function openById(id) { open(findFeature(id)); }
  function isOpenFor(d) { return current === d && document.getElementById('profile-window').style.display !== 'none'; }
  function close() {
    document.getElementById('profile-window').style.display = 'none';
    if (cursorMarker) { APP.map.removeLayer(cursorMarker); cursorMarker = null; }
  }

  function draw(d) {
    const cv = document.getElementById('profileChart');
    // Le module Snowpark peut avoir pris possession du même canvas
    const prev = Chart.getChart(cv); if (prev) prev.destroy();
    chart = null;
    const ctx = cv.getContext('2d');

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Terrain naturel (MNT)', data: terrain, parsing: false,
            borderColor: d.color, backgroundColor: d.color + '22', fill: 'start',
            pointRadius: 0, borderWidth: 2, tension: 0.05, order: 3, spanGaps: true
          },
          {
            label: 'Projet', data: d.projectPts, parsing: false,
            borderColor: '#f1c40f', backgroundColor: 'transparent', fill: false,
            pointRadius: 5, pointHoverRadius: 8, pointBackgroundColor: '#f1c40f',
            borderWidth: 2, tension: 0, order: 1
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: { type: 'linear', title: { display: true, text: 'Distance horizontale (m)' }, ticks: { maxTicksLimit: 12 } },
          y: { title: { display: true, text: 'Altitude NGF (m)' } }
        },
        plugins: {
          legend: { labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: {
              title: c => `PK ${fmt(c[0].parsed.x, 1)} m`,
              label: c => `${c.dataset.label} : ${fmt(c.parsed.y)} m`,
              afterBody: c => {
                const x = c[0].parsed.x, t = terrainAt(x);
                const p = interp(d.projectPts, x);
                if (t === null || p === null) return '';
                const dz = t - p;
                return dz >= 0 ? `Déblai : ${fmt(dz)} m` : `Remblai : ${fmt(-dz)} m`;
              }
            }
          }
        },
        onHover: (e, els) => {
          if (editing) return;
          if (els && els.length && els[0].datasetIndex === 0) {
            const g = geo[els[0].index];
            if (g) showCursor(g.lat, g.lng);
          }
        }
      }
    });

    bindPointer(cv, d);
    setupScales();
  }

  function interp(arr, x) {
    if (!arr || arr.length < 2) return null;
    if (x < arr[0].x || x > arr[arr.length - 1].x) return null;
    for (let i = 0; i < arr.length - 1; i++) {
      if (x >= arr[i].x && x <= arr[i + 1].x) {
        const t = (x - arr[i].x) / ((arr[i + 1].x - arr[i].x) || 1);
        return arr[i].y + t * (arr[i + 1].y - arr[i].y);
      }
    }
    return null;
  }

  function showCursor(lat, lng) {
    if (!cursorMarker) {
      cursorMarker = L.circleMarker([lat, lng], { radius: 7, color: '#e74c3c', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(APP.map);
    } else cursorMarker.setLatLng([lat, lng]);
  }

  /* ---------- Édition de la ligne projet (souris ET tactile) ---------- */

  function bindPointer(cv, d) {
    cv.style.touchAction = 'none';

    const pos = ev => {
      const r = cv.getBoundingClientRect();
      return { px: ev.clientX - r.left, py: ev.clientY - r.top };
    };
    const nearest = (px, py) => {
      let idx = -1, best = 18;
      d.projectPts.forEach((p, i) => {
        const dx = chart.scales.x.getPixelForValue(p.x) - px;
        const dy = chart.scales.y.getPixelForValue(p.y) - py;
        const dd = Math.hypot(dx, dy);
        if (dd < best) { best = dd; idx = i; }
      });
      return idx;
    };

    cv.onpointerdown = ev => {
      if (!editing) return;
      cv.setPointerCapture(ev.pointerId);
      const { px, py } = pos(ev);
      const i = nearest(px, py);
      if (i >= 0) { dragIdx = i; return; }
      const x = chart.scales.x.getValueForPixel(px);
      const y = chart.scales.y.getValueForPixel(py);
      if (x === undefined || y === undefined) return;
      d.projectPts.push({ x: +x.toFixed(2), y: +y.toFixed(2) });
      d.projectPts.sort((a, b) => a.x - b.x);
      chart.update('none'); updateResults(d);
    };

    cv.onpointermove = ev => {
      if (!editing || dragIdx === null) return;
      const { px, py } = pos(ev);
      const x = chart.scales.x.getValueForPixel(px);
      const y = chart.scales.y.getValueForPixel(py);
      if (x === undefined || y === undefined) return;
      d.projectPts[dragIdx] = { x: +x.toFixed(2), y: +y.toFixed(2) };
      chart.update('none'); updateResults(d);
    };

    cv.onpointerup = cv.onpointercancel = () => {
      if (dragIdx !== null) { d.projectPts.sort((a, b) => a.x - b.x); dragIdx = null; chart.update('none'); updateResults(d); }
    };

    cv.ondblclick = ev => {
      if (!editing) return;
      const { px, py } = pos(ev);
      const i = nearest(px, py);
      if (i >= 0) { d.projectPts.splice(i, 1); chart.update('none'); updateResults(d); }
    };

    cv.onmouseleave = () => { if (cursorMarker) { APP.map.removeLayer(cursorMarker); cursorMarker = null; } };
  }

  function toggleEdit() {
    editing = !editing;
    const b = document.getElementById('btn-prof-edit');
    b.classList.toggle('on', editing);
    b.textContent = editing ? '✅ Terminer' : '✏️ Ligne projet';
    document.getElementById('prof-edit-hint').style.display = editing ? 'block' : 'none';
    document.getElementById('profileChart').style.cursor = editing ? 'crosshair' : 'default';
  }

  function clearProject() {
    if (!current) return;
    if (!current.projectPts.length || !confirm('Effacer la ligne projet de ce profil ?')) return;
    current.projectPts = [];
    chart.data.datasets[1].data = current.projectPts;
    chart.update('none'); updateResults(current);
  }

  /** Ligne projet = pente constante entre le premier et le dernier point du terrain. */
  function projectAsSlope() {
    if (!current || !terrain.length) return;
    const zA = terrain[0].y, zB = terrain[terrain.length - 1].y;
    const v = prompt('Pente du projet en % (vide = raccorder les extrémités du terrain) :', '');
    if (v === null) return;
    const L = terrain[terrain.length - 1].x;
    let z0 = zA, z1 = zB;
    if (v.trim() !== '') {
      const p = parseFloat(v.replace(',', '.')) / 100;
      if (Number.isNaN(p)) { toast('Pente invalide.', 'err'); return; }
      z1 = z0 + p * L;
    }
    current.projectPts = [{ x: 0, y: +z0.toFixed(2) }, { x: +L.toFixed(2), y: +z1.toFixed(2) }];
    chart.data.datasets[1].data = current.projectPts;
    chart.update('none'); updateResults(current);
  }

  /* ---------- Résultats ---------- */

  function updateResults(d) {
    const a = areas(d.projectPts);
    const w = parseFloat(document.getElementById('prof-width').value) || 0;
    d.profileWidth = w;
    d.profileAreas = a;

    const box = document.getElementById('profile-results');
    if (!d.projectPts || d.projectPts.length < 2) {
      box.innerHTML = `<div class="muted">Dessinez la ligne projet (bouton « Ligne projet ») pour obtenir les cubatures linéaires.</div>`;
      return;
    }
    const vCut = a.cut * w, vFill = a.fill * w;
    const net = vCut - vFill;
    box.innerHTML = `
      <div class="pr-item cut"><span>Déblai</span><b>${fmt(a.cut, 2)} m²</b><i>${w > 0 ? fmtM3(vCut) : ''}</i></div>
      <div class="pr-item fill"><span>Remblai</span><b>${fmt(a.fill, 2)} m²</b><i>${w > 0 ? fmtM3(vFill) : ''}</i></div>
      <div class="pr-item bal"><span>Bilan</span><b>${net >= 0 ? '+' : '−'}${fmt(Math.abs(net), 1)} m³</b>
        <i>${net >= 0 ? 'excédent' : 'déficit'}</i></div>
      <div class="pr-item"><span>Linéaire déblai / remblai</span><b>${fmt(a.xCut, 0)} / ${fmt(a.xFill, 0)} m</b><i></i></div>`;
  }

  function setWidth() { if (current) updateResults(current); }

  /* ---------- Échelles ---------- */

  function setupScales() {
    const ys = terrain.map(p => p.y).filter(v => v !== null);
    if (!ys.length) return;
    const zMin = Math.min(...ys), zMax = Math.max(...ys), L = terrain[terrain.length - 1].x;
    const el = id => document.getElementById(id);
    el('x-min').max = L; el('x-max').max = L; el('x-min').value = 0; el('x-max').value = L;
    el('y-min').min = zMin - 20; el('y-min').max = zMax + 20;
    el('y-max').min = zMin - 20; el('y-max').max = zMax + 20;
    el('y-min').value = Math.floor(zMin - 2); el('y-max').value = Math.ceil(zMax + 2);
    applyScales();
  }

  function applyScales() {
    if (!chart) return;
    const g = id => parseFloat(document.getElementById(id).value);
    const xMin = g('x-min'), xMax = g('x-max'), yMin = g('y-min'), yMax = g('y-max');
    document.getElementById('x-vals').textContent = `${fmt(xMin, 0)} – ${fmt(xMax, 0)} m`;
    document.getElementById('y-vals').textContent = `${fmt(yMin, 0)} – ${fmt(yMax, 0)} m`;
    chart.options.scales.x.min = Math.min(xMin, xMax - 1);
    chart.options.scales.x.max = Math.max(xMax, xMin + 1);
    chart.options.scales.y.min = Math.min(yMin, yMax - 1);
    chart.options.scales.y.max = Math.max(yMax, yMin + 1);
    chart.update('none');
  }

  function fitScales() { setupScales(); }

  /* ---------- Accès pour les exports ---------- */

  function data() {
    return { feature: current, terrain, geo, project: current ? current.projectPts : [], chart };
  }

  return {
    open, openById, close, isOpenFor, toggleEdit, clearProject, projectAsSlope,
    applyScales, fitScales, setWidth, data, areas, areasFor, terrainAt, sample, interp
  };
})();

window.PROFILE = PROFILE;
