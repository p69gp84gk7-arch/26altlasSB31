/* =====================================================================
   SNOWPARK — Conception de modules (kickers, jibs, boardercross)
   =====================================================================
   Module repris de l'éditeur « Snowpark Designer » et intégré ici :
     • même carte, même MNT, même chaîne d'export que le terrassement ;
     • le cubage neige d'un module devient un tracé mesurable comme les
       autres (il alimente le récapitulatif et le rapport PDF) ;
     • analyse balistique : trajectoire, temps de vol, portée, vitesse
       d'impact, hauteur de chute équivalente (EFH) et facteur de charge.

   RAPPEL SÉCURITÉ : l'EFH (Equivalent Fall Height) est l'indicateur de
   référence pour dimensionner une réception. En pratique on vise EFH ≤ 1 m
   sur toute la zone d'atterrissage. Les valeurs affichées sont issues d'un
   modèle balistique sans frottement : elles servent au dimensionnement
   préliminaire, pas à la validation réglementaire d'un ouvrage.
   ===================================================================== */

'use strict';

const SNOWPARK = (() => {

  const G = 9.81;

  const CATALOG = {
    'Kicker S':      { type: 'jump',     speed: 25, width: 6,  kickLen: 3, kickAngle: 15, tableLen: 4,  landLen: 8,  landingAngle: 25, color: '#0e639c', label: 'Table S — débutant' },
    'Kicker M':      { type: 'jump',     speed: 38, width: 8,  kickLen: 4, kickAngle: 25, tableLen: 8,  landLen: 12, landingAngle: 28, color: '#f39c12', label: 'Table M — intermédiaire' },
    'Kicker L':      { type: 'jump',     speed: 52, width: 12, kickLen: 6, kickAngle: 32, tableLen: 14, landLen: 18, landingAngle: 32, color: '#c0392b', label: 'Table L — expert' },
    'Step-Up':       { type: 'gap_jump', speed: 40, width: 8,  kickLen: 4, kickAngle: 35, tableLen: 4,  landLen: 12, landingAngle: 25, landEntryHeight: 2.5,  color: '#27ae60', label: 'Step-up (gap montant)' },
    'Step-Down':     { type: 'gap_jump', speed: 36, width: 8,  kickLen: 4, kickAngle: 20, tableLen: 6,  landLen: 15, landingAngle: 30, landEntryHeight: -2,   color: '#d35400', label: 'Step-down (gap descendant)' },
    'Box Plate':     { type: 'jib', subtype: 'flat',    speed: 20, width: 2.5, kickLen: 2, kickAngle: 5,  landLen: 6, landingAngle: 20, gapDist: 1, gapOutDist: 1, boxLen: 6, boxHeight: 0.5, boxAngle: 0, color: '#8e44ad', label: 'Box plate / rail' },
    'Box Rainbow':   { type: 'jib', subtype: 'rainbow', speed: 20, width: 2.5, kickLen: 2, kickAngle: 15, landLen: 6, landingAngle: 20, gapDist: 1, gapOutDist: 1, boxLen: 6, boxHeight: 1.5, boxAngle: 0, color: '#9b59b6', label: 'Box rainbow' },
    'Virage relevé': { type: 'turn',     speed: 35, width: 8,  turnRadius: 15, turnAngle: 90, turnDir: 1, turnBankAngle: 30, color: '#e67e22', label: 'Virage relevé (boardercross)' }
  };

  let selectedId = null;
  let placing = null;
  let chart = null;
  let moving = false;

  /* ---------------- Géométrie ---------------- */

  const P = (lng, lat) => turf.point([lng, lat]);
  const toLeaflet = ring => ring.map(c => [c[1], c[0]]);

  /** Emprise rectangulaire d'un module (largeur × longueur), orientée. */
  function rectFootprint(f) {
    const p = f.props;
    const len = totalLength(f);
    const c = P(p.lng, p.lat);
    // Le centre saisi est le milieu du module ; on construit l'axe amont→aval
    const up = turf.destination(c, len / 2, p.rotation + 180, { units: 'meters' });
    const dn = turf.destination(c, len / 2, p.rotation, { units: 'meters' });
    const w = p.width / 2;
    return [
      turf.destination(up, w, p.rotation + 90, { units: 'meters' }).geometry.coordinates,
      turf.destination(dn, w, p.rotation + 90, { units: 'meters' }).geometry.coordinates,
      turf.destination(dn, w, p.rotation - 90, { units: 'meters' }).geometry.coordinates,
      turf.destination(up, w, p.rotation - 90, { units: 'meters' }).geometry.coordinates
    ].map(c2 => c2.slice());
  }

  /** Emprise en croissant d'un virage relevé. */
  function turnFootprint(f) {
    const p = f.props;
    const c = P(p.lng, p.lat);
    const rIn = p.turnRadius, rOut = p.turnRadius + p.width;
    const dir = p.turnDir || 1;
    const steps = 24;
    const inner = [], outer = [];
    for (let i = 0; i <= steps; i++) {
      const a = p.rotation - 90 + (p.turnAngle * dir * i) / steps;
      inner.push(turf.destination(c, rIn, a, { units: 'meters' }).geometry.coordinates);
      outer.push(turf.destination(c, rOut, a, { units: 'meters' }).geometry.coordinates);
    }
    return [...inner, ...outer.reverse()];
  }

  function footprint(f) {
    return f.props.type === 'turn' ? turnFootprint(f) : rectFootprint(f);
  }

  function totalLength(f) {
    const p = f.props;
    if (p.type === 'jib') return p.kickLen + p.gapDist + p.boxLen + p.gapOutDist + p.landLen;
    if (p.type === 'turn') return p.turnRadius * (p.turnAngle * Math.PI / 180);
    return p.kickLen + p.tableLen + p.landLen;
  }

  /**
   * Orientation réelle : le module « descend » toujours.
   * On lit les altitudes aux deux extrémités de l'axe et on oriente
   * l'analyse de l'amont vers l'aval.
   */
  function orientation(f) {
    const p = f.props;
    const c = P(p.lng, p.lat);
    if (p.type === 'turn') {
      const a0 = p.rotation - 90;
      const a1 = a0 + p.turnAngle * (p.turnDir || 1);
      const rMid = p.turnRadius + p.width / 2;
      const e = turf.destination(c, rMid, a0, { units: 'meters' });
      const x = turf.destination(c, rMid, a1, { units: 'meters' });
      const ze = getZLL(e.geometry.coordinates[1], e.geometry.coordinates[0]) ?? 0;
      const zx = getZLL(x.geometry.coordinates[1], x.geometry.coordinates[0]) ?? 0;
      const len = rMid * Math.abs(p.turnAngle) * Math.PI / 180;
      return { entry: e, exit: x, zEntry: ze, zExit: zx, bearing: turf.bearing(e, x), len, slope: Math.atan2(zx - ze, len || 1) };
    }
    const len = totalLength(f);
    let a = turf.destination(c, len / 2, p.rotation + 180, { units: 'meters' });
    let b = turf.destination(c, len / 2, p.rotation, { units: 'meters' });
    let za = getZLL(a.geometry.coordinates[1], a.geometry.coordinates[0]) ?? 0;
    let zb = getZLL(b.geometry.coordinates[1], b.geometry.coordinates[0]) ?? 0;
    if (zb > za) { [a, b] = [b, a]; [za, zb] = [zb, za]; }   // toujours amont → aval
    return { entry: a, exit: b, zEntry: za, zExit: zb, bearing: turf.bearing(a, b), len, slope: Math.atan2(zb - za, len || 1) };
  }

  /* ---------------- Profil en long du module ---------------- */

  /**
   * Calcule, le long de l'axe, l'altitude du terrain, la cote de la neige
   * façonnée (le module) et la trajectoire du pratiquant.
   */
  function analyse(f) {
    const p = f.props;
    const o = orientation(f);
    const projD = p.projectionDist;
    const steps = 220;

    let origin, bearing, total, dOffset;
    if (p.type === 'turn') {
      origin = P(p.lng, p.lat);
      const mid = turf.destination(origin, 1, p.rotation - 90 + p.turnAngle * (p.turnDir || 1) / 2, { units: 'meters' });
      bearing = turf.bearing(origin, mid);
      total = p.turnRadius + p.width + projD;
      dOffset = 0;                       // d mesuré depuis le centre de rotation
    } else {
      origin = turf.destination(o.entry, projD, o.bearing + 180, { units: 'meters' });
      bearing = o.bearing;
      total = projD * 2 + o.len;
      dOffset = projD;                   // d = 0 au pied du tremplin
    }

    const dx = total / steps;
    const pk = [], terrain = [], snow = [], traj = [], geo = [];

    // --- 1re passe : relevé du terrain naturel le long de l'axe -------------
    // (indispensable pour caler le tremplin sur le sol RÉEL et non sur une
    //  pente théorique : sinon, sur un terrain bombé, la lèvre du tremplin se
    //  retrouve sous le sol et le pratiquant « atterrit » dès le décollage.)
    for (let i = 0; i <= steps; i++) {
      const d = i * dx;
      const pt = turf.destination(origin, d, bearing, { units: 'meters' });
      const [lng, lat] = pt.geometry.coordinates;
      geo.push({ lat, lng });
      const zT = getZLL(lat, lng);
      terrain.push(isValidZ(zT) ? zT : null);
      pk.push(+(d - dOffset).toFixed(2));
    }
    const terrainAtRel = rel => {
      const i = Math.max(0, Math.min(steps, Math.round((rel + dOffset) / dx)));
      return terrain[i];
    };

    // Paramètres du tremplin
    const baseSnow = (p.baseSnow || 0) / 100;
    const zGround0 = terrainAtRel(0);
    const zStart = (isValidZ(zGround0) ? zGround0 : o.zEntry) + baseSnow;
    const slope = o.slope;
    let thetaDeg = p.kickAngle ?? 15;
    const slopeDeg = slope * 180 / Math.PI;
    if (thetaDeg <= slopeDeg) thetaDeg = slopeDeg + 5;      // le tremplin doit relever
    const theta = thetaDeg * Math.PI / 180;
    const kickLen = p.kickLen ?? 3;
    const aKick = (Math.tan(theta) - Math.tan(slope)) / (2 * Math.max(0.5, kickLen));
    // La lèvre ne peut pas être sous le sol réel
    const zLipTheo = zStart + kickLen * Math.tan(slope) + aKick * kickLen * kickLen;
    const zGroundLip = terrainAtRel(kickLen);
    const zLip = Math.max(zLipTheo, (isValidZ(zGroundLip) ? zGroundLip : -Infinity) + baseSnow);

    // Niveau du sol au rayon intérieur du virage (référence du mur relevé)
    const zTurnInnerRaw = p.type === 'turn' ? terrainAtRel(p.turnRadius) : null;
    const zTurnInner = (isValidZ(zTurnInnerRaw) ? zTurnInnerRaw : o.zEntry) + baseSnow;

    const v0 = (p.speed || 40) / 3.6;
    let state = 'RUNUP';
    let simX = kickLen, simZ = zLip + 1, vx = v0 * Math.cos(theta), vz = v0 * Math.sin(theta);
    const impact = { time: 0, dist: 0, vImpact: 0, efh: 0, gforce: 0, amplitude: 0 };
    let sectionArea = 0, sectionCut = 0;

    // --- 2e passe : modelé neige et balistique ------------------------------
    for (let i = 0; i <= steps; i++) {
      const d = i * dx;
      const zTv = terrain[i];
      const rel = d - dOffset;

      const base = (zTv ?? 0) + baseSnow;
      let zS = null;

      if (p.type === 'turn') {
        const R = p.turnRadius, Wd = p.width;
        if (d >= R && d <= R + Wd) {
          // Le mur se construit à partir du sol réel au rayon intérieur, et non
          // d'une altitude fixe : sinon le cubage intègre toute la pente du
          // versant et surestime massivement le volume de neige.
          zS = zTurnInner + (d - R) * Math.tan(p.turnBankAngle * Math.PI / 180);
        } else if (baseSnow > 0) zS = base;
      } else if (rel < 0) {
        if (baseSnow > 0) zS = base;
      } else if (rel <= kickLen) {
        zS = zStart + rel * Math.tan(slope) + aKick * rel * rel;
      } else if (p.type === 'jump' || p.type === 'gap_jump') {
        const tEnd = kickLen + p.tableLen;
        if (rel <= tEnd) {
          zS = p.type === 'gap_jump' ? base : zLip + (rel - kickLen) * Math.tan(slope);
        } else if (rel <= tEnd + p.landLen) {
          const zGround = zStart + tEnd * Math.tan(slope);
          const zLand = (p.type === 'gap_jump' ? zGround : zLip + p.tableLen * Math.tan(slope)) + (p.landEntryHeight || 0);
          zS = Math.max(base, zLand - (rel - tEnd) * Math.tan(p.landingAngle * Math.PI / 180));
        } else zS = base;
      } else { // jib
        const bs = kickLen + p.gapDist, be = bs + p.boxLen;
        if (rel <= bs) zS = base;
        else if (rel <= be) zS = boxZ(p, rel, bs, zStart, slope);
        else if (rel <= be + p.gapOutDist) zS = base;
        else if (rel <= be + p.gapOutDist + p.landLen) {
          const zLand = zStart + be * Math.tan(slope) + (p.landEntryHeight || 0);
          zS = Math.max(base, zLand - (rel - be - p.gapOutDist) * Math.tan(p.landingAngle * Math.PI / 180));
        } else zS = base;
      }

      // Bilan matière de la section, même convention que le terrassement :
      //   apport  = surface projetée AU-DESSUS du terrain (neige à façonner)
      //   décaiss.= surface projetée EN DESSOUS (terrain à retirer)
      if (zS !== null && zTv !== null) {
        if (zS > zTv) sectionArea += (zS - zTv) * dx;
        else sectionCut += (zTv - zS) * dx;
      }
      snow.push(zS !== null && isValidZ(zS) ? +zS.toFixed(2) : null);

      /* --- Balistique --- */
      const ground = (zS !== null ? zS : zTv);
      if (p.type === 'turn' || ground === null || rel <= kickLen || state === 'LANDED') {
        traj.push(null);
        if (rel > kickLen && state === 'RUNUP' && p.type !== 'turn') state = 'AIR';
        continue;
      }
      if (state === 'RUNUP') state = 'AIR';

      if (state === 'AIR' || state === 'AIR2') {
        const t = (rel - simX) / vx;
        const zR = simZ + vz * t - 0.5 * G * t * t;

        // Réception sur un box : le rider se pose dessus
        if (p.type === 'jib' && state === 'AIR') {
          const bs = kickLen + p.gapDist, be = bs + p.boxLen;
          if (rel > bs && rel <= be) {
            const sz = boxZ(p, rel, bs, zStart, slope);
            if (zR <= sz + 1) { state = 'SLIDE'; traj.push(+(sz + 1).toFixed(2)); continue; }
          }
        }
        if (zR <= ground + 1) {
          state = 'LANDED';
          traj.push(+(ground + 1).toFixed(2));
          const refD = state === 'AIR2' ? simX : kickLen;
          impact.dist = rel - refD;
          impact.time = Math.max(0, (rel - simX) / vx);
          const vzEnd = vz - G * impact.time;
          impact.vImpact = Math.hypot(vx, vzEnd) * 3.6;
          const aTraj = Math.atan2(vzEnd, vx);
          // Pente de la surface de réception au point d'impact
          let aLand = slope;
          const inLanding = p.type === 'jib'
            ? rel > kickLen + p.gapDist + p.boxLen + p.gapOutDist
            : rel > kickLen + p.tableLen;
          if (inLanding) aLand = -p.landingAngle * Math.PI / 180;
          const vPerp = Math.abs(Math.hypot(vx, vzEnd) * Math.sin(aTraj - aLand));
          impact.efh = (vPerp * vPerp) / (2 * G);
          impact.gforce = 1 + (vPerp * vPerp) / (2 * G * 0.4);   // décélération sur 40 cm de neige
          continue;
        }
        traj.push(+zR.toFixed(2));
        impact.amplitude = Math.max(impact.amplitude, zR - ground - 1);
      } else if (state === 'SLIDE') {
        const bs = kickLen + p.gapDist, be = bs + p.boxLen;
        if (rel <= be) { traj.push(+(boxZ(p, rel, bs, zStart, slope) + 1).toFixed(2)); }
        else {
          state = 'AIR2';
          simX = be; simZ = boxZ(p, be, bs, zStart, slope) + 1;
          let exit = (p.boxAngle * Math.PI / 180) + slope;
          if (p.subtype === 'rainbow') {
            const hb = p.boxLen / 2, a = -(p.boxHeight / 2) / (hb * hb);
            exit = Math.atan(2 * a * hb) + slope;
          }
          exit += 5 * Math.PI / 180;                    // « pop » de sortie
          vx = v0 * Math.cos(exit); vz = v0 * Math.sin(exit);
          traj.push(+simZ.toFixed(2));
        }
      }
    }

    // Volume de neige : section × largeur (× longueur d'arc pour un virage)
    const spread = p.type === 'turn'
      ? (p.turnRadius + p.width / 2) * Math.abs(p.turnAngle) * Math.PI / 180
      : p.width;
    const volume = sectionArea * spread;
    const volumeCut = sectionCut * spread;

    // Élan nécessaire en amont pour atteindre la vitesse demandée
    let runup = null;
    const hNeed = (v0 * v0) / (2 * G * 0.9);
    for (let dd = 1; dd < 200; dd += 1) {
      const cp = turf.destination(o.entry, dd, o.bearing + 180, { units: 'meters' });
      const zc = getZLL(cp.geometry.coordinates[1], cp.geometry.coordinates[0]);
      if (isValidZ(zc) && (zc - zStart) >= hNeed) { runup = { dist: dd, lat: cp.geometry.coordinates[1], lng: cp.geometry.coordinates[0] }; break; }
    }

    return { pk, terrain, snow, traj, geo, volume, volumeCut, sectionArea, sectionCut,
             impact, o, zLip, thetaDeg, runup, slopeDeg, spread };
  }

  function boxZ(p, rel, boxStart, zStart, slope) {
    const ground = zStart + boxStart * Math.tan(slope);
    if (p.subtype === 'rainbow') {
      const hb = p.boxLen / 2, di = rel - boxStart;
      const a = -(p.boxHeight / 2) / (hb * hb);
      return ground + p.boxHeight / 2 + p.boxHeight / 2 + a * Math.pow(di - hb, 2);
    }
    return ground + p.boxHeight + (rel - boxStart) * Math.tan(p.boxAngle * Math.PI / 180);
  }

  /* ---------------- Placement / rendu ---------------- */

  function startPlace(key) {
    placing = placing === key ? null : key;
    document.querySelectorAll('[data-mod]').forEach(b => b.classList.toggle('active', b.dataset.mod === placing));
    if (placing) {
      cancelDraw();
      toast(`Cliquez sur la carte pour poser « ${CATALOG[placing].label} ».`, 'info');
      APP.map.getContainer().style.cursor = 'copy';
    } else APP.map.getContainer().style.cursor = '';
  }

  function onMapClick(e) {
    if (moving && selectedId) {
      const f = get(selectedId);
      f.props.lng = e.latlng.lng; f.props.lat = e.latlng.lat;
      moving = false; render(f); renderList(); refresh(f);
      toast('Module déplacé.', 'ok');
      return true;
    }
    if (!placing) return false;
    const n = CATALOG[placing];
    const f = {
      id: uid(), kind: 'park', name: placing + ' ' + (APP.parks.length + 1),
      color: n.color, visible: true,
      props: Object.assign({
        key: placing, rotation: 0, speed: 40, projectionDist: 30, baseSnow: 0,
        kickLen: 3, kickAngle: 15, tableLen: 4, landLen: 8, landingAngle: 25,
        gapDist: 1, gapOutDist: 1, boxLen: 6, boxHeight: 1, boxAngle: 0,
        turnRadius: 15, turnAngle: 90, turnDir: 1, turnBankAngle: 30, landEntryHeight: 0
      }, n, { lng: e.latlng.lng, lat: e.latlng.lat })
    };
    APP.parks.unshift(f);
    startPlace(null);
    render(f); selectedId = f.id; renderList(); openProfile(f.id);
    if (f.layer) APP.map.fitBounds(f.layer.getBounds().pad(2.5));
    return true;
  }

  function get(id) { return APP.parks.find(f => f.id === id); }

  function render(f) {
    if (f.layer) { APP.map.removeLayer(f.layer); f.layer = null; }
    if (f.deco) { APP.map.removeLayer(f.deco); f.deco = null; }
    if (!f.visible) return;

    f.layer = L.polygon(toLeaflet(footprint(f)), {
      color: f.color, weight: 2, fillColor: f.color, fillOpacity: 0.45
    }).addTo(APP.map);
    f.layer.bindTooltip(f.name, { sticky: true });
    f.layer.on('click', () => { selectedId = f.id; renderList(); openProfile(f.id); });

    // Repères : axe de coupe, limites de zones, point d'élan
    const deco = L.layerGroup().addTo(APP.map);
    const o = orientation(f);
    const projD = f.props.projectionDist;
    const a = turf.destination(o.entry, projD, o.bearing + 180, { units: 'meters' }).geometry.coordinates;
    const b = turf.destination(o.exit, projD, o.bearing, { units: 'meters' }).geometry.coordinates;
    L.polyline([[a[1], a[0]], [b[1], b[0]]], { color: '#f1c40f', weight: 1, dashArray: '5,5' }).addTo(deco);

    if (f.props.type !== 'turn') {
      const marks = f.props.type === 'jib'
        ? [f.props.kickLen, f.props.kickLen + f.props.gapDist,
           f.props.kickLen + f.props.gapDist + f.props.boxLen,
           f.props.kickLen + f.props.gapDist + f.props.boxLen + f.props.gapOutDist]
        : [f.props.kickLen, f.props.kickLen + f.props.tableLen];
      marks.forEach(m => {
        const c = turf.destination(o.entry, m, o.bearing, { units: 'meters' });
        const l = turf.destination(c, f.props.width / 2, o.bearing + 90, { units: 'meters' }).geometry.coordinates;
        const r = turf.destination(c, f.props.width / 2, o.bearing - 90, { units: 'meters' }).geometry.coordinates;
        L.polyline([[l[1], l[0]], [r[1], r[0]]], { color: '#fff', weight: 1, dashArray: '3,3' }).addTo(deco);
      });
    }
    if (f.analysis && f.analysis.runup) {
      L.circleMarker([f.analysis.runup.lat, f.analysis.runup.lng],
        { radius: 6, color: '#fff', weight: 2, fillColor: '#27ae60', fillOpacity: 1 })
        .bindTooltip(`Départ conseillé — ${fmt(f.analysis.runup.dist, 0)} m en amont`).addTo(deco);
    }
    f.deco = deco;
  }

  function refresh(f) {
    f.analysis = analyse(f);
    render(f);
    if (selectedId === f.id && document.getElementById('profile-window').style.display !== 'none') drawChart(f);
    updateStats(f);
  }

  function refreshAll() { APP.parks.forEach(f => { if (f.visible) { f.analysis = analyse(f); render(f); } }); }

  /* ---------------- Interface ---------------- */

  function catalogHtml() {
    const groups = {
      'Sauts / tables': ['Kicker S', 'Kicker M', 'Kicker L'],
      'Gaps': ['Step-Up', 'Step-Down'],
      'Jibs': ['Box Plate', 'Box Rainbow'],
      'Boardercross': ['Virage relevé']
    };
    return Object.entries(groups).map(([g, keys]) => `
      <div class="cat-group"><div class="cat-title">${g}</div>
      ${keys.map(k => `<button class="mod-btn" data-mod="${k}" style="--mc:${CATALOG[k].color}" onclick="SNOWPARK.startPlace('${k}')">${CATALOG[k].label}</button>`).join('')}
      </div>`).join('');
  }

  function renderList() {
    const el = document.getElementById('park-list');
    if (!el) return;
    if (!APP.parks.length) {
      el.innerHTML = `<div class="empty">Aucun module.<br><small>Choisissez un module dans le catalogue puis cliquez sur la carte.</small></div>`;
      return;
    }
    el.innerHTML = APP.parks.map(f => {
      const sel = f.id === selectedId;
      return `<div class="card park-card ${sel ? 'sel' : ''}" style="--fc:${f.color}">
        <div class="card-head">
          <label class="chk"><input type="checkbox" ${f.visible ? 'checked' : ''} onchange="SNOWPARK.toggle(${f.id})"></label>
          <button class="feat-name" onclick="SNOWPARK.select(${f.id})">${escapeHtml(f.name)}</button>
          <span class="tag">${escapeHtml(CATALOG[f.props.key]?.label.split('—')[0].trim() || f.props.type)}</span>
          <button class="icon-btn danger" onclick="SNOWPARK.remove(${f.id})">✕</button>
        </div>
        ${sel ? propsHtml(f) : `<div class="park-mini" id="park-mini-${f.id}"></div>`}
      </div>`;
    }).join('');
    APP.parks.forEach(f => { if (f.id !== selectedId) miniStats(f); });
    if (selectedId) { const f = get(selectedId); if (f) updateStats(f); }
  }

  function miniStats(f) {
    const el = document.getElementById('park-mini-' + f.id);
    if (!el) return;
    if (!f.analysis) f.analysis = analyse(f);
    const a = f.analysis;
    el.innerHTML = `<span>Neige : <b>${fmt(a.volume, 0)} m³</b></span>` +
      (a.volumeCut > 1 ? ` · <span>décaiss. <b>${fmt(a.volumeCut, 0)} m³</b></span>` : '') +
      ` · <span>EFH : <b class="${efhClass(a.impact.efh)}">${a.impact.efh ? fmt(a.impact.efh, 2) + ' m' : '—'}</b></span>`;
  }

  function sl(f, key, label, min, max, step, unit = '') {
    return `<label class="slider-row"><span>${label}</span><span class="sv" id="sv-${key}">${fmt(f.props[key], step < 1 ? 1 : 0)} ${unit}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${f.props[key]}"
             oninput="SNOWPARK.setProp(${f.id},'${key}',this.value)"></label>`;
  }

  function propsHtml(f) {
    const t = f.props.type;
    let s = `<div class="park-props">
      <div class="btn-row">
        <button class="btn tiny ${moving ? 'on' : ''}" onclick="SNOWPARK.toggleMove()">${moving ? '📍 Cliquez la nouvelle position' : '✥ Déplacer'}</button>
        <button class="btn tiny" onclick="SNOWPARK.openProfile(${f.id})">📈 Profil & balistique</button>
        <input type="color" class="swatch" value="${f.color}" onchange="SNOWPARK.setColor(${f.id},this.value)">
      </div>
      ${sl(f, 'rotation', 'Orientation', 0, 359, 1, '°')}
      ${sl(f, 'width', 'Largeur', 1, 40, 0.5, 'm')}
      ${sl(f, 'baseSnow', 'Épaisseur de neige de base', 0, 300, 5, 'cm')}`;

    if (t !== 'turn') {
      s += `<div class="sub">Tremplin</div>
        ${sl(f, 'kickLen', 'Longueur d’appel', 1, 25, 0.5, 'm')}
        ${sl(f, 'kickAngle', 'Angle d’appel', 0, 60, 0.5, '°')}`;
    }
    if (t === 'jump' || t === 'gap_jump') {
      s += `<div class="sub">${t === 'gap_jump' ? 'Gap' : 'Table'}</div>${sl(f, 'tableLen', t === 'gap_jump' ? 'Longueur du gap' : 'Longueur de table', 0, 50, 0.5, 'm')}`;
    }
    if (t === 'jib') {
      s += `<div class="sub">Module jib</div>
        ${sl(f, 'gapDist', 'Distance appel → box', 0, 15, 0.5, 'm')}
        ${sl(f, 'boxLen', 'Longueur du box', 2, 25, 0.5, 'm')}
        ${sl(f, 'boxHeight', 'Hauteur du box', 0, 4, 0.1, 'm')}
        ${sl(f, 'boxAngle', 'Inclinaison du box', -30, 30, 0.5, '°')}
        ${sl(f, 'gapOutDist', 'Distance box → réception', 0, 15, 0.5, 'm')}`;
    }
    if (t === 'turn') {
      s += `<div class="sub">Virage</div>
        <button class="btn tiny" onclick="SNOWPARK.flipTurn(${f.id})">↔️ Inverser le sens</button>
        ${sl(f, 'turnRadius', 'Rayon', 5, 60, 1, 'm')}
        ${sl(f, 'turnAngle', 'Angle d’arc', 30, 180, 5, '°')}
        ${sl(f, 'turnBankAngle', 'Dévers du mur', 0, 75, 1, '°')}`;
    } else {
      s += `<div class="sub">Réception</div>
        ${sl(f, 'landLen', 'Longueur de réception', 2, 60, 0.5, 'm')}
        ${sl(f, 'landingAngle', 'Pente de réception', 0, 55, 0.5, '°')}
        ${sl(f, 'landEntryHeight', 'Décalage d’entrée (knoll)', -15, 15, 0.5, 'm')}`;
    }
    s += `<div class="sub">Analyse</div>
      ${sl(f, 'speed', 'Vitesse pratiquant', 5, 100, 1, 'km/h')}
      ${sl(f, 'projectionDist', 'Longueur du plan de coupe', 10, 150, 1, 'm')}
      <div class="stats-box" id="park-stats-${f.id}"></div>
      <div class="btn-row">
        <button class="btn tiny" onclick="SNOWPARK.toFeature(${f.id})">➕ Convertir en surface mesurable</button>
      </div>
    </div>`;
    return s;
  }

  function efhClass(e) { return !e ? '' : e <= 1 ? 'ok' : e <= 1.5 ? 'warn' : 'bad'; }

  function updateStats(f) {
    const el = document.getElementById('park-stats-' + f.id);
    if (!el) { miniStats(f); return; }
    if (!f.analysis) f.analysis = analyse(f);
    const a = f.analysis, i = a.impact;
    const efhTxt = i.efh ? `${fmt(i.efh, 2)} m` : '—';
    el.innerHTML = `
      <div class="sb-row"><span>Neige à façonner (apport)</span><b>${fmt(a.volume, 0)} m³</b></div>
      <div class="sb-row"><span>Terrain à décaisser</span><b>${fmt(a.volumeCut, 0)} m³</b></div>
      <div class="sb-row"><span>Section apport / décaiss.</span><b>${fmt(a.sectionArea, 1)} / ${fmt(a.sectionCut, 1)} m²</b></div>
      <div class="sb-row"><span>Pente naturelle</span><b>${fmt(a.slopeDeg, 1)} °</b></div>
      <div class="sb-row"><span>Angle d’appel effectif</span><b>${fmt(a.thetaDeg, 1)} °</b></div>
      <hr>
      <div class="sb-row"><span>Temps de vol</span><b>${i.time ? fmt(i.time, 2) + ' s' : '—'}</b></div>
      <div class="sb-row"><span>Portée</span><b>${i.dist ? fmt(i.dist, 1) + ' m' : '—'}</b></div>
      <div class="sb-row"><span>Amplitude max</span><b>${i.amplitude ? fmt(i.amplitude, 1) + ' m' : '—'}</b></div>
      <div class="sb-row"><span>Vitesse d’impact</span><b>${i.vImpact ? fmt(i.vImpact, 1) + ' km/h' : '—'}</b></div>
      <div class="sb-row hl"><span>EFH (hauteur de chute éq.)</span><b class="${efhClass(i.efh)}">${efhTxt}</b></div>
      <div class="sb-row"><span>Facteur de charge</span><b class="${efhClass(i.efh)}">${i.gforce > 1 ? fmt(i.gforce, 1) + ' g' : '—'}</b></div>
      <div class="sb-note">${i.efh ? (i.efh <= 1 ? '✅ Réception conforme à l’objectif EFH ≤ 1 m.'
        : i.efh <= 1.5 ? '⚠️ EFH élevée : allonger ou redresser la réception.'
        : '⛔ EFH excessive : réception à revoir (pente/longueur) ou vitesse à réduire.') : 'Réglez la vitesse et la géométrie pour obtenir une analyse.'}</div>
      ${a.runup ? `<div class="sb-note">Départ conseillé : ${fmt(a.runup.dist, 0)} m en amont du tremplin.</div>` : ''}
      ${a.volumeCut > a.volume ? `<div class="sb-note">⚠️ Le terrain naturel est plus haut que le modelé projeté : ce module demande surtout du décaissement. Vérifiez l'orientation.</div>` : ''}`;
  }

  /* ---------------- Actions ---------------- */

  function setProp(id, key, val) {
    const f = get(id); if (!f) return;
    f.props[key] = parseFloat(val);
    const sv = document.getElementById('sv-' + key);
    if (sv) sv.textContent = fmt(f.props[key], Math.abs(f.props[key]) < 10 ? 1 : 0) + ' ' + (sv.textContent.split(' ').pop() || '');
    refresh(f);
  }
  function setColor(id, c) { const f = get(id); if (!f) return; f.color = c; render(f); }
  function select(id) { selectedId = (selectedId === id ? null : id); moving = false; renderList(); if (selectedId) openProfile(id); }
  function toggle(id) { const f = get(id); if (!f) return; f.visible = !f.visible; render(f); }
  function toggleMove() { moving = !moving; renderList(); if (moving) toast('Cliquez sur la carte pour repositionner le module.', 'info'); }
  function flipTurn(id) { const f = get(id); if (!f) return; f.props.turnDir = -(f.props.turnDir || 1); refresh(f); }
  function remove(id) {
    const f = get(id); if (!f) return;
    if (!confirm(`Supprimer « ${f.name} » ?`)) return;
    if (f.layer) APP.map.removeLayer(f.layer);
    if (f.deco) APP.map.removeLayer(f.deco);
    APP.parks = APP.parks.filter(x => x.id !== id);
    if (selectedId === id) selectedId = null;
    renderList();
  }

  /** Transforme l'emprise du module en surface mesurable (cubature, export). */
  function toFeature(id) {
    const f = get(id); if (!f) return;
    const ring = footprint(f);
    const d = newFeature({
      type: 'area', name: f.name + ' (emprise)', color: f.color,
      ptsGPS: ring.map(c => ({ lat: c[1], lng: c[0] }))
    });
    APP.draws.unshift(d); redrawFeature(d); refreshStats(d); renderDrawList();
    toast('Emprise ajoutée aux tracés : cubature et exports disponibles.', 'ok');
  }

  /* ---------------- Profil ---------------- */

  function openProfile(id) {
    const f = get(id); if (!f) return;
    if (!hasMNT()) { toast('Activez un MNT pour analyser un module.', 'warn'); return; }
    selectedId = id;
    f.analysis = analyse(f);
    document.getElementById('profile-window').style.display = 'flex';
    document.getElementById('profile-title').textContent = `Profil module — ${f.name}`;
    document.getElementById('profile-window').classList.add('park-mode');
    document.getElementById('profile-mode-terra').style.display = 'none';
    document.getElementById('profile-mode-park').style.display = 'flex';
    drawChart(f);
    render(f); updateStats(f);
    setTimeout(() => chart && chart.resize(), 60);
  }

  function drawChart(f) {
    const cv = document.getElementById('profileChart');
    const prev = Chart.getChart(cv); if (prev) prev.destroy();
    const a = f.analysis;
    const col = a.impact.efh <= 1 ? '#2ecc71' : a.impact.efh <= 1.5 ? '#f39c12' : '#e74c3c';

    chart = new Chart(cv.getContext('2d'), {
      type: 'line',
      data: {
        labels: a.pk,
        datasets: [
          { label: 'Terrain naturel', data: a.terrain, borderColor: '#7f8c8d', backgroundColor: '#7f8c8d33', fill: 'start', pointRadius: 0, borderWidth: 2, tension: 0.2, order: 4, spanGaps: true },
          { label: 'Neige façonnée', data: a.snow, borderColor: f.color, backgroundColor: f.color + '55', fill: 0, pointRadius: 0, borderWidth: 2, tension: 0.15, order: 3, spanGaps: false },
          { label: 'Trajectoire', data: a.traj, borderColor: col, borderDash: [6, 4], pointRadius: 0, borderWidth: 3, fill: false, tension: 0.25, order: 1, spanGaps: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { title: { display: true, text: 'Distance le long de l’axe (m) — 0 au pied du tremplin' }, ticks: { maxTicksLimit: 14 } },
          y: { title: { display: true, text: 'Altitude NGF (m)' } }
        },
        plugins: { legend: { labels: { boxWidth: 12 } } },
        onHover: (e, els) => {
          if (els && els.length) {
            const g = a.geo[els[0].index];
            if (g) hoverMap(g.lat, g.lng);
          }
        }
      }
    });
  }

  let hov = null;
  function hoverMap(lat, lng) {
    if (!hov) hov = L.circleMarker([lat, lng], { radius: 7, color: '#e74c3c', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(APP.map);
    else hov.setLatLng([lat, lng]);
  }

  /* ---------------- Sérialisation ---------------- */

  function restore(list) {
    (list || []).forEach(o => {
      const f = { id: uid(), kind: 'park', name: o.name, color: o.color, visible: o.visible !== false, props: { ...o.props } };
      APP.parks.push(f); render(f);
    });
    renderList();
  }

  function exportCSV() {
    if (!APP.parks.length) return toast('Aucun module.', 'warn');
    let csv = 'Module;Type;Largeur_m;Longueur_m;Neige_apport_m3;Decaissement_m3;Section_m2;Vitesse_kmh;Portee_m;Airtime_s;V_impact_kmh;EFH_m;Charge_g;Lon;Lat\n';
    APP.parks.forEach(f => {
      const a = f.analysis || analyse(f);
      csv += [f.name, f.props.type, csvNum(f.props.width, 1), csvNum(totalLength(f), 1),
        csvNum(a.volume, 1), csvNum(a.volumeCut, 1), csvNum(a.sectionArea, 2), csvNum(f.props.speed, 0),
        csvNum(a.impact.dist, 1), csvNum(a.impact.time, 2), csvNum(a.impact.vImpact, 1),
        csvNum(a.impact.efh, 2), csvNum(a.impact.gforce, 2),
        csvNum(f.props.lng, 7), csvNum(f.props.lat, 7)].join(';') + '\n';
    });
    const tot = APP.parks.reduce((s, f) => s + (f.analysis || analyse(f)).volume, 0);
    csv += `\nTOTAL neige (m3);${csvNum(tot, 1)}\n`;
    EXPORTS.saveText(csv, `snowpark_${EXPORTS.stamp()}.csv`, 'text/csv;charset=utf-8');
    toast('Modules exportés en CSV.', 'ok');
  }

  return {
    CATALOG, catalogHtml, renderList, startPlace, onMapClick, setProp, setColor,
    select, toggle, toggleMove, flipTurn, remove, toFeature, openProfile,
    refreshAll, restore, exportCSV, analyse, get, footprint, totalLength
  };
})();

window.SNOWPARK = SNOWPARK;
