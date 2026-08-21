/* =====================================================================
   CORE — Projections, état global, moteur altimétrique MNT, utilitaires
   =====================================================================
   Conventions retenues dans TOUTE l'application (cohérence des résultats) :

   - DÉBLAI  = matière à EXCAVER  = terrain naturel AU-DESSUS du projet.
   - REMBLAI = matière à APPORTER = terrain naturel EN-DESSOUS du projet.
   - Les volumes sont en m³ "en place" (géométriques). Le foisonnement est
     appliqué séparément et affiché explicitement.
   - Toutes les longueurs / surfaces géométriques sont calculées en
     Lambert-93 (EPSG:2154), système métrique conforme (France).
   - Une surface est donnée sous 2 formes :
        * surface HORIZONTALE (projection au sol, celle des plans)
        * surface DÉVELOPPÉE  (le long du terrain, celle du gazon/géotextile)
   ===================================================================== */

'use strict';

/* ---------- Projections ---------- */
proj4.defs('EPSG:2154',
  '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 ' +
  '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

/** WGS84 (lng,lat) -> Lambert 93 [X,Y] en mètres */
function toL93(lng, lat) { return proj4('EPSG:4326', 'EPSG:2154', [lng, lat]); }
/** Lambert 93 [X,Y] -> WGS84 {lat,lng} */
function toWGS(x, y) { const g = proj4('EPSG:2154', 'EPSG:4326', [x, y]); return { lng: g[0], lat: g[1] }; }
/** Tableau de points {lat,lng} -> tableau [X,Y] L93 */
function ptsToL93(pts) { return pts.map(p => toL93(p.lng, p.lat)); }

/* ---------- État global ---------- */
const APP = {
  map: null,
  mnt: [],           // couches MNT chargées
  draws: [],         // tracés de l'espace de travail
  projects: [],      // projets sauvegardés/chargés
  parks: [],         // modules snowpark
  layers: [],        // calques statiques (pistes, canons, KMZ importés)
  tool: null,        // outil de tracé actif
  mode: 'terrain',   // 'terrain' | 'snowpark'
  settings: {
    // Paramètres de cubature — modifiables par l'utilisateur
    gridStep: 'auto',      // pas de la grille de calcul (m) ou 'auto'
    subSample: 3,          // sous-échantillonnage des mailles de bordure (3 => 3x3)
    foisonnement: 1.25,    // coefficient de foisonnement des déblais
    densite: 1.8,          // t/m³ en place
    tassement: 0.90,       // coefficient de tassement/compactage des remblais
    mntBase: 'https://raw.githubusercontent.com/p69gp84gk7-arch/26altlasSB31/main/tif/'
  }
};
window.APP = APP;

/* ---------- Utilitaires numériques ---------- */
const NODATA_MIN = -1000;   // sous ce seuil : valeur invalide (MNT IGN : -99999)
const NODATA_MAX = 9000;    // au-dessus : valeur invalide

function isValidZ(z) {
  return z !== null && z !== undefined && !Number.isNaN(z) && z > NODATA_MIN && z < NODATA_MAX;
}

/** Formatage FR : 1 234,56 */
function fmt(v, dec = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtM(v, dec = 2) { return fmt(v, dec) + ' m'; }
function fmtM2(v, dec = 1) { return fmt(v, dec) + ' m²'; }
function fmtM3(v, dec = 1) { return fmt(v, dec) + ' m³'; }

/** Nombre pour export CSV français (virgule décimale) */
function csvNum(v, dec = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return v.toFixed(dec).replace('.', ',');
}

function uid() { return Date.now() * 1000 + Math.floor(Math.random() * 1000); }

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Notifications (remplace les alert() bloquants) ---------- */
function toast(msg, type = 'info', ms = 3800) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
  return el;
}
window.toast = toast;

/** Indicateur de calcul en cours */
function busy(on, msg = 'Calcul en cours…') {
  let el = document.getElementById('busy-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'busy-overlay';
    el.innerHTML = '<div class="busy-box"><div class="spinner"></div><span id="busy-msg"></span></div>';
    document.body.appendChild(el);
  }
  el.querySelector('#busy-msg').textContent = msg;
  el.style.display = on ? 'flex' : 'none';
  return new Promise(r => setTimeout(r, on ? 30 : 0));
}
window.busy = busy;

/* =====================================================================
   MOTEUR ALTIMÉTRIQUE
   ---------------------------------------------------------------------
   Interpolation bilinéaire stricte sur le MNT, en coordonnées Lambert-93.
   Corrections par rapport à la version d'origine :
     * gestion réelle du NoData (tag GDAL_NODATA + bornes de vraisemblance)
     * pas d'extrapolation hors dalle (dx/dy bornés à [0,1])
     * si plusieurs MNT se recouvrent, on retient LE PLUS FIN (résolution
       la plus petite) — sinon les résultats variaient selon l'ordre de
       chargement des dalles.
   ===================================================================== */

/**
 * Altitude du terrain naturel au point Lambert-93 donné.
 * @param {number[]} l93 [X, Y]
 * @returns {number|null} altitude en m, ou null hors emprise / NoData
 */
function getZ(l93) {
  const x = l93[0], y = l93[1];
  let best = null, bestRes = Infinity;

  for (const m of APP.mnt) {
    if (!m.visible) continue;
    if (x < m.bbox[0] || x > m.bbox[2] || y < m.bbox[1] || y > m.bbox[3]) continue;
    if (m.resolution < bestRes) { best = m; bestRes = m.resolution; }
  }
  if (!best) return null;

  const z = sampleMNT(best, x, y);
  if (isValidZ(z)) return z;

  // Repli : une dalle plus grossière peut couvrir le trou de la dalle fine
  for (const m of APP.mnt) {
    if (!m.visible || m === best) continue;
    if (x < m.bbox[0] || x > m.bbox[2] || y < m.bbox[1] || y > m.bbox[3]) continue;
    const z2 = sampleMNT(m, x, y);
    if (isValidZ(z2)) return z2;
  }
  return null;
}

/** Échantillonnage bilinéaire d'une dalle MNT. */
function sampleMNT(m, x, y) {
  const pw = (m.bbox[2] - m.bbox[0]) / m.width;
  const ph = (m.bbox[3] - m.bbox[1]) / m.height;

  // Coordonnées "centre de pixel"
  const px = (x - m.bbox[0]) / pw - 0.5;
  const py = (m.bbox[3] - y) / ph - 0.5;

  const x1 = Math.floor(px), y1 = Math.floor(py);
  const cx1 = Math.max(0, Math.min(x1, m.width - 1));
  const cy1 = Math.max(0, Math.min(y1, m.height - 1));
  const cx2 = Math.max(0, Math.min(x1 + 1, m.width - 1));
  const cy2 = Math.max(0, Math.min(y1 + 1, m.height - 1));

  // Bornage : on n'extrapole jamais au-delà des pixels de bord
  const dx = Math.min(1, Math.max(0, px - x1));
  const dy = Math.min(1, Math.max(0, py - y1));

  const q11 = valAt(m, cx1, cy1), q21 = valAt(m, cx2, cy1);
  const q12 = valAt(m, cx1, cy2), q22 = valAt(m, cx2, cy2);

  // Si un seul des 4 voisins est NoData, on retombe sur le plus proche valide
  if (q11 === null || q21 === null || q12 === null || q22 === null) {
    const rx = Math.max(0, Math.min(Math.round(px), m.width - 1));
    const ry = Math.max(0, Math.min(Math.round(py), m.height - 1));
    return valAt(m, rx, ry);
  }
  const top = q11 * (1 - dx) + q21 * dx;
  const bot = q12 * (1 - dx) + q22 * dx;
  return top * (1 - dy) + bot * dy;
}

function valAt(m, ix, iy) {
  const v = m.data[iy * m.width + ix];
  if (v === m.nodata) return null;
  return isValidZ(v) ? v : null;
}

/** Altitude en WGS84 (raccourci). */
function getZLL(lat, lng) { return getZ(toL93(lng, lat)); }

/**
 * Altitude "effective" d'un sommet de tracé :
 * altitude forcée si l'utilisateur en a saisi une, sinon MNT.
 */
function effectiveZ(pt) {
  if (pt.customZ !== undefined && pt.customZ !== null && !Number.isNaN(pt.customZ)) return pt.customZ;
  return getZ(toL93(pt.lng, pt.lat));
}

/** true si au moins un MNT est actif */
function hasMNT() { return APP.mnt.some(m => m.visible); }

window.toL93 = toL93; window.toWGS = toWGS; window.ptsToL93 = ptsToL93;
window.getZ = getZ; window.getZLL = getZLL; window.effectiveZ = effectiveZ;
window.hasMNT = hasMNT; window.isValidZ = isValidZ;
window.fmt = fmt; window.fmtM = fmtM; window.fmtM2 = fmtM2; window.fmtM3 = fmtM3;
window.csvNum = csvNum; window.uid = uid; window.escapeHtml = escapeHtml;
