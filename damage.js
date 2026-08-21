/* =====================================================================
   DAMAGE — Aide à la planification du damage des pistes
   =====================================================================
   À partir des polygones de pistes (calque KMZ) et du MNT :
     • surface réelle (développée le long du terrain, pas la projection) ;
     • génération d'un parcours en va-et-vient à l'écartement de la lame,
       orienté selon la ligne de plus grande pente ou l'axe le plus long,
       de façon à minimiser les demi-tours et les reprises ;
     • temps de damage par piste, en distinguant travail montée / descente,
       demi-tours et trajets à vide ;
     • répartition des pistes entre les machines (ordonnancement LPT puis
       tournée au plus proche voisin depuis le garage) ;
     • tracé des parcours sur la carte, une couleur par machine.

   Le modèle reste géométrique : il ne connaît ni la qualité de neige, ni le
   treuil, ni les zones interdites. Il sert à comparer des organisations
   entre elles, pas à garantir un horaire à la minute.
   ===================================================================== */

'use strict';

const DAMAGE = (() => {

  const DEF = {
    machines: 2,
    bladeWidth: 6,        // largeur de travail de la lame + fraise (m)
    overlap: 10,          // recouvrement entre passes (%)
    speedUp: 8,           // vitesse de travail en montée (km/h)
    speedDown: 12,        // vitesse de travail en descente (km/h)
    speedTransit: 18,     // vitesse de déplacement à vide (km/h)
    turnTime: 25,         // durée d'un demi-tour (s)
    margin: 15,           // majoration pour bords, obstacles, reprises (%)
    pattern: 'optim',     // 'optim' | 'slope' | 'cross' | 'auto'
    start: '17:30',
    maxSlope: 0            // pente maxi admissible en % (0 = pas de contrôle)
  };

  let params = { ...DEF };
  let depot = null;            // {lat, lng} garage / point de départ
  let depotMarker = null;
  let pathLayer = null;
  let result = null;

  const MACHINE_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c', '#ec407a'];

  /* ==================================================================
     CONSTITUTION DE LA LISTE DES PISTES
     ================================================================== */

  /**
   * Extrait les pistes du calque GeoJSON.
   * Les polygones du fichier n'ont pas de nom : on les numérote par surface
   * décroissante, à charge pour l'utilisateur de les renommer.
   */
  function buildFromGeoJSON(gj, minArea = 400) {
    const out = [];
    const push = (ring, props) => {
      const pts = ring.map(c => ({ lat: c[1], lng: c[0] }));
      if (pts.length < 4) return;
      const l93 = ptsToL93(pts);
      const area = GEOM.polyArea(l93);
      if (area < minArea) return;
      out.push({
        id: uid(),
        name: (props && (props.Name || props.name || props.ID)) || null,
        pts, area, selected: false
      });
    };
    (gj.features || []).forEach(f => {
      const g = f.geometry; if (!g) return;
      if (g.type === 'Polygon') push(g.coordinates[0], f.properties);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(poly => push(poly[0], f.properties));
    });
    out.sort((a, b) => b.area - a.area);
    out.forEach((p, i) => { if (!p.name) p.name = `Piste ${String(i + 1).padStart(2, '0')}`; });
    return out;
  }

  function init() {
    if (APP.pistes && APP.pistes.length) return;
    if (typeof pistesData === 'undefined') { APP.pistes = []; return; }
    APP.pistes = buildFromGeoJSON(pistesData);
  }

  /* ==================================================================
     GÉOMÉTRIE DU PARCOURS
     ================================================================== */

  /** Azimut moyen de la ligne de plus grande pente sur la piste (radians, repère L93). */
  function meanFallLine(poly) {
    const bb = GEOM.bboxOf(poly);
    const step = Math.max(5, Math.sqrt(bb.w * bb.h / 400));
    let gx = 0, gy = 0, n = 0;
    for (let y = bb.minY; y <= bb.maxY; y += step) {
      for (let x = bb.minX; x <= bb.maxX; x += step) {
        if (!GEOM.pointInPoly(x, y, poly)) continue;
        const d = 8;
        const zx1 = getZ([x - d, y]), zx2 = getZ([x + d, y]);
        const zy1 = getZ([x, y - d]), zy2 = getZ([x, y + d]);
        if (![zx1, zx2, zy1, zy2].every(isValidZ)) continue;
        gx += (zx2 - zx1) / (2 * d); gy += (zy2 - zy1) / (2 * d); n++;
      }
    }
    if (!n || Math.hypot(gx, gy) < 1e-9) return null;
    return Math.atan2(-gy, -gx);        // direction de la descente
  }

  /** Surface développée le long du terrain et pente moyenne. */
  function developedArea(poly) {
    const bb = GEOM.bboxOf(poly);
    const step = Math.max(2, Math.sqrt(bb.w * bb.h / 20000));
    const cell = step * step;
    let dev = 0, flat = 0, slopeSum = 0, n = 0, zMin = Infinity, zMax = -Infinity;
    for (let y = bb.minY + step / 2; y <= bb.maxY; y += step) {
      for (let x = bb.minX + step / 2; x <= bb.maxX; x += step) {
        if (!GEOM.pointInPoly(x, y, poly)) continue;
        flat += cell;
        const d = step;
        const zx1 = getZ([x - d, y]), zx2 = getZ([x + d, y]);
        const zy1 = getZ([x, y - d]), zy2 = getZ([x, y + d]);
        const zc = getZ([x, y]);
        if (isValidZ(zc)) { zMin = Math.min(zMin, zc); zMax = Math.max(zMax, zc); }
        if (![zx1, zx2, zy1, zy2].every(isValidZ)) { dev += cell; continue; }
        const sx = (zx2 - zx1) / (2 * d), sy = (zy2 - zy1) / (2 * d);
        const g = Math.hypot(sx, sy);
        dev += cell * Math.sqrt(1 + g * g);
        slopeSum += g; n++;
      }
    }
    return {
      flat, dev,
      slopeMean: n ? slopeSum / n * 100 : 0,
      zMin: zMin === Infinity ? null : zMin,
      zMax: zMax === -Infinity ? null : zMax
    };
  }

  /**
   * Parcours en va-et-vient (boustrophédon) couvrant le polygone.
   * @returns {{pts:Array<[number,number]>, work:number, dead:number, turns:number, passes:number}}
   */
  function buildPath(poly, angle, spacing) {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const ax = GEOM.principalAxis(poly);

    // Étendue perpendiculaire à la direction de balayage
    let vMin = Infinity, vMax = -Infinity;
    for (const p of poly) {
      const v = -(p[0] - ax.cx) * sa + (p[1] - ax.cy) * ca;
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
    }

    const lines = [];
    let dir = 1;
    const nPass = Math.max(1, Math.ceil((vMax - vMin) / spacing));
    for (let k = 0; k < nPass; k++) {
      const v = vMin + spacing * (k + 0.5);
      if (v > vMax) break;
      const ox = ax.cx - sa * v, oy = ax.cy + ca * v;
      const segs = GEOM.clipLineToPoly(ox, oy, ca, sa, poly);
      if (!segs.length) continue;
      const ordered = dir > 0 ? segs : segs.slice().reverse();
      for (const [t0, t1] of ordered) {
        const a = [ox + ca * t0, oy + sa * t0];
        const b = [ox + ca * t1, oy + sa * t1];
        lines.push(dir > 0 ? [a, b] : [b, a]);
      }
      dir = -dir;
    }
    if (!lines.length) return { pts: [], work: 0, dead: 0, turns: 0, passes: 0 };

    // Chaînage : longueur travaillée, trajets de raccordement, demi-tours
    const pts = [];
    let work = 0, dead = 0, turns = 0;
    lines.forEach((seg, i) => {
      if (i > 0) {
        const prev = lines[i - 1][1];
        dead += Math.hypot(seg[0][0] - prev[0], seg[0][1] - prev[1]);
        turns++;
        pts.push(prev);
      }
      pts.push(seg[0], seg[1]);
      work += Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]);
    });
    return { pts, work, dead, turns, passes: lines.length };
  }

  /** Longueur d'un parcours corrigée du relief (le sol est en pente). */
  function slopeFactor(slopeMeanPct) {
    const g = slopeMeanPct / 100;
    return Math.sqrt(1 + g * g);
  }

  /* ==================================================================
     CALCUL
     ================================================================== */

  /** Durée d'un parcours donné, à partir de sa géométrie. */
  function pathTime(path, kf) {
    const work3D = path.work * kf, dead3D = path.dead * kf;
    const vUp = params.speedUp / 3.6, vDown = params.speedDown / 3.6, vT = params.speedTransit / 3.6;
    const tWork = (work3D / 2) / Math.max(0.1, vUp) + (work3D / 2) / Math.max(0.1, vDown);
    return (tWork + dead3D / Math.max(0.1, vT) + path.turns * params.turnTime) * (1 + params.margin / 100);
  }

  function computePiste(p) {
    const poly = ptsToL93(p.pts);
    const geo = developedArea(poly);
    const spacing = Math.max(1, params.bladeWidth * (1 - params.overlap / 100));
    const kf = slopeFactor(geo.slopeMean);
    const fall = meanFallLine(poly);
    const axis = GEOM.principalAxis(poly).angle;

    let angle, path;
    if (params.pattern === 'optim') {
      // Recherche de l'orientation la plus efficace : on balaye 180° par pas de
      // 10°, en forçant l'évaluation de la ligne de pente et de l'axe le plus
      // long. C'est ce qui minimise le nombre de passes et de demi-tours.
      const cands = [];
      for (let a = 0; a < 180; a += 10) cands.push(a * Math.PI / 180);
      if (fall !== null) cands.push(fall, fall + Math.PI / 2);
      cands.push(axis, axis + Math.PI / 2);
      let best = null;
      for (const a of cands) {
        const pa = buildPath(poly, a, spacing);
        if (!pa.pts.length) continue;
        const t = pathTime(pa, kf);
        if (!best || t < best.t) best = { a, pa, t };
      }
      if (best) { angle = best.a; path = best.pa; }
    }
    if (path === undefined) {
      if (params.pattern === 'slope') angle = fall;
      else if (params.pattern === 'cross') angle = fall === null ? null : fall + Math.PI / 2;
      else if (params.pattern === 'auto') angle = axis;
      if (angle === null || angle === undefined || Number.isNaN(angle)) angle = axis;
      path = buildPath(poly, angle, spacing);
    }

    const work3D = path.work * kf;
    const dead3D = path.dead * kf;
    const time = pathTime(path, kf);

    // Écart entre le sens des passes et la ligne de plus grande pente
    let toFall = null;
    if (fall !== null) {
      let d = Math.abs(((angle - fall) % Math.PI + Math.PI) % Math.PI) / Math.PI * 180;
      toFall = d > 90 ? 180 - d : d;
    }
    const sens = toFall === null ? 'indéterminé'
      : toFall < 30 ? 'montée / descente'
      : toFall > 60 ? 'transversal' : 'oblique';

    const warns = [];
    if (params.maxSlope > 0 && geo.slopeMean > params.maxSlope)
      warns.push(`Pente moyenne ${fmt(geo.slopeMean, 0)} % supérieure au seuil (${params.maxSlope} %) : treuil probablement nécessaire.`);
    if (sens === 'transversal' && geo.slopeMean > 45)
      warns.push(`Passes transversales sur une pente à ${fmt(geo.slopeMean, 0)} % : dévers important, à valider avec les conducteurs.`);

    return {
      ...p, poly, path, angle, sens, toFall,
      areaFlat: geo.flat, areaDev: geo.dev,
      slopeMean: geo.slopeMean, zMin: geo.zMin, zMax: geo.zMax,
      passes: path.passes, work: work3D, dead: dead3D, turns: path.turns,
      time, spacing,
      warn: warns.length ? warns.join(' ') : null
    };
  }

  function centroid(poly) {
    const ax = GEOM.principalAxis(poly);
    return [ax.cx, ax.cy];
  }

  function compute() {
    const sel = APP.pistes.filter(p => p.selected);
    if (!sel.length) { toast('Sélectionnez au moins une piste.', 'warn'); return; }
    if (!hasMNT()) { toast('Activez un MNT : la surface réelle et les pentes en dépendent.', 'warn'); return; }

    busy(true, 'Calcul des parcours…').then(() => setTimeout(() => {
      const pistes = sel.map(computePiste);

      /* --- Répartition entre machines : LPT (plus longues d'abord) --- */
      const N = Math.max(1, Math.round(params.machines));
      const machines = Array.from({ length: N }, (_, i) => ({ i, pistes: [], work: 0 }));
      pistes.slice().sort((a, b) => b.time - a.time).forEach(p => {
        machines.sort((a, b) => a.work - b.work);
        machines[0].pistes.push(p);
        machines[0].work += p.time;
      });
      machines.sort((a, b) => a.i - b.i);

      /* --- Tournée : plus proche voisin depuis le garage --- */
      const vT = params.speedTransit / 3.6;
      const dep = depot ? toL93(depot.lng, depot.lat) : null;
      machines.forEach(m => {
        const rest = m.pistes.slice();
        const order = [];
        let cur = dep || (rest.length ? centroid(rest[0].poly) : [0, 0]);
        let transit = 0;
        while (rest.length) {
          let bi = 0, bd = Infinity;
          rest.forEach((p, i) => {
            const c = centroid(p.poly);
            const d = Math.hypot(c[0] - cur[0], c[1] - cur[1]);
            if (d < bd) { bd = d; bi = i; }
          });
          transit += bd;
          const p = rest.splice(bi, 1)[0];
          p.transitIn = bd;
          order.push(p);
          cur = centroid(p.poly);
        }
        if (dep) transit += Math.hypot(cur[0] - dep[0], cur[1] - dep[1]);   // retour garage
        m.pistes = order;
        m.transit = transit;
        m.transitTime = transit / Math.max(0.1, vT);
        m.total = m.work + m.transitTime;
      });

      const totalArea = pistes.reduce((a, p) => a + p.areaDev, 0);
      const totalWork = pistes.reduce((a, p) => a + p.work, 0);
      const longest = Math.max(...machines.map(m => m.total));

      result = { pistes, machines, totalArea, totalWork, longest, params: { ...params }, depot };
      drawPaths();
      renderResults();
      busy(false);
      toast(`Damage terminé en ${hms(longest)} avec ${N} machine(s).`, 'ok', 6000);
    }, 40));
  }

  /* ==================================================================
     AFFICHAGE
     ================================================================== */

  function drawPaths() {
    if (pathLayer) APP.map.removeLayer(pathLayer);
    if (!result) return;
    pathLayer = L.layerGroup().addTo(APP.map);

    result.machines.forEach((m, mi) => {
      const col = MACHINE_COLORS[mi % MACHINE_COLORS.length];
      m.pistes.forEach((p, k) => {
        // Emprise
        L.polygon(p.pts, { color: col, weight: 2, fillColor: col, fillOpacity: 0.12 })
          .bindTooltip(`${p.name} — machine ${mi + 1} · ${hms(p.time)}`, { sticky: true })
          .addTo(pathLayer);
        // Parcours
        if (p.path.pts.length > 1) {
          const ll = p.path.pts.map(q => { const g = toWGS(q[0], q[1]); return [g.lat, g.lng]; });
          L.polyline(ll, { color: col, weight: 1.6, opacity: 0.9, interactive: false }).addTo(pathLayer);
        }
        // Ordre de passage
        const c = centroid(p.poly), g = toWGS(c[0], c[1]);
        L.marker([g.lat, g.lng], {
          interactive: false,
          icon: L.divIcon({
            className: 'dam-order',
            html: `<div style="--dc:${col}">${k + 1}</div>`,
            iconSize: [26, 26], iconAnchor: [13, 13]
          })
        }).addTo(pathLayer);
      });
    });
    if (depot) {
      L.marker([depot.lat, depot.lng], {
        icon: L.divIcon({ className: 'dam-depot', html: '<div>🏠</div>', iconSize: [30, 30], iconAnchor: [15, 15] })
      }).bindTooltip('Garage / départ').addTo(pathLayer);
    }
  }

  function clearPaths() {
    if (pathLayer) { APP.map.removeLayer(pathLayer); pathLayer = null; }
    result = null;
    renderResults();
  }

  /* ==================================================================
     INTERFACE
     ================================================================== */

  function paramsHtml() {
    const n = (k, label, min, max, stp, unit) => `
      <label class="slider-row"><span>${label}</span><span class="sv" id="dm-${k}">${fmt(params[k], stp < 1 ? 1 : 0)} ${unit}</span>
      <input type="range" min="${min}" max="${max}" step="${stp}" value="${params[k]}"
             oninput="DAMAGE.setParam('${k}',this.value,'${unit}',${stp < 1 ? 1 : 0})"></label>`;
    return `
      <div class="btn-row">
        <button class="btn tiny ${depot ? 'on' : ''}" id="dm-depot" onclick="DAMAGE.pickDepot()">🏠 ${depot ? 'Garage placé' : 'Placer le garage'}</button>
        <label class="inline">Départ <input type="time" id="dm-start" value="${params.start}" onchange="DAMAGE.setStart(this.value)"></label>
      </div>
      ${n('machines', 'Nombre de dameuses', 1, 8, 1, '')}
      ${n('bladeWidth', 'Largeur de travail', 3, 12, 0.1, 'm')}
      ${n('overlap', 'Recouvrement entre passes', 0, 40, 1, '%')}
      ${n('speedUp', 'Vitesse de travail en montée', 3, 20, 0.5, 'km/h')}
      ${n('speedDown', 'Vitesse de travail en descente', 3, 25, 0.5, 'km/h')}
      ${n('speedTransit', 'Vitesse de déplacement à vide', 5, 30, 0.5, 'km/h')}
      ${n('turnTime', 'Durée d’un demi-tour', 5, 90, 1, 's')}
      ${n('margin', 'Majoration (bords, reprises)', 0, 50, 1, '%')}
      ${n('maxSlope', 'Seuil d’alerte de pente (0 = aucun)', 0, 100, 5, '%')}
      <label class="field"><span>Sens des passes</span>
        <select onchange="DAMAGE.setParam('pattern',this.value)">
          <option value="optim" ${params.pattern === 'optim' ? 'selected' : ''}>Optimisé — durée minimale (recommandé)</option>
          <option value="slope" ${params.pattern === 'slope' ? 'selected' : ''}>Ligne de plus grande pente (montée / descente)</option>
          <option value="cross" ${params.pattern === 'cross' ? 'selected' : ''}>Transversal (courbes de niveau)</option>
          <option value="auto" ${params.pattern === 'auto' ? 'selected' : ''}>Axe le plus long (moins de demi-tours)</option>
        </select></label>
      <div class="btn-row">
        <button class="btn accent" onclick="DAMAGE.compute()">▶️ Calculer les parcours</button>
        <button class="btn tiny ghost" onclick="DAMAGE.clearPaths()">🗑️ Effacer</button>
      </div>`;
  }

  function renderPanel() {
    init();
    const el = document.getElementById('damage-params');
    if (el) el.innerHTML = paramsHtml();
    renderPisteList();
    renderResults();
  }

  function renderPisteList() {
    const el = document.getElementById('piste-list'); if (!el) return;
    if (!APP.pistes || !APP.pistes.length) {
      el.innerHTML = `<div class="empty">Aucune piste détectée dans le calque.<br><small>Importez un KMZ de pistes depuis le panneau Données.</small></div>`;
      return;
    }
    const nSel = APP.pistes.filter(p => p.selected).length;
    const totalSel = APP.pistes.filter(p => p.selected).reduce((a, p) => a + p.area, 0);
    el.innerHTML = `
      <div class="btn-row">
        <button class="btn tiny" onclick="DAMAGE.selectAll(true)">Tout cocher</button>
        <button class="btn tiny ghost" onclick="DAMAGE.selectAll(false)">Tout décocher</button>
      </div>
      <div class="note">${nSel} piste(s) sélectionnée(s) — ${fmt(totalSel / 10000, 2)} ha en projection.</div>
      <div class="piste-rows">${APP.pistes.map((p, i) => `
        <div class="piste-row ${p.selected ? 'on' : ''}">
          <label class="chk"><input type="checkbox" ${p.selected ? 'checked' : ''} onchange="DAMAGE.toggle(${p.id})"></label>
          <button class="piste-name" onclick="DAMAGE.rename(${p.id})">${escapeHtml(p.name)}</button>
          <span class="piste-area">${fmt(p.area / 10000, 2)} ha</span>
          <button class="icon-btn" title="Cadrer" onclick="DAMAGE.zoom(${p.id})">🔍</button>
        </div>`).join('')}</div>`;
  }

  function renderResults() {
    const el = document.getElementById('damage-results'); if (!el) return;
    if (!result) { el.innerHTML = `<div class="empty">Sélectionnez des pistes puis lancez le calcul.</div>`; return; }

    const start = parseTime(result.params.start);
    const rows = result.machines.map((m, i) => {
      const col = MACHINE_COLORS[i % MACHINE_COLORS.length];
      return `<div class="mach-card" style="--mc:${col}">
        <div class="mach-head"><b>Dameuse ${i + 1}</b>
          <span>${hms(m.total)} · fin ${clock(start + m.total)}</span></div>
        <div class="mach-sub">${m.pistes.length} piste(s) · travail ${hms(m.work)} · trajets ${hms(m.transitTime)} (${fmt(m.transit / 1000, 1)} km)</div>
        <ol class="mach-list">${m.pistes.map(p => `<li>
          <b>${escapeHtml(p.name)}</b> — ${fmt(p.areaDev / 10000, 2)} ha · ${p.passes} passes ·
          ${fmt(p.work / 1000, 1)} km · ${hms(p.time)}
          <span class="sens">${p.sens}${p.slopeMean ? ` · pente ${fmt(p.slopeMean, 0)} %` : ''}</span>
          ${p.warn ? `<div class="vol-warn">⚠️ ${escapeHtml(p.warn)}</div>` : ''}
        </li>`).join('')}</ol>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="dam-summary">
        <div class="pr-item bal"><span>Fin du damage</span><b>${clock(start + result.longest)}</b><i>${hms(result.longest)}</i></div>
        <div class="pr-item"><span>Surface réelle</span><b>${fmt(result.totalArea / 10000, 2)} ha</b><i>développée</i></div>
        <div class="pr-item"><span>Linéaire travaillé</span><b>${fmt(result.totalWork / 1000, 1)} km</b><i></i></div>
      </div>
      ${rows}
      <div class="btn-row"><button class="btn tiny" onclick="DAMAGE.exportCSV()">📊 Exporter le planning (CSV)</button>
      <button class="btn tiny" onclick="DAMAGE.exportGPX()">🛰️ Parcours en GPX</button></div>
      <p class="note">Modèle géométrique : ni qualité de neige, ni treuil, ni zones interdites.
      Ajustez vitesses et majoration à partir de vos relevés réels pour caler l'outil.</p>`;
  }

  /* --- Actions --- */

  function setParam(k, v, unit, dec) {
    params[k] = (k === 'pattern') ? v : parseFloat(v);
    if (unit !== undefined) { const e = document.getElementById('dm-' + k); if (e) e.textContent = fmt(params[k], dec ?? 0) + ' ' + unit; }
    if (k === 'pattern') renderPanel();
  }
  function setStart(v) { params.start = v; if (result) renderResults(); }

  function pickDepot() {
    toast('Cliquez sur la carte pour placer le garage.', 'info');
    APP.pickingDepot = true;
    APP.map.getContainer().style.cursor = 'crosshair';
  }
  function onMapClick(e) {
    if (!APP.pickingDepot) return false;
    APP.pickingDepot = false;
    APP.map.getContainer().style.cursor = '';
    depot = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (depotMarker) APP.map.removeLayer(depotMarker);
    depotMarker = L.marker([depot.lat, depot.lng], {
      icon: L.divIcon({ className: 'dam-depot', html: '<div>🏠</div>', iconSize: [30, 30], iconAnchor: [15, 15] })
    }).bindTooltip('Garage / départ').addTo(APP.map);
    renderPanel();
    return true;
  }

  function toggle(id) {
    const p = APP.pistes.find(x => x.id === id); if (!p) return;
    p.selected = !p.selected; renderPisteList();
  }
  function selectAll(on) { APP.pistes.forEach(p => p.selected = on); renderPisteList(); }
  function rename(id) {
    const p = APP.pistes.find(x => x.id === id); if (!p) return;
    const n = prompt('Nom de la piste :', p.name);
    if (n && n.trim()) { p.name = n.trim(); renderPisteList(); if (result) { drawPaths(); renderResults(); } }
  }
  function zoom(id) {
    const p = APP.pistes.find(x => x.id === id); if (!p) return;
    APP.map.fitBounds(L.polygon(p.pts).getBounds(), { padding: [40, 40] });
  }

  /* --- Exports --- */

  function exportCSV() {
    if (!result) return toast('Lancez d’abord un calcul.', 'warn');
    const start = parseTime(result.params.start);
    let csv = 'Dameuse;Ordre;Piste;Surface_projetee_ha;Surface_developpee_ha;Pente_moy_pct;Sens_passes;Passes;' +
      'Lineaire_travail_km;Trajets_km;Demi_tours;Duree_h;Debut;Fin\n';
    result.machines.forEach((m, i) => {
      let t = start;
      m.pistes.forEach((p, k) => {
        const t0 = t + (p.transitIn || 0) / Math.max(0.1, result.params.speedTransit / 3.6);
        const t1 = t0 + p.time;
        csv += [i + 1, k + 1, p.name, csvNum(p.areaFlat / 10000, 3), csvNum(p.areaDev / 10000, 3),
          csvNum(p.slopeMean, 1), p.sens, p.passes, csvNum(p.work / 1000, 2), csvNum(p.dead / 1000, 2),
          p.turns, csvNum(p.time / 3600, 2), clock(t0), clock(t1)].join(';') + '\n';
        t = t1;
      });
      csv += `;;TOTAL dameuse ${i + 1};;;;;;;;${csvNum(m.total / 3600, 2)};${clock(start)};${clock(start + m.total)}\n`;
    });
    csv += `\nParametres\n`;
    Object.entries(result.params).forEach(([k, v]) => { csv += `${k};${String(v).replace('.', ',')}\n`; });
    EXPORTS.saveText(csv, `damage_${EXPORTS.stamp()}.csv`, 'text/csv;charset=utf-8');
    toast('Planning de damage exporté.', 'ok');
  }

  function exportGPX() {
    if (!result) return toast('Lancez d’abord un calcul.', 'warn');
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Terrassement SB" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>Parcours de damage</name><time>${new Date().toISOString()}</time></metadata>\n`;
    if (result.depot) gpx += `<wpt lat="${result.depot.lat}" lon="${result.depot.lng}"><name>Garage</name></wpt>\n`;
    result.machines.forEach((m, i) => {
      m.pistes.forEach((p, k) => {
        if (!p.path.pts.length) return;
        gpx += `<trk><name>D${i + 1} — ${k + 1} — ${escapeHtml(p.name)}</name><trkseg>\n`;
        p.path.pts.forEach(q => {
          const g = toWGS(q[0], q[1]);
          const z = getZ(q);
          gpx += `<trkpt lat="${g.lat.toFixed(7)}" lon="${g.lng.toFixed(7)}">${isValidZ(z) ? `<ele>${z.toFixed(1)}</ele>` : ''}</trkpt>\n`;
        });
        gpx += `</trkseg></trk>\n`;
      });
    });
    gpx += '</gpx>';
    EXPORTS.saveText(gpx, `damage_${EXPORTS.stamp()}.gpx`, 'application/gpx+xml');
    toast('Parcours exporté en GPX (GPS embarqué).', 'ok');
  }

  /* --- Utilitaires horaires --- */

  function parseTime(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 : 0;
  }
  function clock(sec) {
    const t = ((sec % 86400) + 86400) % 86400;
    const h = Math.floor(t / 3600), m = Math.round((t % 3600) / 60);
    return `${String(h).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`;
  }
  function hms(sec) {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
  }

  /* --- Sérialisation --- */
  function serialize() {
    return {
      params: { ...params }, depot,
      names: (APP.pistes || []).map(p => ({ name: p.name, selected: p.selected }))
    };
  }
  function restore(o) {
    if (!o) return;
    init();
    if (o.params) params = { ...DEF, ...o.params };
    if (o.depot) {
      depot = o.depot;
      if (depotMarker) APP.map.removeLayer(depotMarker);
      depotMarker = L.marker([depot.lat, depot.lng], {
        icon: L.divIcon({ className: 'dam-depot', html: '<div>🏠</div>', iconSize: [30, 30], iconAnchor: [15, 15] })
      }).bindTooltip('Garage / départ').addTo(APP.map);
    }
    if (o.names && APP.pistes) o.names.forEach((n, i) => { if (APP.pistes[i]) { APP.pistes[i].name = n.name; APP.pistes[i].selected = !!n.selected; } });
    renderPanel();
  }

  return {
    init, renderPanel, renderPisteList, compute, clearPaths, drawPaths,
    setParam, setStart, pickDepot, onMapClick, toggle, selectAll, rename, zoom,
    exportCSV, exportGPX, serialize, restore, buildFromGeoJSON,
    result: () => result
  };
})();

window.DAMAGE = DAMAGE;
