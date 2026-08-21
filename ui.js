/* =====================================================================
   UI — Carte, mise en page responsive, calques, réglages, fenêtres
   ===================================================================== */

'use strict';

/* ---------------- Carte ---------------- */

function initMap() {
  const map = L.map('map', {
    doubleClickZoom: false,
    zoomControl: false,
    preferCanvas: true,
    tap: true
  }).setView([42.7645, 0.5833], 15);
  APP.map = map;

  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, maxNativeZoom: 19, crossOrigin: 'anonymous', attribution: 'Esri, Maxar' }).addTo(map);
  const ign = L.tileLayer('https://data.geopf.fr/wmts?REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    { maxZoom: 19, crossOrigin: 'anonymous', attribution: 'IGN — Géoplateforme' });
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { maxZoom: 17, crossOrigin: 'anonymous', attribution: 'OpenTopoMap (CC-BY-SA)' });
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, crossOrigin: 'anonymous', attribution: '© OpenStreetMap' });

  L.control.layers({
    '🛰️ Satellite (Esri)': sat, '🇫🇷 Ortho IGN': ign,
    '🗻 Topographique': topo, '🗺️ Plan OSM': osm
  }, null, { position: 'topright', collapsed: true }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  map.on('click', e => {
    if (SNOWPARK.onMapClick(e)) return;
    onMapClick(e);
  });

  map.on('mousemove', e => updateReadout(e.latlng));
  map.on('dblclick', () => { if (APP.tool && APP.tool !== 'circle') finalizeDraw(); });

  // Le tactile n'émet pas mousemove : on met à jour la lecture au clic
  map.on('click', e => updateReadout(e.latlng));

  return map;
}

function updateReadout(ll) {
  const l = toL93(ll.lng, ll.lat);
  const z = getZ(l);
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('cur-x', fmt(l[0], 1));
  set('cur-y', fmt(l[1], 1));
  set('cur-z', isValidZ(z) ? fmt(z, 1) : '—');
  set('cur-lat', ll.lat.toFixed(6));
  set('cur-lng', ll.lng.toFixed(6));
}

/* ---------------- Calques statiques ---------------- */

function initStaticLayers() {
  try {
    if (typeof pistesData !== 'undefined' && pistesData.features) {
      const l = L.geoJSON(pistesData, {
        style: { color: '#ffffff', weight: 2, opacity: 0.85, fillOpacity: 0.06, dashArray: '5,5' }
      }).addTo(APP.map);
      APP.layers.push({ id: uid(), name: 'Pistes de ski', layer: l, visible: true, color: '#ffffff' });
      // Le conteneur n'a pas encore sa taille finale au démarrage : on recadre après le layout
      setTimeout(() => { APP.map.invalidateSize(); APP.map.fitBounds(l.getBounds(), { padding: [30, 30] }); }, 320);
    }
    if (typeof canonData !== 'undefined' && canonData.features) {
      const c = L.geoJSON(canonData, {
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 5, fillColor: '#3498db', color: '#fff', weight: 1, fillOpacity: 0.95 })
          .bindTooltip(String(f.properties.Name ?? 'Canon'), { direction: 'top' })
      }).addTo(APP.map);
      APP.layers.push({ id: uid(), name: 'Canons à neige', layer: c, visible: true, color: '#3498db' });
    }
  } catch (e) { console.error(e); }
  renderLayerList();
}

function renderLayerList() {
  const el = document.getElementById('layer-list'); if (!el) return;
  el.innerHTML = APP.layers.map(k => `
    <div class="layer-row" style="--fc:${k.color}">
      <label class="chk"><input type="checkbox" ${k.visible ? 'checked' : ''} onchange="toggleLayer(${k.id})"><span>${escapeHtml(k.name)}</span></label>
      ${k.removable ? `<button class="icon-btn danger" onclick="removeLayer(${k.id})">✕</button>` : ''}
    </div>`).join('');
}
function toggleLayer(id) {
  const k = APP.layers.find(x => x.id === id); if (!k) return;
  k.visible = !k.visible;
  k.visible ? k.layer.addTo(APP.map) : APP.map.removeLayer(k.layer);
}
function removeLayer(id) {
  const k = APP.layers.find(x => x.id === id); if (!k) return;
  APP.map.removeLayer(k.layer);
  APP.layers = APP.layers.filter(x => x.id !== id);
  renderLayerList();
}

/* ---------------- Réglages de cubature ---------------- */

function renderSettings() {
  const s = APP.settings;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  set('set-step', s.gridStep);
  set('set-sub', s.subSample);
  set('set-foi', s.foisonnement);
  set('set-den', s.densite);
  set('set-tas', s.tassement);
}

function applySettings() {
  const num = (id, def) => {
    const v = parseFloat(String(document.getElementById(id).value).replace(',', '.'));
    return Number.isNaN(v) ? def : v;
  };
  const stepEl = document.getElementById('set-step').value;
  APP.settings.gridStep = (stepEl === 'auto' || stepEl === '') ? 'auto' : parseFloat(stepEl);
  APP.settings.subSample = Math.round(num('set-sub', 3));
  APP.settings.foisonnement = num('set-foi', 1.25);
  APP.settings.densite = num('set-den', 1.8);
  APP.settings.tassement = num('set-tas', 0.9);
  renderDrawList();
  toast('Réglages appliqués. Relancez les cubatures pour les recalculer.', 'ok');
}

/** Bascule entre dépôt GitHub, dossier local du site et URL personnalisée. */
function setMntSource(kind) {
  const inp = document.getElementById('set-base');
  if (kind === 'gh') {
    APP.settings.mntBase = 'https://raw.githubusercontent.com/p69gp84gk7-arch/26altlasSB31/main/tif/';
    inp.style.display = 'none';
  } else if (kind === 'local') {
    APP.settings.mntBase = 'tif/';
    inp.style.display = 'none';
  } else {
    inp.style.display = 'block';
    inp.value = APP.settings.mntBase;
    inp.focus();
  }
  toast('Source MNT : ' + APP.settings.mntBase, 'info');
}
function setMntBase(url) {
  if (!url) return;
  APP.settings.mntBase = url.endsWith('/') ? url : url + '/';
  toast('Source MNT : ' + APP.settings.mntBase, 'ok');
}

/* ---------------- Navigation / responsive ---------------- */

function setMode(mode) {
  APP.mode = mode;
  document.body.dataset.mode = mode;
  document.querySelectorAll('[data-mode-btn]').forEach(b => b.classList.toggle('active', b.dataset.modeBtn === mode));
  document.getElementById('panel-terrain').style.display = mode === 'terrain' ? 'block' : 'none';
  document.getElementById('panel-snowpark').style.display = mode === 'snowpark' ? 'block' : 'none';
  cancelDraw(); SNOWPARK.startPlace(null);
  if (mode === 'snowpark') SNOWPARK.renderList();
}

/** Tiroirs latéraux : permanents sur PC, superposés sur mobile. */
function togglePanel(side) {
  const p = document.getElementById(side === 'left' ? 'left-panel' : 'right-panel');
  const open = p.classList.toggle('open');
  if (open) {
    const other = document.getElementById(side === 'left' ? 'right-panel' : 'left-panel');
    if (window.innerWidth < 1000) other.classList.remove('open');
  }
  document.querySelectorAll('[data-panel-btn]').forEach(b =>
    b.classList.toggle('active', b.dataset.panelBtn === side &&
      document.getElementById(b.dataset.panelBtn === 'left' ? 'left-panel' : 'right-panel').classList.contains('open')));
  setTimeout(() => APP.map.invalidateSize(), 260);
}

function closePanels() {
  document.getElementById('left-panel').classList.remove('open');
  document.getElementById('right-panel').classList.remove('open');
  document.querySelectorAll('[data-panel-btn]').forEach(b => b.classList.remove('active'));
  setTimeout(() => APP.map.invalidateSize(), 260);
}

/* ---------------- Fenêtres flottantes (souris + tactile) ---------------- */

function makeDraggable(winId, handleId) {
  const win = document.getElementById(winId);
  const handle = document.getElementById(handleId);
  if (!win || !handle) return;
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button, input, select, a')) return;
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    const r = win.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    win.style.right = 'auto'; win.style.bottom = 'auto';
    win.classList.add('dragging');
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const w = win.offsetWidth, h = win.offsetHeight;
    win.style.left = Math.max(4, Math.min(window.innerWidth - 60, ox + e.clientX - sx)) + 'px';
    win.style.top = Math.max(4, Math.min(window.innerHeight - 40, oy + e.clientY - sy)) + 'px';
  });
  const stop = () => { dragging = false; win.classList.remove('dragging'); };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

/** Agrandit/réduit une fenêtre flottante (indispensable sur mobile). */
function toggleMaximize(winId) {
  const w = document.getElementById(winId);
  w.classList.toggle('maxed');
  w.style.left = w.style.top = w.style.width = w.style.height = '';
  setTimeout(() => {
    if (winId === 'window-3d') VIEW3D.resize();
    else { const c = Chart.getChart(document.getElementById('profileChart')); if (c) c.resize(); }
  }, 200);
}

/* ---------------- Aide ---------------- */

function toggleHelp(on) {
  document.getElementById('help-window').style.display = on ? 'flex' : 'none';
}

/* ---------------- Raccourcis clavier ---------------- */

function initShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') { cancelDraw(); SNOWPARK.startPlace(null); closePanels(); }
    else if (e.key === 'Enter' && APP.tool) { e.preventDefault(); finalizeDraw(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoLastPoint(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); EXPORTS.saveProject(); }
    else if (e.key === 'l' && APP.mode === 'terrain') startTool('line');
    else if (e.key === 's' && APP.mode === 'terrain' && !e.ctrlKey && !e.metaKey) startTool('area');
  });
}

/* ---------------- Démarrage ---------------- */

function boot() {
  initMap();
  initStaticLayers();
  renderMntList();
  renderDrawList();
  renderSettings();
  initShortcuts();
  makeDraggable('profile-window', 'profile-header');
  makeDraggable('window-3d', 'header-3d');
  makeDraggable('help-window', 'help-header');

  // Catalogue MNT
  const sel = document.getElementById('mnt-select');
  if (sel) {
    sel.innerHTML = MNT_CATALOG.map(c => `<option value="${c.file}">${c.label}</option>`).join('');
    sel.value = 'MNT_2019_500_L93.tif';
  }
  // Catalogue snowpark
  const cat = document.getElementById('park-catalog');
  if (cat) cat.innerHTML = SNOWPARK.catalogHtml();

  document.getElementById('mnt-file').addEventListener('change', e => { importLocalMNT(e.target.files); e.target.value = ''; });
  document.getElementById('geo-file').addEventListener('change', e => { for (const f of e.target.files) EXPORTS.importGeoFile(f); e.target.value = ''; });
  document.getElementById('proj-file').addEventListener('change', e => { if (e.target.files[0]) EXPORTS.loadProjectFile(e.target.files[0]); e.target.value = ''; });

  setMode('terrain');
  if (window.innerWidth >= 1000) { document.getElementById('left-panel').classList.add('open'); document.getElementById('right-panel').classList.add('open'); }

  // Sauvegarde locale automatique
  setInterval(() => EXPORTS.autosave(), 45000);
  window.addEventListener('beforeunload', () => EXPORTS.autosave());
  if (EXPORTS.hasAutosave() && EXPORTS.autosaveHasContent()) {
    const t = toast('Une session précédente a été retrouvée.', 'info', 12000);
    const b = document.createElement('button');
    b.className = 'btn tiny'; b.textContent = 'Restaurer';
    b.onclick = () => { EXPORTS.restoreAutosave(); t.remove(); };
    t.appendChild(b);
  }

  // Fermeture du menu export au clic extérieur
  document.addEventListener('pointerdown', e => {
    const m = document.getElementById('export-menu');
    if (m.classList.contains('open') && !e.target.closest('.menu-wrap')) m.classList.remove('open');
  }, true);

  window.addEventListener('resize', () => {
    APP.map.invalidateSize();
    VIEW3D.resize();
    const c = Chart.getChart(document.getElementById('profileChart')); if (c) c.resize();
  });

  console.info('Terrassement SB prêt.');
}

window.initMap = initMap; window.renderLayerList = renderLayerList;
window.toggleLayer = toggleLayer; window.removeLayer = removeLayer;
window.renderSettings = renderSettings; window.applySettings = applySettings;
window.setMntSource = setMntSource; window.setMntBase = setMntBase;
window.setMode = setMode; window.togglePanel = togglePanel; window.closePanels = closePanels;
window.toggleMaximize = toggleMaximize; window.toggleHelp = toggleHelp;
window.boot = boot;
