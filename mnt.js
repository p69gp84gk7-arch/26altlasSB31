/* =====================================================================
   MNT — Chargement des dalles altimétriques (GitHub ou fichier local)
   =====================================================================
   Les dalles du dépôt sont des GeoTIFF Lambert-93, entiers 16 bits,
   NoData = -32767 :
      • MNT_2019_100_… → pas de 1,00 m   (dalle 1 km × 1 km)
      • MNT_2019_500_… → pas de 5,00 m
   La quantification verticale du MNT est ENTIÈRE (1 m). C'est une limite
   de la donnée source, pas du calcul : elle est affichée explicitement et
   propagée sous forme d'incertitude sur les cubatures, au lieu d'être
   masquée derrière des résultats au centimètre près.
   ===================================================================== */

'use strict';

/* Dalles disponibles dans le dossier /tif du dépôt GitHub */
const MNT_CATALOG = [
  // pas 1 m
  ...['498_6188', '498_6189', '498_6190', '499_6188', '499_6189', '499_6190',
    '500_6188', '500_6189', '500_6190', '501_6188', '501_6189', '501_6190',
    '501_6191', '502_6187', '502_6188', '502_6189', '502_6190', '502_6191']
    .map(t => ({ file: `MNT_2019_100_${t}_L93.tif`, res: 1, tile: t, label: `Dalle ${t.replace('_', ' / ')} — 1 m` })),
  { file: 'MNT_2019_100_L93.tif', res: 1, tile: null, label: 'Secteur complet — 1 m (10 Mo)' },
  // pas 5 m
  ...['498_6188', '498_6189', '498_6190', '499_6188', '499_6189', '499_6190',
    '500_6188', '500_6189', '500_6190', '501_6188', '501_6189', '501_6190',
    '501_6191', '502_6187', '502_6188', '502_6189', '502_6190', '502_6191']
    .map(t => ({ file: `MNT_2019_500_${t}_L93.tif`, res: 5, tile: t, label: `Dalle ${t.replace('_', ' / ')} — 5 m` })),
  { file: 'MNT_2019_500_L93.tif', res: 5, tile: null, label: 'Secteur complet — 5 m (0,6 Mo)' }
];

/* ---------------------------------------------------------------- */

async function readGeoTIFF(source, name) {
  const tiff = typeof source === 'string'
    ? await GeoTIFF.fromArrayBuffer(await (await fetch(source)).arrayBuffer())
    : await GeoTIFF.fromArrayBuffer(source);

  const img = await tiff.getImage();
  const bbox = img.getBoundingBox();          // [minX, minY, maxX, maxY] en L93
  const width = img.getWidth(), height = img.getHeight();
  const raster = (await img.readRasters())[0];

  // NoData : tag GDAL_NODATA (42113)
  let nodata = null;
  const fd = img.getFileDirectory();
  if (fd.GDAL_NODATA !== undefined) nodata = parseFloat(fd.GDAL_NODATA);

  // Quantification verticale : type entier ⇒ marches de 1 m
  const isInt = !(raster instanceof Float32Array || raster instanceof Float64Array);

  const resX = (bbox[2] - bbox[0]) / width;
  const resY = (bbox[3] - bbox[1]) / height;

  // Statistiques utiles (min/max réels, taux de couverture)
  let zMin = Infinity, zMax = -Infinity, valid = 0;
  for (let i = 0; i < raster.length; i++) {
    const v = raster[i];
    if (v === nodata || !isValidZ(v)) continue;
    valid++;
    if (v < zMin) zMin = v; if (v > zMax) zMax = v;
  }

  return {
    id: uid(), name, bbox, width, height, data: raster, nodata,
    resolution: Math.max(resX, resY),
    quantum: isInt ? 1 : 0,
    zMin: valid ? zMin : null, zMax: valid ? zMax : null,
    coverage: valid / raster.length,
    visible: true, showRaster: false, overlay: null, footprint: null
  };
}

function registerMNT(m) {
  // Emprise sur la carte
  const sw = toWGS(m.bbox[0], m.bbox[1]), ne = toWGS(m.bbox[2], m.bbox[3]);
  m.bounds = [[sw.lat, sw.lng], [ne.lat, ne.lng]];
  m.footprint = L.rectangle(m.bounds, {
    color: '#00d1b2', weight: 1, fill: false, dashArray: '4,4', interactive: false
  }).addTo(APP.map);
  APP.mnt.push(m);
  renderMntList();
  refreshAllStats();
  return m;
}

/** Chargement d'une dalle depuis le dépôt GitHub */
async function loadRemoteMNT(file, label) {
  const url = APP.settings.mntBase + file;
  if (APP.mnt.some(m => m.name === (label || file))) { toast('Cette dalle est déjà chargée.', 'warn'); return; }
  await busy(true, `Téléchargement ${file}…`);
  try {
    const m = await readGeoTIFF(url, label || file);
    registerMNT(m);
    if (APP.mnt.length === 1) APP.map.fitBounds(m.bounds);
    toast(`MNT chargé : ${m.name} (${fmt(m.resolution, 2)} m, ${fmt(m.coverage * 100, 0)} % couvert)`, 'ok');
  } catch (e) {
    console.error(e);
    toast("Impossible de charger cette dalle (réseau ou fichier invalide).", 'err');
  } finally { await busy(false); }
}

/** Import de fichiers .tif locaux (l'ancienne version avait le champ, sans code derrière) */
async function importLocalMNT(files) {
  if (!files || !files.length) return;
  await busy(true, 'Lecture des fichiers…');
  let ok = 0;
  for (const f of files) {
    try {
      const m = await readGeoTIFF(await f.arrayBuffer(), f.name);
      registerMNT(m); ok++;
    } catch (e) { console.error(e); toast(`Fichier illisible : ${f.name}`, 'err'); }
  }
  await busy(false);
  if (ok) {
    toast(`${ok} MNT importé(s).`, 'ok');
    APP.map.fitBounds(APP.mnt[APP.mnt.length - 1].bounds);
  }
}

/** Charge automatiquement les dalles couvrant la vue courante */
async function loadMNTForView(res = 1) {
  const b = APP.map.getBounds();
  const sw = toL93(b.getWest(), b.getSouth());
  const ne = toL93(b.getEast(), b.getNorth());
  const wanted = MNT_CATALOG.filter(c => {
    if (c.res !== res || !c.tile) return false;
    const [kx, ky] = c.tile.split('_').map(Number);
    // Une dalle « kx_ky » couvre [kx km, kx+1 km] × [ky-1 km, ky km]
    const x0 = kx * 1000, x1 = x0 + 1000, y1 = ky * 1000, y0 = y1 - 1000;
    return !(x1 < sw[0] || x0 > ne[0] || y1 < sw[1] || y0 > ne[1]);
  });
  if (!wanted.length) { toast('Aucune dalle du dépôt ne couvre cette zone.', 'warn'); return; }
  const todo = wanted.filter(c => !APP.mnt.some(m => m.name === c.label));
  if (!todo.length) { toast('Les dalles de cette zone sont déjà chargées.', 'info'); return; }
  if (todo.length > 6 && !confirm(`${todo.length} dalles à télécharger. Continuer ?`)) return;
  for (const c of todo) await loadRemoteMNT(c.file, c.label);
}

/* ---------------- Rendu du MNT sur la carte ---------------- */

/**
 * Superpose la dalle sous forme d'image (teintes hypsométriques + ombrage).
 * Utile pour vérifier visuellement l'emprise réelle et les trous de donnée.
 */
function buildRasterOverlay(m) {
  const cv = document.createElement('canvas');
  cv.width = m.width; cv.height = m.height;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(m.width, m.height);
  const zMin = m.zMin ?? 0, zMax = m.zMax ?? 1;
  const span = Math.max(1, zMax - zMin);
  const res = m.resolution;

  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      const i = y * m.width + x;
      const v = m.data[i];
      const o = i * 4;
      if (v === m.nodata || !isValidZ(v)) { img.data[o + 3] = 0; continue; }
      const t = (v - zMin) / span;
      const [r, g, b] = hypso(t);

      // Ombrage (azimut 315°, hauteur 45°)
      const xl = x > 0 ? m.data[i - 1] : v, xr = x < m.width - 1 ? m.data[i + 1] : v;
      const yu = y > 0 ? m.data[i - m.width] : v, yd = y < m.height - 1 ? m.data[i + m.width] : v;
      let shade = 1;
      if (isValidZ(xl) && isValidZ(xr) && isValidZ(yu) && isValidZ(yd)) {
        const dzdx = (xr - xl) / (2 * res), dzdy = (yd - yu) / (2 * res);
        const nz = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        const nx = -dzdx * nz, ny = -dzdy * nz;
        const lx = -0.7071 * 0.7071, ly = 0.7071 * 0.7071, lz = 0.7071;
        shade = Math.max(0.35, Math.min(1.35, nx * lx + ny * ly + nz * lz + 0.45));
      }
      img.data[o] = Math.min(255, r * shade);
      img.data[o + 1] = Math.min(255, g * shade);
      img.data[o + 2] = Math.min(255, b * shade);
      img.data[o + 3] = 200;
    }
  }
  ctx.putImageData(img, 0, 0);
  return L.imageOverlay(cv.toDataURL(), m.bounds, { opacity: 0.75, interactive: false });
}

/** Palette hypsométrique simple (vert → ocre → gris → blanc) */
function hypso(t) {
  const stops = [
    [0.00, [ 40, 110,  60]],
    [0.35, [140, 160,  70]],
    [0.60, [180, 145,  95]],
    [0.80, [150, 140, 135]],
    [1.00, [250, 250, 255]]
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0 || 1);
      return c0.map((c, j) => c + (c1[j] - c) * k);
    }
  }
  return stops[stops.length - 1][1];
}

/* ---------------- Interface ---------------- */

function renderMntList() {
  const el = document.getElementById('mnt-list');
  if (!el) return;
  if (!APP.mnt.length) {
    el.innerHTML = `<div class="empty">Aucun MNT chargé.<br><small>Les altitudes, volumes et profils nécessitent au moins une dalle.</small></div>`;
    return;
  }
  el.innerHTML = APP.mnt.map(m => `
    <div class="card mnt-card">
      <div class="card-head">
        <label class="chk"><input type="checkbox" ${m.visible ? 'checked' : ''} onchange="toggleMNT(${m.id})"><span>⛰️ ${escapeHtml(m.name)}</span></label>
        <button class="icon-btn" title="Retirer" onclick="deleteMNT(${m.id})">✕</button>
      </div>
      <div class="mnt-meta">
        Pas ${fmt(m.resolution, 2)} m · Z ${m.zMin !== null ? `${fmt(m.zMin, 0)}–${fmt(m.zMax, 0)} m` : '—'} ·
        couverture ${fmt(m.coverage * 100, 0)} %
        ${m.quantum ? `<span class="tag warn" title="Le MNT source est codé en nombres entiers : sa résolution verticale est de 1 m. Les volumes en héritent.">Z entier (±0,5 m)</span>` : ''}
      </div>
      <div class="row">
        <button class="btn tiny" onclick="toggleMntRaster(${m.id})">${m.showRaster ? '🙈 Masquer relief' : '🎨 Afficher relief'}</button>
        <button class="btn tiny" onclick="zoomMNT(${m.id})">🔍 Cadrer</button>
      </div>
    </div>`).join('');
}

function toggleMNT(id) {
  const m = APP.mnt.find(x => x.id === id); if (!m) return;
  m.visible = !m.visible;
  if (m.footprint) m.visible ? m.footprint.addTo(APP.map) : APP.map.removeLayer(m.footprint);
  if (m.overlay) m.visible && m.showRaster ? m.overlay.addTo(APP.map) : APP.map.removeLayer(m.overlay);
  refreshAllStats();
}

async function toggleMntRaster(id) {
  const m = APP.mnt.find(x => x.id === id); if (!m) return;
  m.showRaster = !m.showRaster;
  if (m.showRaster) {
    if (!m.overlay) { await busy(true, 'Rendu du relief…'); m.overlay = buildRasterOverlay(m); await busy(false); }
    m.overlay.addTo(APP.map);
  } else if (m.overlay) APP.map.removeLayer(m.overlay);
  renderMntList();
}

function deleteMNT(id) {
  const m = APP.mnt.find(x => x.id === id); if (!m) return;
  if (m.footprint) APP.map.removeLayer(m.footprint);
  if (m.overlay) APP.map.removeLayer(m.overlay);
  APP.mnt = APP.mnt.filter(x => x.id !== id);
  renderMntList(); refreshAllStats();
}

function zoomMNT(id) {
  const m = APP.mnt.find(x => x.id === id); if (m) APP.map.fitBounds(m.bounds);
}

/** Incertitude indicative liée à la quantification verticale du MNT. */
function volumeUncertainty(areaM2) {
  const act = APP.mnt.filter(m => m.visible);
  if (!act.length) return null;
  const m = act.reduce((a, b) => (a.resolution < b.resolution ? a : b));
  if (!m.quantum) return null;
  const sigma = m.quantum / Math.sqrt(12);            // écart-type d'arrondi
  return sigma * Math.sqrt(Math.max(0, areaM2) * m.resolution * m.resolution);
}

window.loadRemoteMNT = loadRemoteMNT;
window.importLocalMNT = importLocalMNT;
window.loadMNTForView = loadMNTForView;
window.toggleMNT = toggleMNT;
window.toggleMntRaster = toggleMntRaster;
window.deleteMNT = deleteMNT;
window.zoomMNT = zoomMNT;
window.renderMntList = renderMntList;
window.volumeUncertainty = volumeUncertainty;
window.MNT_CATALOG = MNT_CATALOG;
