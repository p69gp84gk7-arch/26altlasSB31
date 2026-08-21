/* =====================================================================
   EXPORTS — Sorties exploitables (SIG, CAO, tableur, PDF, projet)
   =====================================================================
   Formats produits :
     • GeoJSON WGS84 (SIG, QGIS, Google Earth via import)
     • GeoJSON Lambert-93 (métrique, pour traitements internes)
     • KML / KMZ (Google Earth, tablettes de chantier)
     • DXF R12 (AutoCAD, Covadis, Mensura) — polylignes 3D en L93
     • CSV « points » et CSV « profil » (séparateur ; décimale ,)
     • CSV « cubatures » récapitulatif chantier
     • PDF : rapport complet en texte vectoriel (sélectionnable, léger)
     • .terra.json : sauvegarde/restitution intégrale du projet
   ===================================================================== */

'use strict';

const EXPORTS = (() => {

  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function saveText(text, filename, mime = 'text/plain;charset=utf-8') {
    saveBlob(new Blob(['﻿' + text], { type: mime }), filename);
  }
  function slug(s) {
    return String(s || 'export').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'export';
  }
  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  /** Tracés à exporter : espace de travail + projets visibles + snowpark */
  function exportable() {
    return [...APP.draws, ...APP.projects.filter(p => p.visible).flatMap(p => p.features)];
  }

  /* ------------------------------------------------------------------
     GeoJSON
     ------------------------------------------------------------------ */
  function featureToGeoJSON(d, l93 = false) {
    const conv = p => l93 ? toL93(p.lng, p.lat) : [p.lng, p.lat];
    const z = p => { const v = effectiveZ(p); return isValidZ(v) ? +v.toFixed(2) : 0; };
    const coords = d.ptsGPS.map(p => [...conv(p), z(p)]);
    let geometry;
    if (d.type === 'point') geometry = { type: 'Point', coordinates: coords[0] };
    else if (d.type === 'line') geometry = { type: 'LineString', coordinates: coords };
    else geometry = { type: 'Polygon', coordinates: [[...coords, coords[0]]] };

    const s = d.stats || GEOM.measure(d);
    return {
      type: 'Feature',
      properties: {
        nom: d.name, type: d.type, couleur: d.color,
        longueur_2d_m: +s.length2D.toFixed(2),
        longueur_3d_m: +s.length3D.toFixed(2),
        perimetre_m: +s.perimeter2D.toFixed(2),
        surface_horizontale_m2: +s.areaH.toFixed(2),
        surface_developpee_m2: +s.areaDev.toFixed(2),
        z_min_m: s.zMin, z_max_m: s.zMax,
        pente_moyenne_pct: s.slopeMean !== null ? +s.slopeMean.toFixed(2) : null,
        cubatures: (d.volumes || []).map(v => ({
          mode: VOL.modeLabel(v.mode), reference: v.refLabel,
          deblai_m3: +v.cut.toFixed(1), remblai_m3: +v.fill.toFixed(1),
          bilan_m3: +v.net.toFixed(1)
        }))
      },
      geometry
    };
  }

  function geojson(l93 = false) {
    const fs = exportable();
    if (!fs.length) return toast('Aucun tracé à exporter.', 'warn');
    const fc = {
      type: 'FeatureCollection',
      name: 'Terrassement_SB',
      crs: l93
        ? { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2154' } }
        : { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: fs.map(d => featureToGeoJSON(d, l93))
    };
    saveText(JSON.stringify(fc, null, 1),
      `terrassement_${l93 ? 'L93' : 'WGS84'}_${stamp()}.geojson`, 'application/geo+json');
    toast(`${fs.length} tracé(s) exporté(s) en GeoJSON.`, 'ok');
  }

  /* ------------------------------------------------------------------
     KML / KMZ
     ------------------------------------------------------------------ */
  function kmlColor(hex, alpha = 'ff') {
    const h = hex.replace('#', '');
    return alpha + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);   // aabbggrr
  }

  function buildKML() {
    const fs = exportable();
    const styles = new Map();
    const body = fs.map(d => {
      const sid = 's' + d.color.replace('#', '');
      if (!styles.has(sid)) {
        styles.set(sid, `<Style id="${sid}">
  <LineStyle><color>${kmlColor(d.color)}</color><width>3</width></LineStyle>
  <PolyStyle><color>${kmlColor(d.color, '66')}</color></PolyStyle>
  <IconStyle><color>${kmlColor(d.color)}</color></IconStyle>
</Style>`);
      }
      const c = d.ptsGPS.map(p => {
        const z = effectiveZ(p);
        return `${p.lng.toFixed(7)},${p.lat.toFixed(7)},${isValidZ(z) ? z.toFixed(2) : 0}`;
      });
      const s = d.stats || GEOM.measure(d);
      const desc = `<![CDATA[
        <b>${escapeHtml(d.name)}</b><br>
        ${d.type === 'line'
          ? `Longueur : ${fmt(s.length2D)} m (3D ${fmt(s.length3D)} m)<br>Pente moyenne : ${fmt(s.slopeMean, 1)} %`
          : `Périmètre : ${fmt(s.perimeter2D)} m<br>Surface : ${fmt(s.areaH)} m²`}<br>
        Z : ${s.zMin !== null ? `${fmt(s.zMin)} → ${fmt(s.zMax)} m` : '—'}<br>
        ${(d.volumes || []).map(v => `${VOL.modeLabel(v.mode)} — déblai ${fmt(v.cut, 1)} m³ / remblai ${fmt(v.fill, 1)} m³`).join('<br>')}
      ]]>`;

      let geom;
      if (d.type === 'point') geom = `<Point><altitudeMode>absolute</altitudeMode><coordinates>${c[0]}</coordinates></Point>`;
      else if (d.type === 'line') geom = `<LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${c.join(' ')}</coordinates></LineString>`;
      else geom = `<Polygon><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>${[...c, c[0]].join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;

      return `<Placemark><name>${escapeHtml(d.name)}</name><description>${desc}</description><styleUrl>#${sid}</styleUrl>${geom}</Placemark>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<name>Terrassement SB — ${new Date().toLocaleDateString('fr-FR')}</name>
${[...styles.values()].join('\n')}
${body}
</Document></kml>`;
  }

  function kml() {
    if (!exportable().length) return toast('Aucun tracé à exporter.', 'warn');
    saveText(buildKML(), `terrassement_${stamp()}.kml`, 'application/vnd.google-earth.kml+xml');
    toast('KML exporté.', 'ok');
  }

  async function kmz() {
    if (!exportable().length) return toast('Aucun tracé à exporter.', 'warn');
    const zip = new JSZip();
    zip.file('doc.kml', buildKML());
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    saveBlob(blob, `terrassement_${stamp()}.kmz`);
    toast('KMZ exporté (Google Earth).', 'ok');
  }

  /* ------------------------------------------------------------------
     DXF R12 — polylignes 3D en Lambert-93
     ------------------------------------------------------------------ */
  function dxfColorIndex(hex) {
    // Correspondance approximative vers les 7 couleurs ACI de base
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const pal = [[255, 0, 0, 1], [255, 255, 0, 2], [0, 255, 0, 3], [0, 255, 255, 4],
                 [0, 0, 255, 5], [255, 0, 255, 6], [255, 255, 255, 7]];
    let best = 7, bd = Infinity;
    for (const [pr, pg, pb, idx] of pal) {
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (d < bd) { bd = d; best = idx; }
    }
    return best;
  }

  function dxf() {
    const fs = exportable();
    if (!fs.length) return toast('Aucun tracé à exporter.', 'warn');

    const layers = [...new Set(fs.map(d => slug(d.name).toUpperCase()))];
    let out = '';
    const w = (code, val) => { out += `${code}\n${val}\n`; };

    // --- HEADER : version et emprise (certains logiciels l'exigent)
    let hx0 = Infinity, hy0 = Infinity, hx1 = -Infinity, hy1 = -Infinity;
    fs.forEach(d => ptsToL93(d.ptsGPS).forEach(p => {
      hx0 = Math.min(hx0, p[0]); hx1 = Math.max(hx1, p[0]);
      hy0 = Math.min(hy0, p[1]); hy1 = Math.max(hy1, p[1]);
    }));
    w(0, 'SECTION'); w(2, 'HEADER');
    w(9, '$ACADVER'); w(1, 'AC1009');
    w(9, '$INSBASE'); w(10, '0.0'); w(20, '0.0'); w(30, '0.0');
    w(9, '$EXTMIN'); w(10, hx0.toFixed(3)); w(20, hy0.toFixed(3)); w(30, '0.0');
    w(9, '$EXTMAX'); w(10, hx1.toFixed(3)); w(20, hy1.toFixed(3)); w(30, '0.0');
    w(0, 'ENDSEC');

    // --- TABLES : calques
    w(0, 'SECTION'); w(2, 'TABLES');
    w(0, 'TABLE'); w(2, 'LAYER'); w(70, layers.length + 1);
    w(0, 'LAYER'); w(2, '0'); w(70, 0); w(62, 7); w(6, 'CONTINUOUS');
    layers.forEach(l => {
      const f = fs.find(d => slug(d.name).toUpperCase() === l);
      w(0, 'LAYER'); w(2, l); w(70, 0); w(62, dxfColorIndex(f ? f.color : '#ffffff')); w(6, 'CONTINUOUS');
    });
    w(0, 'ENDTAB'); w(0, 'ENDSEC');

    // --- ENTITIES
    w(0, 'SECTION'); w(2, 'ENTITIES');
    fs.forEach(d => {
      const lay = slug(d.name).toUpperCase();
      const pts = ptsToL93(d.ptsGPS);
      const zs = d.ptsGPS.map(p => { const v = effectiveZ(p); return isValidZ(v) ? v : 0; });

      if (d.type === 'point') {
        w(0, 'POINT'); w(8, lay); w(10, pts[0][0].toFixed(3)); w(20, pts[0][1].toFixed(3)); w(30, zs[0].toFixed(3));
        w(0, 'TEXT'); w(8, lay); w(10, (pts[0][0] + 1).toFixed(3)); w(20, pts[0][1].toFixed(3)); w(30, zs[0].toFixed(3));
        w(40, '1.5'); w(1, `${d.name} Z=${zs[0].toFixed(2)}`);
        return;
      }
      const closed = (d.type === 'area' || d.type === 'circle');
      w(0, 'POLYLINE'); w(8, lay); w(66, 1); w(70, (closed ? 1 : 0) + 8); // 8 = polyligne 3D
      w(10, '0.0'); w(20, '0.0'); w(30, '0.0');
      pts.forEach((p, i) => {
        w(0, 'VERTEX'); w(8, lay); w(70, 32);
        w(10, p[0].toFixed(3)); w(20, p[1].toFixed(3)); w(30, zs[i].toFixed(3));
      });
      w(0, 'SEQEND'); w(8, lay);

      // Étiquette au barycentre
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const s = d.stats || GEOM.measure(d);
      const label = closed ? `${d.name} — ${fmt(s.areaH, 0)} m²` : `${d.name} — ${fmt(s.length2D, 1)} m`;
      w(0, 'TEXT'); w(8, lay); w(10, cx.toFixed(3)); w(20, cy.toFixed(3)); w(30, '0.0');
      w(40, '2.0'); w(1, label);
    });
    w(0, 'ENDSEC'); w(0, 'EOF');

    saveText(out, `terrassement_L93_${stamp()}.dxf`, 'application/dxf');
    toast(`DXF exporté (${layers.length} calques, coordonnées Lambert-93).`, 'ok');
  }

  /* ------------------------------------------------------------------
     CSV
     ------------------------------------------------------------------ */
  function featureCSV(id) {
    const d = findFeature(id); if (!d) return;
    const pts = ptsToL93(d.ptsGPS);
    let csv = 'Point;X_L93;Y_L93;Z_m;Source_Z;Longitude;Latitude\n';
    pts.forEach((p, i) => {
      const src = d.ptsGPS[i];
      const forced = src.customZ !== undefined;
      const z = effectiveZ(src);
      csv += [i + 1, csvNum(p[0], 3), csvNum(p[1], 3), isValidZ(z) ? csvNum(z, 2) : '',
        forced ? 'forcé' : 'MNT', csvNum(src.lng, 7), csvNum(src.lat, 7)].join(';') + '\n';
    });
    saveText(csv, `${slug(d.name)}_points.csv`, 'text/csv;charset=utf-8');
    toast('Points exportés en CSV.', 'ok');
  }

  function allPointsCSV() {
    const fs = exportable();
    if (!fs.length) return toast('Aucun tracé.', 'warn');
    let csv = 'Trace;Type;Point;X_L93;Y_L93;Z_m;Source_Z\n';
    fs.forEach(d => {
      ptsToL93(d.ptsGPS).forEach((p, i) => {
        const src = d.ptsGPS[i]; const z = effectiveZ(src);
        csv += [d.name, d.type, i + 1, csvNum(p[0], 3), csvNum(p[1], 3),
          isValidZ(z) ? csvNum(z, 2) : '', src.customZ !== undefined ? 'forcé' : 'MNT'].join(';') + '\n';
      });
    });
    saveText(csv, `points_tous_${stamp()}.csv`, 'text/csv;charset=utf-8');
    toast('Tous les points exportés.', 'ok');
  }

  function profileCSV() {
    const D = PROFILE.data();
    if (!D.feature || !D.terrain.length) return toast('Ouvrez un profil d’abord.', 'warn');
    let csv = 'PK_m;Z_terrain_m;Z_projet_m;Delta_m;Nature\n';
    D.terrain.forEach(p => {
      const pr = PROFILE.interp(D.project, p.x);
      const dz = (p.y !== null && pr !== null) ? p.y - pr : null;
      csv += [csvNum(p.x, 2), p.y !== null ? csvNum(p.y, 2) : '',
        pr !== null ? csvNum(pr, 2) : '', dz !== null ? csvNum(dz, 2) : '',
        dz === null ? '' : (dz >= 0 ? 'deblai' : 'remblai')].join(';') + '\n';
    });
    const a = PROFILE.areas(D.project);
    csv += `\nAire deblai (m2);${csvNum(a.cut, 2)}\nAire remblai (m2);${csvNum(a.fill, 2)}\n`;
    if (D.feature.profileWidth) {
      csv += `Largeur emprise (m);${csvNum(D.feature.profileWidth, 2)}\n`;
      csv += `Volume deblai (m3);${csvNum(a.cut * D.feature.profileWidth, 1)}\n`;
      csv += `Volume remblai (m3);${csvNum(a.fill * D.feature.profileWidth, 1)}\n`;
    }
    saveText(csv, `${slug(D.feature.name)}_profil.csv`, 'text/csv;charset=utf-8');
    toast('Profil exporté en CSV.', 'ok');
  }

  function profilePNG() {
    const D = PROFILE.data();
    if (!D.chart) return toast('Ouvrez un profil d’abord.', 'warn');
    const src = document.getElementById('profileChart');
    // Fond blanc : sinon le PNG est transparent et illisible dans un rapport
    const cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
    c.drawImage(src, 0, 0);
    cv.toBlob(b => saveBlob(b, `${slug(D.feature.name)}_profil.png`));
    toast('Profil exporté en PNG.', 'ok');
  }

  function cubatureCSV() {
    const fs = exportable().filter(d => d.volumes && d.volumes.length);
    if (!fs.length) return toast('Aucune cubature calculée.', 'warn');
    const S = APP.settings;
    let csv = 'Trace;Methode;Reference;Surface_m2;Deblai_m3;Remblai_m3;Bilan_m3;' +
      `Deblai_foisonne_m3(x${csvNum(S.foisonnement, 2)});Apport_remblai_m3;Tonnage_deblai_t;Ep_moy_deblai_m;Ep_moy_remblai_m;Pas_calcul_m\n`;
    fs.forEach(d => d.volumes.forEach(v => {
      csv += [d.name, VOL.modeLabel(v.mode), v.refLabel, csvNum(v.areaExact, 1),
        csvNum(v.cut, 1), csvNum(v.fill, 1), csvNum(v.net, 1),
        csvNum(v.cutFoisonne, 1), csvNum(v.fillApport, 1), csvNum(v.tonnesCut, 0),
        csvNum(v.epaisMoyCut, 2), csvNum(v.epaisMoyFill, 2), csvNum(v.step, 2)].join(';') + '\n';
    }));
    const tot = fs.flatMap(d => d.volumes).reduce((a, v) => ({ c: a.c + v.cut, f: a.f + v.fill }), { c: 0, f: 0 });
    csv += `\nTOTAL;;;;${csvNum(tot.c, 1)};${csvNum(tot.f, 1)};${csvNum(tot.c - tot.f, 1)}\n`;
    saveText(csv, `cubatures_${stamp()}.csv`, 'text/csv;charset=utf-8');
    toast('Récapitulatif des cubatures exporté.', 'ok');
  }

  /* ------------------------------------------------------------------
     Sauvegarde / ouverture de projet
     ------------------------------------------------------------------ */
  function serialize() {
    const ser = d => ({
      type: d.type, name: d.name, color: d.color, weight: d.weight,
      ptsGPS: d.ptsGPS.map(p => ({ lat: p.lat, lng: p.lng, ...(p.customZ !== undefined ? { customZ: p.customZ } : {}) })),
      center: d.center, radius: d.radius,
      projectPts: d.projectPts || [], profileWidth: d.profileWidth || null,
      volumes: (d.volumes || []).map(v => ({ ...v }))
    });
    return {
      format: 'terrassement-sb', version: 2, date: new Date().toISOString(),
      name: document.getElementById('project-name')?.value || 'Projet',
      settings: { ...APP.settings },
      mnt: APP.mnt.map(m => m.name),
      draws: APP.draws.map(ser),
      projects: APP.projects.map(p => ({ name: p.name, features: p.features.map(ser) })),
      parks: (APP.parks || []).map(f => ({ name: f.name, color: f.color, visible: f.visible !== false, props: { ...f.props } }))
    };
  }

  function saveProject() {
    const name = document.getElementById('project-name')?.value.trim() || 'projet';
    const data = serialize();
    saveText(JSON.stringify(data), `${slug(name)}_${stamp()}.terra.json`, 'application/json');
    localStorage.setItem('terra_autosave', JSON.stringify(data));
    toast('Projet enregistré (fichier + sauvegarde locale).', 'ok');
  }

  function loadProjectFile(file) {
    const r = new FileReader();
    r.onload = () => {
      try { restore(JSON.parse(r.result), file.name.replace(/\.terra\.json$/, '')); }
      catch (e) { console.error(e); toast('Fichier de projet illisible.', 'err'); }
    };
    r.readAsText(file);
  }

  function restore(data, fallbackName = 'Projet') {
    if (!data || data.format !== 'terrassement-sb') { toast('Format de fichier inattendu.', 'err'); return; }
    if (data.settings) Object.assign(APP.settings, data.settings);

    const hydrate = o => {
      const f = newFeature({
        type: o.type, name: o.name, color: o.color || '#3498db', weight: o.weight || 3,
        ptsGPS: o.ptsGPS, center: o.center, radius: o.radius
      });
      f.projectPts = o.projectPts || [];
      f.profileWidth = o.profileWidth || null;
      f.volumes = o.volumes || [];
      redrawFeature(f); refreshStats(f);
      return f;
    };

    (data.draws || []).forEach(o => APP.draws.push(hydrate(o)));
    (data.projects || []).forEach(p => APP.projects.push({
      id: uid(), name: p.name, visible: true, features: (p.features || []).map(hydrate)
    }));
    if (data.parks && window.SNOWPARK) SNOWPARK.restore(data.parks);

    if (data.draws && data.draws.length === 0 && (!data.projects || !data.projects.length)) {
      // rien à recadrer
    } else {
      const all = allFeatures().filter(f => f.layer);
      if (all.length) APP.map.fitBounds(L.featureGroup(all.map(f => f.layer)).getBounds(), { padding: [40, 40] });
    }
    const nm = document.getElementById('project-name');
    if (nm) nm.value = data.name || fallbackName;
    renderDrawList(); renderSettings();
    toast(`Projet « ${data.name || fallbackName} » chargé.`, 'ok');
  }

  function autosave() {
    try { localStorage.setItem('terra_autosave', JSON.stringify(serialize())); } catch (e) { /* quota */ }
  }
  function hasAutosave() { return !!localStorage.getItem('terra_autosave'); }
  function autosaveHasContent() {
    try {
      const d = JSON.parse(localStorage.getItem('terra_autosave') || '{}');
      return (d.draws || []).length + (d.projects || []).length + (d.parks || []).length > 0;
    } catch (e) { return false; }
  }
  function restoreAutosave() {
    const raw = localStorage.getItem('terra_autosave');
    if (!raw) return toast('Aucune sauvegarde locale.', 'warn');
    try { restore(JSON.parse(raw)); } catch (e) { toast('Sauvegarde locale corrompue.', 'err'); }
  }

  /* ------------------------------------------------------------------
     Rapport PDF (texte vectoriel)
     ------------------------------------------------------------------ */
  async function mapImage() {
    const fs = exportable().filter(f => f.layer);
    if (fs.length) {
      // `moveend` n'est pas émis si la vue est déjà cadrée : on borne l'attente
      const settled = new Promise(res => APP.map.once('moveend', () => setTimeout(res, 600)));
      const timeout = new Promise(res => setTimeout(res, 1800));
      APP.map.fitBounds(L.featureGroup(fs.map(f => f.layer)).getBounds(), { padding: [40, 40] });
      await Promise.race([settled, timeout]);
    }
    const cv = await html2canvas(document.getElementById('map'), {
      useCORS: true, logging: false, backgroundColor: '#000',
      ignoreElements: el => el.classList && (el.classList.contains('leaflet-control-container') || el.id === 'draw-bar')
    });
    return cv.toDataURL('image/jpeg', 0.82);
  }

  async function pdfReport(opts = {}) {
    const fs = exportable();
    if (!fs.length) return toast('Aucun tracé à porter au rapport.', 'warn');
    await busy(true, 'Composition du rapport…');
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF('p', 'mm', 'a4');

      // Les polices standard du PDF sont limitées à Latin-1 : on remplace les
      // caractères hors jeu (espace fine insécable des nombres français, signes
      // typographiques) qui, sinon, s'affichent comme des glyphes parasites.
      const clean = t => String(t)
        .replace(/[\u202f\u2009\u00a0]/g, ' ')
        .replace(/\u2212/g, '-')
        .replace(/\u2248/g, '~')
        .replace(/[\u26a0\ufe0f]/g, '!');
      const rawText = doc.text.bind(doc);
      doc.text = (t, x, y, o) => rawText(Array.isArray(t) ? t.map(clean) : clean(t), x, y, o);
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const M = 14;
      let y = 0;
      let page = 0;

      const header = (title) => {
        page++;
        doc.setFillColor(26, 32, 44); doc.rect(0, 0, W, 18, 'F');
        doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text('Terrassement SB — rapport de cubature', M, 11.5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
        doc.text(new Date().toLocaleString('fr-FR'), W - M, 11.5, { align: 'right' });
        doc.setTextColor(20);
        y = 26;
        if (title) { doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(title, M, y); y += 7; }
      };
      const footer = () => {
        doc.setFontSize(8); doc.setTextColor(120);
        doc.text(`Page ${page}`, W - M, H - 8, { align: 'right' });
        doc.text('Altitudes NGF · coordonnées Lambert-93 (EPSG:2154)', M, H - 8);
        doc.setTextColor(20);
      };
      const need = (h, title) => { if (y + h > H - 16) { footer(); doc.addPage(); header(title); } };

      header();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
      doc.text(document.getElementById('project-name')?.value || 'Projet de terrassement', M, y + 6);
      y += 14;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
      const mntNames = APP.mnt.filter(m => m.visible).map(m => m.name).join(', ') || 'aucun';
      const quant = APP.mnt.some(m => m.visible && m.quantum);
      doc.text(doc.splitTextToSize(
        `Modèle numérique de terrain : ${mntNames}.` +
        (quant ? ' Altitudes source codées en nombres entiers : précision verticale de l’ordre de ±0,5 m, répercutée sur les volumes.' : '') +
        ` Convention : déblai = terrain au-dessus du projet ; remblai = terrain en dessous.` +
        ` Foisonnement ${fmt(APP.settings.foisonnement, 2)} · densité ${fmt(APP.settings.densite, 2)} t/m³ · tassement ${fmt(APP.settings.tassement, 2)}.`,
        W - 2 * M), M, y);
      y += 16; doc.setTextColor(20);

      // --- Plan
      try {
        const img = await mapImage();
        need(96, 'Plan');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('1. Plan de situation', M, y); y += 5;
        doc.addImage(img, 'JPEG', M, y, W - 2 * M, 88);
        y += 94;
      } catch (e) { console.warn('capture carte', e); }

      // --- Tableau récapitulatif
      need(40); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('2. Récapitulatif des tracés', M, y); y += 6;

      const cols = [
        { t: 'Tracé', w: 42, a: 'left' }, { t: 'Type', w: 18 }, { t: 'Long./Périm.', w: 26 },
        { t: 'Surf. hor.', w: 24 }, { t: 'Surf. dév.', w: 24 }, { t: 'Z min', w: 19 }, { t: 'Z max', w: 19 }
      ];
      const drawRow = (cells, opts = {}) => {
        let x = M;
        doc.setFontSize(8);
        doc.setFont('helvetica', opts.head ? 'bold' : 'normal');
        if (opts.head) { doc.setFillColor(41, 128, 185); doc.setTextColor(255); doc.rect(M, y - 4.2, W - 2 * M, 6, 'F'); }
        else if (opts.zebra) { doc.setFillColor(244, 246, 249); doc.rect(M, y - 4.2, W - 2 * M, 6, 'F'); }
        cells.forEach((c, i) => {
          const col = cols[i];
          const tx = col.a === 'left' ? x + 1.5 : x + col.w - 1.5;
          doc.text(String(c).slice(0, 30), tx, y, { align: col.a === 'left' ? 'left' : 'right' });
          x += col.w;
        });
        doc.setTextColor(20);
        y += 6;
      };
      drawRow(cols.map(c => c.t), { head: true });
      fs.forEach((d, i) => {
        need(10);
        const s = d.stats || GEOM.measure(d);
        drawRow([
          d.name, typeLabel(d.type),
          fmt(d.type === 'line' ? s.length2D : s.perimeter2D, 1),
          d.type === 'line' ? '—' : fmt(s.areaH, 1),
          d.type === 'line' ? fmt(s.length3D, 1) : fmt(s.areaDev, 1),
          s.zMin !== null ? fmt(s.zMin, 1) : '—',
          s.zMax !== null ? fmt(s.zMax, 1) : '—'
        ], { zebra: i % 2 === 1 });
      });
      y += 6;

      // --- Cubatures
      const withVol = fs.filter(d => d.volumes && d.volumes.length);
      if (withVol.length) {
        need(30); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.text('3. Cubatures', M, y); y += 6;

        let totC = 0, totF = 0;
        withVol.forEach(d => {
          d.volumes.forEach(v => {
            need(30);
            totC += v.cut; totF += v.fill;
            doc.setFillColor(248, 249, 251); doc.rect(M, y - 4, W - 2 * M, 24, 'F');
            doc.setDrawColor(210); doc.line(M, y - 4, M, y + 20);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
            doc.text(`${d.name} — ${VOL.modeLabel(v.mode)}`, M + 3, y);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
            doc.text(`${v.refLabel} · surface ${fmt(v.areaExact, 1)} m² · pas ${fmt(v.step, 2)} m`, M + 3, y + 4.5);
            doc.setTextColor(20); doc.setFontSize(9);
            doc.setTextColor(31, 97, 141);
            doc.text(`Déblai : ${fmt(v.cut, 1)} m³`, M + 3, y + 10.5);
            doc.setTextColor(175, 96, 26);
            doc.text(`Remblai : ${fmt(v.fill, 1)} m³`, M + 62, y + 10.5);
            doc.setTextColor(20);
            doc.text(`Bilan : ${v.net >= 0 ? '+' : '−'}${fmt(Math.abs(v.net), 1)} m³ (${v.net >= 0 ? 'excédent' : 'déficit'})`, M + 120, y + 10.5);
            doc.setFontSize(8); doc.setTextColor(90);
            doc.text(`Foisonné ×${fmt(APP.settings.foisonnement, 2)} : ${fmt(v.cutFoisonne, 1)} m³ ≈ ${fmt(v.tonnesCut, 0)} t · apport remblai ${fmt(v.fillApport, 1)} m³` +
              ` · ép. moy. ${fmt(v.epaisMoyCut, 2)} / ${fmt(v.epaisMoyFill, 2)} m`, M + 3, y + 16.5);
            doc.setTextColor(20);
            y += 27;
            v.warnings.forEach(wn => {
              need(8); doc.setFontSize(7.5); doc.setTextColor(160, 80, 0);
              doc.text(doc.splitTextToSize('⚠ ' + wn, W - 2 * M - 6), M + 3, y); y += 5; doc.setTextColor(20);
            });
          });
        });
        need(14);
        doc.setFillColor(26, 32, 44); doc.rect(M, y - 4, W - 2 * M, 10, 'F');
        doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
        doc.text(`TOTAL — déblai ${fmt(totC, 1)} m³ · remblai ${fmt(totF, 1)} m³ · bilan ${totC - totF >= 0 ? '+' : '−'}${fmt(Math.abs(totC - totF), 1)} m³`, M + 3, y + 2.5);
        doc.setTextColor(20); y += 16;
      }

      // --- Profils
      const lines = fs.filter(d => d.type === 'line');
      if (lines.length) {
        footer(); doc.addPage(); header('4. Profils en long');
        for (const d of lines) {
          const png = await profileImage(d);
          if (!png) continue;
          need(90, '4. Profils en long');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
          doc.text(d.name, M, y); y += 4;
          doc.addImage(png, 'PNG', M, y, W - 2 * M, 62);
          y += 66;
          if (d.projectPts && d.projectPts.length > 1) {
            const a = PROFILE.areasFor(d);
            if (a) {
              doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
              const wI = d.profileWidth || 0;
              doc.text(`Aire déblai ${fmt(a.cut, 2)} m² · aire remblai ${fmt(a.fill, 2)} m²` +
                (wI ? ` · emprise ${fmt(wI, 1)} m ⇒ ${fmt(a.cut * wI, 1)} / ${fmt(a.fill * wI, 1)} m³` : ''), M, y);
              y += 8;
            }
          }
        }
      }

      // --- Vues 3D
      const caps = VIEW3D.getCaptures();
      if (caps.length) {
        footer(); doc.addPage(); header('5. Vues 3D');
        for (const c of caps) {
          need(95, '5. Vues 3D');
          doc.addImage(c, 'PNG', M, y, W - 2 * M, 88);
          y += 94;
        }
      }

      footer();
      if (opts.blob) return doc.output('blob');
      saveBlob(doc.output('blob'), `rapport_terrassement_${stamp()}.pdf`);
      toast('Rapport PDF généré.', 'ok');
      return doc;
    } catch (e) {
      console.error(e); toast('Erreur lors de la génération du PDF.', 'err');
    } finally { await busy(false); }
  }

  /** Image PNG d'un profil, recalculée hors écran (Plotly). */
  async function profileImage(d) {
    try {
      const s = PROFILE.sample(d);
      const x = s.terrain.map(p => p.x), z = s.terrain.map(p => p.y);
      const data = [{
        x, y: z, mode: 'lines', type: 'scatter', fill: 'tozeroy',
        line: { color: d.color, width: 2 }, name: 'Terrain naturel'
      }];
      if (d.projectPts && d.projectPts.length > 1) {
        data.push({
          x: d.projectPts.map(p => p.x), y: d.projectPts.map(p => p.y),
          mode: 'lines+markers', type: 'scatter',
          line: { color: '#d68910', width: 2 }, marker: { size: 5 }, name: 'Projet'
        });
      }
      const zs = z.filter(v => v !== null);
      const layout = {
        margin: { t: 10, b: 42, l: 48, r: 12 },
        xaxis: { title: 'Distance (m)', color: '#222', gridcolor: '#ddd' },
        yaxis: { title: 'Altitude NGF (m)', color: '#222', gridcolor: '#ddd', range: zs.length ? [Math.min(...zs) - 2, Math.max(...zs) + 2] : undefined },
        paper_bgcolor: '#fff', plot_bgcolor: '#fff', showlegend: true,
        legend: { orientation: 'h', y: 1.12 }
      };
      return await Plotly.toImage({ data, layout }, { format: 'png', width: 1100, height: 460 });
    } catch (e) { console.warn(e); return null; }
  }

  /* ------------------------------------------------------------------
     Import GeoJSON / KML / KMZ
     ------------------------------------------------------------------ */
  async function importGeoFile(file) {
    const name = file.name.toLowerCase();
    try {
      let gj = null;
      if (name.endsWith('.geojson') || name.endsWith('.json')) {
        gj = JSON.parse(await file.text());
        if (gj.format === 'terrassement-sb') { restore(gj, file.name); return; }
      } else if (name.endsWith('.kml')) {
        gj = toGeoJSON.kml(new DOMParser().parseFromString(await file.text(), 'text/xml'));
      } else if (name.endsWith('.kmz')) {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const kmlFile = Object.keys(zip.files).find(f => f.toLowerCase().endsWith('.kml'));
        if (!kmlFile) throw new Error('KMZ sans doc.kml');
        gj = toGeoJSON.kml(new DOMParser().parseFromString(await zip.files[kmlFile].async('text'), 'text/xml'));
      } else { toast('Format non reconnu.', 'err'); return; }

      const layer = L.geoJSON(gj, {
        style: { color: '#1abc9c', weight: 2, fillOpacity: 0.15 },
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 5, color: '#fff', weight: 1, fillColor: '#1abc9c', fillOpacity: 0.9 })
      }).addTo(APP.map);
      APP.layers.push({ id: uid(), name: file.name, layer, visible: true, color: '#1abc9c', removable: true });
      renderLayerList();
      APP.map.fitBounds(layer.getBounds());
      toast(`${file.name} importé comme calque.`, 'ok');
    } catch (e) { console.error(e); toast('Import impossible : ' + e.message, 'err'); }
  }

  return {
    saveBlob, saveText, slug, stamp,
    geojson, kml, kmz, dxf,
    featureCSV, allPointsCSV, profileCSV, profilePNG, cubatureCSV,
    saveProject, loadProjectFile, restore, autosave, hasAutosave, autosaveHasContent, restoreAutosave,
    pdfReport, importGeoFile, serialize
  };
})();

window.EXPORTS = EXPORTS;
