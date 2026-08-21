/* =====================================================================
   DRAW — Outils de tracé, édition des sommets, fiches de mesure
   ===================================================================== */

'use strict';

let tmpLayer = null, tmpPts = [], circleCenter = null;
let addPointTarget = null;

/* ---------------- Cycle de tracé ---------------- */

function startTool(tool) {
  if (APP.tool === tool) { cancelDraw(); return; }
  cancelDraw();
  APP.tool = tool;
  tmpPts = []; circleCenter = null;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  showDrawBar(true);
  const help = {
    line: 'Cliquez pour placer les points de la ligne, puis « Terminer ».',
    area: 'Cliquez pour délimiter la surface (3 points minimum), puis « Terminer ».',
    circle: 'Cliquez au centre, puis une seconde fois pour fixer le rayon.',
    point: 'Cliquez pour placer un point coté.'
  }[tool];
  setDrawHint(help);
  APP.map.getContainer().style.cursor = 'crosshair';
}

function cancelDraw() {
  APP.tool = null; tmpPts = []; circleCenter = null; addPointTarget = null;
  if (tmpLayer) { APP.map.removeLayer(tmpLayer); tmpLayer = null; }
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
  showDrawBar(false);
  APP.map.getContainer().style.cursor = '';
}

function undoLastPoint() {
  if (!APP.tool || !tmpPts.length) return;
  tmpPts.pop();
  redrawTemp();
  setDrawHint(`${tmpPts.length} point(s) placé(s).`);
}

function showDrawBar(on) {
  const bar = document.getElementById('draw-bar');
  if (bar) bar.style.display = on ? 'flex' : 'none';
}
function setDrawHint(t) {
  const el = document.getElementById('draw-hint');
  if (el) el.textContent = t || '';
}

function redrawTemp() {
  if (tmpLayer) { APP.map.removeLayer(tmpLayer); tmpLayer = null; }
  if (!tmpPts.length) return;
  const opts = { color: APP.tool === 'area' ? '#e67e22' : '#3498db', weight: 3, fillOpacity: 0.25 };
  tmpLayer = (APP.tool === 'area' && tmpPts.length > 2)
    ? L.polygon(tmpPts, opts).addTo(APP.map)
    : L.polyline(tmpPts, opts).addTo(APP.map);
}

function onMapClick(e) {
  // Mode « ajouter un sommet » à un tracé existant
  if (addPointTarget) {
    const d = addPointTarget;
    d.ptsGPS.push({ lat: e.latlng.lat, lng: e.latlng.lng });
    addPointTarget = null;
    setDrawHint('');
    showDrawBar(false);
    redrawFeature(d); makeEditable(d); refreshStats(d); renderDrawList();
    return;
  }
  if (!APP.tool) return;

  if (APP.tool === 'point') {
    finalizePoint(e.latlng); return;
  }
  if (APP.tool === 'circle') {
    if (!circleCenter) {
      circleCenter = e.latlng;
      tmpLayer = L.circle(circleCenter, { radius: 1, color: '#9b59b6', weight: 3, fillOpacity: 0.25 }).addTo(APP.map);
      setDrawHint('Déplacez puis cliquez pour fixer le rayon.');
    } else {
      finalizeCircle(circleCenter, APP.map.distance(circleCenter, e.latlng));
    }
    return;
  }
  tmpPts.push({ lat: e.latlng.lat, lng: e.latlng.lng });
  redrawTemp();
  setDrawHint(`${tmpPts.length} point(s) — « Terminer » pour valider.`);
}

function finalizeDraw() {
  if (!APP.tool) return;
  if (APP.tool === 'circle') { cancelDraw(); return; }
  const min = APP.tool === 'area' ? 3 : 2;
  if (tmpPts.length < min) { toast(`Il faut au moins ${min} points.`, 'warn'); return; }

  const type = APP.tool;
  const d = newFeature({
    type,
    name: type === 'area' ? `Surface ${countOf('area') + 1}` : `Ligne ${countOf('line') + 1}`,
    ptsGPS: tmpPts.map(p => ({ lat: p.lat, lng: p.lng })),
    color: type === 'area' ? '#e67e22' : '#3498db'
  });
  cancelDraw();
  APP.draws.unshift(d);
  redrawFeature(d); refreshStats(d); renderDrawList();
  if (type === 'line') PROFILE.open(d);
}

function finalizeCircle(center, radius) {
  if (radius < 0.5) { cancelDraw(); toast('Rayon trop faible.', 'warn'); return; }
  const cL93 = toL93(center.lng, center.lat);
  const poly = GEOM.circlePolygonL93(cL93, radius);
  const d = newFeature({
    type: 'circle',
    name: `Cercle ${countOf('circle') + 1}`,
    center: { lat: center.lat, lng: center.lng },
    radius,
    ptsGPS: poly.map(p => { const g = toWGS(p[0], p[1]); return { lat: g.lat, lng: g.lng }; }),
    color: '#9b59b6'
  });
  cancelDraw();
  APP.draws.unshift(d);
  redrawFeature(d); refreshStats(d); renderDrawList();
}

function finalizePoint(latlng) {
  const d = newFeature({
    type: 'point',
    name: `Point ${countOf('point') + 1}`,
    ptsGPS: [{ lat: latlng.lat, lng: latlng.lng }],
    color: '#f1c40f'
  });
  cancelDraw();
  APP.draws.unshift(d);
  redrawFeature(d); refreshStats(d); renderDrawList();
}

function countOf(type) { return APP.draws.filter(d => d.type === type).length; }

function newFeature(o) {
  return Object.assign({
    id: uid(), visible: true, isEditing: false, weight: 3,
    volumes: [], projectPts: [], stats: null,
    editGroup: L.layerGroup().addTo(APP.map)
  }, o);
}

/* ---------------- Rendu carte ---------------- */

function redrawFeature(d) {
  if (d.layer) { APP.map.removeLayer(d.layer); d.layer = null; }
  if (!d.visible) return;
  const st = { color: d.color, weight: d.weight || 3, fillOpacity: 0.25, fillColor: d.color };
  if (d.type === 'point') {
    d.layer = L.circleMarker(d.ptsGPS[0], { radius: 7, color: '#fff', weight: 2, fillColor: d.color, fillOpacity: 1 });
  } else if (d.type === 'circle' || d.type === 'area') {
    d.layer = L.polygon(d.ptsGPS, st);
  } else {
    d.layer = L.polyline(d.ptsGPS, { color: d.color, weight: (d.weight || 3) + 1 });
  }
  d.layer.addTo(APP.map);
  d.layer.on('click', () => selectFeature(d.id));
  if (d.name) d.layer.bindTooltip(d.name, { sticky: true });
}

function selectFeature(id) {
  const card = document.getElementById('feat-' + id);
  if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1200); }
}

/* ---------------- Statistiques ---------------- */

function refreshStats(d) {
  d.stats = GEOM.measure(d);
  const el = document.getElementById('stats-' + d.id);
  if (el) el.innerHTML = statsHtml(d);
}

function refreshAllStats() {
  allFeatures().forEach(refreshStats);
  renderDrawList();
  if (window.SNOWPARK) SNOWPARK.refreshAll();
}

function allFeatures() {
  return [...APP.draws, ...APP.projects.flatMap(p => p.features)];
}
function findFeature(id) { return allFeatures().find(f => f.id === id); }

function statsHtml(d) {
  const s = d.stats || GEOM.measure(d);
  const rows = [];
  const zRange = (s.zMin !== null)
    ? `${fmt(s.zMin)} → ${fmt(s.zMax)} m <small>(ΔZ ${fmt(s.zMax - s.zMin)} m)</small>` : '—';

  if (d.type === 'point') {
    const l = toL93(d.ptsGPS[0].lng, d.ptsGPS[0].lat);
    rows.push(['X / Y (L93)', `${fmt(l[0])} / ${fmt(l[1])}`]);
    rows.push(['Altitude', s.zMin !== null ? fmtM(s.zMin) : '— (hors MNT)']);
  } else if (d.type === 'line') {
    rows.push(['Longueur horizontale', fmtM(s.length2D)]);
    rows.push(['Longueur développée (3D)', fmtM(s.length3D)]);
    rows.push(['Z départ → arrivée', s.zStart !== null ? `${fmt(s.zStart)} → ${fmt(s.zEnd)} m` : '—']);
    rows.push(['Dénivelé', s.deltaZ !== null ? `${s.deltaZ >= 0 ? '+' : ''}${fmt(s.deltaZ)} m` : '—']);
    rows.push(['Montée / descente cumulées', `+${fmt(s.climb)} / −${fmt(s.drop)} m`]);
    rows.push(['Pente moyenne', s.slopeMean !== null ? `${fmt(s.slopeMean, 1)} %` : '—']);
    rows.push(['Pente maxi (segment)', s.slopeMax !== null ? `${fmt(s.slopeMax, 1)} %` : '—']);
    rows.push(['Altitudes', zRange]);
  } else {
    if (d.type === 'circle') rows.push(['Rayon', fmtM(d.radius)]);
    rows.push(['Périmètre', fmtM(s.perimeter2D)]);
    rows.push(['Surface horizontale', fmtM2(s.areaH)]);
    rows.push(['Surface développée', `${fmtM2(s.areaDev)} <small>(+${fmt(s.areaH > 0 ? (s.areaDev / s.areaH - 1) * 100 : 0, 1)} %)</small>`]);
    rows.push(['Altitudes du contour', zRange]);
  }
  rows.push(['Sommets · source Z', `${s.nPts} · ${s.zSource}`]);

  let html = '<table class="stat-tbl">' +
    rows.map(r => `<tr><th>${r[0]}</th><td>${r[1]}</td></tr>`).join('') + '</table>';

  if (d.volumes && d.volumes.length) {
    html += `<div class="vol-list">
      <div class="vol-list-head"><b>Cubatures</b><button class="btn tiny ghost" onclick="clearVolumes(${d.id})">Tout effacer</button></div>
      ${d.volumes.map((v, i) => VOL.volumeCardHtml(v, d.id, i)).join('')}
    </div>`;
  }
  return html;
}

/* ---------------- Édition des sommets ---------------- */

function toggleEditMode(id) {
  const d = findFeature(id); if (!d) return;
  if (d.type === 'point') return;
  d.isEditing = !d.isEditing;
  if (d.isEditing) makeEditable(d); else { d.editGroup.clearLayers(); addPointTarget = null; }
  renderDrawList();
}

function makeEditable(d) {
  if (!d.editGroup) d.editGroup = L.layerGroup().addTo(APP.map);
  d.editGroup.clearLayers();
  if (!d.isEditing) return;

  // Un cercle s'édite par son centre et son rayon, pas par ses 180 sommets
  if (d.type === 'circle') {
    const c = L.marker(d.center, { draggable: true, icon: handleIcon('C', '#9b59b6') }).addTo(d.editGroup);
    c.on('drag', ev => {
      d.center = { lat: ev.latlng.lat, lng: ev.latlng.lng };
      rebuildCircle(d);
    });
    c.on('dragend', () => { refreshStats(d); renderDrawList(); });
    return;
  }

  d.ptsGPS.forEach((pt, i) => {
    const m = L.marker(pt, { draggable: true, icon: handleIcon(i + 1) }).addTo(d.editGroup);
    m.on('drag', ev => {
      d.ptsGPS[i].lat = ev.latlng.lat; d.ptsGPS[i].lng = ev.latlng.lng;
      if (d.layer && d.layer.setLatLngs) d.layer.setLatLngs(d.ptsGPS);
      const msg = [];
      if (i > 0) msg.push(`← ${fmt(APP.map.distance(d.ptsGPS[i - 1], ev.latlng), 1)} m`);
      if (i < d.ptsGPS.length - 1) msg.push(`→ ${fmt(APP.map.distance(ev.latlng, d.ptsGPS[i + 1]), 1)} m`);
      m.bindTooltip(msg.join('  '), { permanent: true, direction: 'top', offset: [0, -12] }).openTooltip();
      refreshStats(d);
    });
    m.on('dragend', () => { m.unbindTooltip(); refreshStats(d); renderDrawList(); if (PROFILE.isOpenFor(d)) PROFILE.open(d); });
    m.on('contextmenu', () => removeVertex(d, i));
  });
}

function handleIcon(label, color = '#e74c3c') {
  return L.divIcon({
    className: 'vertex-handle',
    html: `<div style="--hc:${color}">${label}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 13]
  });
}

function rebuildCircle(d) {
  const cL93 = toL93(d.center.lng, d.center.lat);
  const poly = GEOM.circlePolygonL93(cL93, d.radius);
  d.ptsGPS = poly.map(p => { const g = toWGS(p[0], p[1]); return { lat: g.lat, lng: g.lng }; });
  if (d.layer && d.layer.setLatLngs) d.layer.setLatLngs(d.ptsGPS);
}

function setCircleRadius(id, r) {
  const d = findFeature(id); if (!d || d.type !== 'circle') return;
  d.radius = Math.max(0.5, Number(r) || 0.5);
  rebuildCircle(d); refreshStats(d);
  const lbl = document.getElementById('rad-lbl-' + id); if (lbl) lbl.textContent = fmt(d.radius, 1) + ' m';
}

function removeVertex(d, i) {
  const min = d.type === 'area' ? 3 : 2;
  if (d.ptsGPS.length <= min) { toast(`Un ${d.type === 'area' ? 'polygone' : 'tracé'} doit garder ${min} sommets.`, 'warn'); return; }
  d.ptsGPS.splice(i, 1);
  redrawFeature(d); makeEditable(d); refreshStats(d); renderDrawList();
}

function activateAddPoint(id) {
  const d = findFeature(id); if (!d) return;
  addPointTarget = d;
  showDrawBar(true);
  setDrawHint('Cliquez sur la carte pour ajouter un sommet en fin de tracé.');
}

/** Saisie numérique X / Y / Z depuis le tableau d'édition */
function applyVertexEdit(id, i) {
  const d = findFeature(id); if (!d) return;
  const gx = document.getElementById(`ed-x-${id}-${i}`);
  const gy = document.getElementById(`ed-y-${id}-${i}`);
  const gz = document.getElementById(`ed-z-${id}-${i}`);
  const x = parseFloat((gx.value || '').replace(',', '.'));
  const y = parseFloat((gy.value || '').replace(',', '.'));
  if (!Number.isNaN(x) && !Number.isNaN(y)) {
    const g = toWGS(x, y);
    d.ptsGPS[i].lat = g.lat; d.ptsGPS[i].lng = g.lng;
  }
  const zs = (gz.value || '').trim().replace(',', '.');
  if (zs === '') delete d.ptsGPS[i].customZ;
  else { const z = parseFloat(zs); if (!Number.isNaN(z)) d.ptsGPS[i].customZ = z; }

  if (d.layer && d.layer.setLatLngs) d.layer.setLatLngs(d.ptsGPS);
  makeEditable(d); refreshStats(d);
  if (PROFILE.isOpenFor(d)) PROFILE.open(d);
}

/** Applique une même altitude forcée à tous les sommets (plateforme). */
function setAllZ(id) {
  const d = findFeature(id); if (!d) return;
  const cur = d.stats && d.stats.zMin !== null ? Math.round(d.stats.zMin) : '';
  const v = prompt('Altitude forcée pour TOUS les sommets (vide = revenir au terrain naturel) :', cur);
  if (v === null) return;
  const s = v.trim().replace(',', '.');
  d.ptsGPS.forEach(p => { if (s === '') delete p.customZ; else p.customZ = parseFloat(s); });
  refreshStats(d); renderDrawList();
  if (PROFILE.isOpenFor(d)) PROFILE.open(d);
}

function vertexTable(d) {
  if (!d.isEditing || d.type === 'circle' || d.type === 'point') return '';
  const rows = d.ptsGPS.map((pt, i) => {
    const l = toL93(pt.lng, pt.lat);
    const zAuto = getZ(l);
    const zVal = pt.customZ !== undefined ? pt.customZ.toFixed(2) : '';
    const zPh = isValidZ(zAuto) ? zAuto.toFixed(2) : 'hors MNT';
    return `<tr>
      <td class="idx">${i + 1}</td>
      <td><input inputmode="decimal" id="ed-x-${d.id}-${i}" value="${l[0].toFixed(2)}" onchange="applyVertexEdit(${d.id},${i})"></td>
      <td><input inputmode="decimal" id="ed-y-${d.id}-${i}" value="${l[1].toFixed(2)}" onchange="applyVertexEdit(${d.id},${i})"></td>
      <td><input inputmode="decimal" class="zin" id="ed-z-${d.id}-${i}" value="${zVal}" placeholder="${zPh}" onchange="applyVertexEdit(${d.id},${i})"></td>
      <td><button class="icon-btn" title="Supprimer ce sommet" onclick="removeVertexById(${d.id},${i})">✕</button></td>
    </tr>`;
  }).join('');
  return `<div class="vtx-wrap">
    <table class="vtx-tbl"><thead><tr><th>N°</th><th>X (L93)</th><th>Y (L93)</th><th>Z forcé</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="hint">Z vide = altitude du terrain naturel (MNT). Une valeur saisie force la cote du projet.</div>
  </div>`;
}

function removeVertexById(id, i) { const d = findFeature(id); if (d) removeVertex(d, i); }

/* ---------------- Liste des tracés ---------------- */

function renderDrawList() {
  const el = document.getElementById('draw-list');
  if (!el) return;
  if (!APP.draws.length) {
    el.innerHTML = `<div class="empty">Aucun tracé.<br><small>Choisissez un outil ci-dessus pour commencer.</small></div>`;
  } else {
    el.innerHTML = APP.draws.map(d => featureCard(d)).join('');
  }
  renderProjectList();
}

function featureCard(d, projId = null) {
  const isSurface = d.type === 'area' || d.type === 'circle';
  const tools = d.type === 'point' ? '' : (isSurface ? `
    <div class="btn-row">
      <button class="btn tiny cut" onclick="askVolume(${d.id},'flat')" title="Volume par rapport à une plateforme horizontale">📐 Plateforme</button>
      <button class="btn tiny plane" onclick="askVolume(${d.id},'plane')" title="Volume par rapport au plan de facettes passant par le contour">📏 Plan</button>
      <button class="btn tiny smooth" onclick="askVolume(${d.id},'smooth')" title="Volume par rapport à une surface souple raccordant le contour">📐 Courbe</button>
      <button class="btn tiny v3d" onclick="VIEW3D.open(${d.id})">🧊 Vue 3D</button>
    </div>` : `
    <div class="btn-row">
      <button class="btn tiny" onclick="PROFILE.openById(${d.id})">📈 Profil en long</button>
      <button class="btn tiny" onclick="EXPORTS.featureCSV(${d.id})">💾 Points CSV</button>
    </div>`);

  const editExtra = d.isEditing ? `
    <div class="btn-row">
      <button class="btn tiny" onclick="activateAddPoint(${d.id})">➕ Sommet</button>
      <button class="btn tiny" onclick="setAllZ(${d.id})">⇅ Z global</button>
    </div>` : '';

  const circleCtl = (d.type === 'circle' && d.isEditing) ? `
    <label class="slider-row">Rayon <span id="rad-lbl-${d.id}">${fmt(d.radius, 1)} m</span>
      <input type="range" min="1" max="300" step="0.5" value="${d.radius}" oninput="setCircleRadius(${d.id}, this.value)">
    </label>` : '';

  return `<div class="card feat-card" id="feat-${d.id}" style="--fc:${d.color}">
    <div class="card-head">
      <label class="chk"><input type="checkbox" ${d.visible ? 'checked' : ''} onchange="toggleFeature(${d.id})"></label>
      <input type="color" class="swatch" value="${d.color}" onchange="setFeatureColor(${d.id}, this.value)" title="Couleur">
      <button class="feat-name" onclick="renameFeature(${d.id})" title="Renommer">${escapeHtml(d.name)}</button>
      <span class="tag">${typeLabel(d.type)}</span>
      <button class="icon-btn" title="Zoomer" onclick="zoomFeature(${d.id})">🔍</button>
      <button class="icon-btn danger" title="Supprimer" onclick="deleteFeature(${d.id})">✕</button>
    </div>
    <div class="stats" id="stats-${d.id}">${statsHtml(d)}</div>
    ${d.type === 'point' ? '' : `<button class="btn tiny ${d.isEditing ? 'on' : ''}" onclick="toggleEditMode(${d.id})">${d.isEditing ? '✅ Terminer l’édition' : '✏️ Éditer les sommets'}</button>`}
    ${circleCtl}${editExtra}${vertexTable(d)}${tools}
  </div>`;
}

function typeLabel(t) {
  return { line: 'ligne', area: 'surface', circle: 'cercle', point: 'point' }[t] || t;
}

function toggleFeature(id) {
  const d = findFeature(id); if (!d) return;
  d.visible = !d.visible;
  if (d.visible) redrawFeature(d);
  else { if (d.layer) APP.map.removeLayer(d.layer); if (d.editGroup) d.editGroup.clearLayers(); }
}

function setFeatureColor(id, c) {
  const d = findFeature(id); if (!d) return;
  d.color = c;
  if (d.layer && d.layer.setStyle) d.layer.setStyle({ color: c, fillColor: c });
  const card = document.getElementById('feat-' + id); if (card) card.style.setProperty('--fc', c);
}

function renameFeature(id) {
  const d = findFeature(id); if (!d) return;
  const n = prompt('Nom du tracé :', d.name);
  if (n && n.trim()) { d.name = n.trim(); redrawFeature(d); renderDrawList(); }
}

function zoomFeature(id) {
  const d = findFeature(id); if (!d || !d.layer) return;
  if (d.type === 'point') APP.map.setView(d.ptsGPS[0], 19);
  else APP.map.fitBounds(d.layer.getBounds(), { padding: [40, 40] });
}

function deleteFeature(id) {
  const d = findFeature(id); if (!d) return;
  if (!confirm(`Supprimer « ${d.name} » ?`)) return;
  if (d.layer) APP.map.removeLayer(d.layer);
  if (d.editGroup) APP.map.removeLayer(d.editGroup);
  APP.draws = APP.draws.filter(x => x.id !== id);
  APP.projects.forEach(p => { p.features = p.features.filter(x => x.id !== id); });
  renderDrawList();
}

/* ---------------- Cubatures ---------------- */

async function askVolume(id, mode) {
  const d = findFeature(id); if (!d) return;
  if (!hasMNT()) { toast('Activez au moins un MNT pour calculer un volume.', 'warn'); return; }

  const opts = { subSample: APP.settings.subSample, step: APP.settings.gridStep };
  if (mode === 'flat') {
    const def = d.stats && d.stats.zMin !== null ? Math.round((d.stats.zMin + d.stats.zMax) / 2) : '';
    const v = prompt('Altitude de la plateforme projet (m NGF) :', def);
    if (v === null) return;
    opts.refZ = parseFloat(String(v).replace(',', '.'));
    if (Number.isNaN(opts.refZ)) { toast('Altitude invalide.', 'err'); return; }
  }

  await busy(true, 'Cubature en cours…');
  try {
    const r = VOL.computeVolume(d, mode, opts);
    if (r.error) { toast(r.error, 'err'); return; }
    d.volumes.unshift(r);
    refreshStats(d); renderDrawList();
    toast(`Déblai ${fmtM3(r.cut)} · Remblai ${fmtM3(r.fill)}`, 'ok', 5000);
  } finally { await busy(false); }
}

function removeVolume(id, idx) {
  const d = findFeature(id); if (!d) return;
  d.volumes.splice(idx, 1); refreshStats(d); renderDrawList();
}
function clearVolumes(id) {
  const d = findFeature(id); if (!d) return;
  d.volumes = []; refreshStats(d); renderDrawList();
}

/* ---------------- Projets chargés (colonne gauche) ---------------- */

function renderProjectList() {
  const el = document.getElementById('project-list');
  if (!el) return;
  if (!APP.projects.length) {
    el.innerHTML = `<div class="empty">Aucun projet chargé.<br><small>Utilisez « Ouvrir un projet » pour recharger un fichier .terra.json.</small></div>`;
    return;
  }
  el.innerHTML = APP.projects.map(p => `
    <div class="card proj-card">
      <div class="card-head">
        <label class="chk"><input type="checkbox" ${p.visible ? 'checked' : ''} onchange="toggleProject(${p.id})"></label>
        <b>📁 ${escapeHtml(p.name)}</b>
        <span class="tag">${p.features.length}</span>
        <button class="icon-btn" title="Copier dans l’espace de travail" onclick="copyProjectToWorkspace(${p.id})">📥</button>
        <button class="icon-btn danger" onclick="deleteProject(${p.id})">✕</button>
      </div>
      <details><summary>Détail des tracés</summary>
        ${p.features.map(f => featureCard(f, p.id)).join('')}
      </details>
    </div>`).join('');
}

function toggleProject(pid) {
  const p = APP.projects.find(x => x.id === pid); if (!p) return;
  p.visible = !p.visible;
  p.features.forEach(f => { f.visible = p.visible; if (f.visible) redrawFeature(f); else if (f.layer) APP.map.removeLayer(f.layer); });
  renderProjectList();
}

function deleteProject(pid) {
  const p = APP.projects.find(x => x.id === pid); if (!p) return;
  if (!confirm(`Supprimer le projet « ${p.name} » de la session ?`)) return;
  p.features.forEach(f => { if (f.layer) APP.map.removeLayer(f.layer); if (f.editGroup) APP.map.removeLayer(f.editGroup); });
  APP.projects = APP.projects.filter(x => x.id !== pid);
  renderProjectList();
}

function copyProjectToWorkspace(pid) {
  const p = APP.projects.find(x => x.id === pid); if (!p) return;
  p.features.forEach(f => {
    const c = newFeature({
      type: f.type, name: f.name + ' (copie)', color: f.color,
      ptsGPS: f.ptsGPS.map(pt => ({ ...pt })),
      center: f.center ? { ...f.center } : undefined, radius: f.radius
    });
    c.projectPts = (f.projectPts || []).map(x => ({ ...x }));
    APP.draws.unshift(c); redrawFeature(c); refreshStats(c);
  });
  renderDrawList();
  toast(`Projet « ${p.name} » copié dans l’espace de travail.`, 'ok');
}

window.startTool = startTool; window.cancelDraw = cancelDraw; window.finalizeDraw = finalizeDraw;
window.undoLastPoint = undoLastPoint; window.onMapClick = onMapClick;
window.toggleEditMode = toggleEditMode; window.makeEditable = makeEditable;
window.applyVertexEdit = applyVertexEdit; window.removeVertexById = removeVertexById;
window.activateAddPoint = activateAddPoint; window.setAllZ = setAllZ;
window.setCircleRadius = setCircleRadius;
window.toggleFeature = toggleFeature; window.setFeatureColor = setFeatureColor;
window.renameFeature = renameFeature; window.zoomFeature = zoomFeature; window.deleteFeature = deleteFeature;
window.askVolume = askVolume; window.removeVolume = removeVolume; window.clearVolumes = clearVolumes;
window.renderDrawList = renderDrawList; window.renderProjectList = renderProjectList;
window.refreshStats = refreshStats; window.refreshAllStats = refreshAllStats;
window.allFeatures = allFeatures; window.findFeature = findFeature;
window.redrawFeature = redrawFeature; window.newFeature = newFeature;
window.toggleProject = toggleProject; window.deleteProject = deleteProject;
window.copyProjectToWorkspace = copyProjectToWorkspace;
window.selectFeature = selectFeature; window.statsHtml = statsHtml;
