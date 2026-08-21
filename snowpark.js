/* =====================================================================
   SNOWPARK — Conception de modules et analyse balistique
   =====================================================================
   PRINCIPE
   Chaque module expose un CHAMP D'ALTITUDE 2D : `zAt(module, X, Y)` donne la
   cote projetée en tout point Lambert-93. Tout en découle :
     • le cubage (intégration sur une grille, comme le terrassement) ;
     • l'affichage en vue 3D (les modules apparaissent posés sur le terrain) ;
     • le profil en long (échantillonnage le long de l'axe) ;
     • la balistique, qui « voit » les autres modules posés devant.

   Conséquence directe : un tremplin, un box et une réception posés séparément
   s'enchaînent naturellement — la trajectoire décolle du tremplin, se pose sur
   le box, puis atterrit sur la réception, sans qu'ils forment un seul objet.

   La couche de neige de base (`baseSnow`) est intégrée au champ : elle compte
   donc dans le volume, sur toute l'emprise du module.

   SÉCURITÉ : l'EFH (hauteur de chute équivalente) est l'indicateur de
   dimensionnement des réceptions ; on vise EFH ≤ 1 m. Le modèle est balistique
   sans frottement : dimensionnement préliminaire, pas validation d'ouvrage.
   ===================================================================== */

'use strict';

const SNOWPARK = (() => {

  const G = 9.81;
  const D2R = Math.PI / 180;

  /* ==================================================================
     CATALOGUE
     ================================================================== */

  /** Valeurs communes à tous les modules. */
  const COMMON = {
    rotation: 0, width: 8, talus: 2, baseSnow: 0,
    speed: 40, projectionDist: 30
  };

  const CATALOG = {
    /* --- Tremplins --------------------------------------------------- */
    'Tremplin seul': {
      kind: 'takeoff', color: '#2980b9', group: 'Tremplins',
      label: 'Tremplin seul (kick)',
      help: 'Table de décollage isolée : à combiner avec un box et/ou une réception.',
      p: { width: 6, kickLen: 4, kickAngle: 25, speed: 35 }
    },
    'Table S': {
      kind: 'table', color: '#0e639c', group: 'Tremplins',
      label: 'Table S — débutant',
      p: { width: 6, kickLen: 3, kickAngle: 15, tableLen: 4, landLen: 8, landingAngle: 25, knollH: 0, speed: 25 }
    },
    'Table M': {
      kind: 'table', color: '#f39c12', group: 'Tremplins',
      label: 'Table M — intermédiaire',
      p: { width: 8, kickLen: 4, kickAngle: 25, tableLen: 8, landLen: 12, landingAngle: 28, knollH: 0, speed: 38 }
    },
    'Table L': {
      kind: 'table', color: '#c0392b', group: 'Tremplins',
      label: 'Table L — expert',
      p: { width: 12, kickLen: 6, kickAngle: 32, tableLen: 14, landLen: 18, landingAngle: 32, knollH: 0, speed: 52 }
    },
    /* --- Gaps -------------------------------------------------------- */
    'Step-up': {
      kind: 'gap', color: '#27ae60', group: 'Gaps',
      label: 'Step-up (gap montant)',
      p: { width: 8, kickLen: 4, kickAngle: 35, gapLen: 4, landLen: 12, landingAngle: 25, landEntryHeight: 2.5, speed: 40 }
    },
    'Step-down': {
      kind: 'gap', color: '#d35400', group: 'Gaps',
      label: 'Step-down (gap descendant)',
      p: { width: 8, kickLen: 4, kickAngle: 20, gapLen: 6, landLen: 15, landingAngle: 30, landEntryHeight: -2, speed: 36 }
    },
    /* --- Réceptions -------------------------------------------------- */
    'Réception seule': {
      kind: 'landing', color: '#16a085', group: 'Réceptions',
      label: 'Réception seule (landing)',
      help: 'Butte + pente de réception, à positionner librement derrière un tremplin ou un box.',
      p: { width: 8, knollLen: 3, knollH: 0.8, landLen: 12, landingAngle: 28 }
    },
    /* --- Jibs -------------------------------------------------------- */
    'Box / rail': {
      kind: 'jib', color: '#8e44ad', group: 'Jibs',
      label: 'Box / rail (profil réglable)',
      help: 'Structure seule. Le profil (plat, arc-en-ciel, montée, descente…) et toutes les cotes sont réglables.',
      p: {
        width: 2.5, talus: 1, jibShape: 'flat', railType: 'box',
        boxH: 0.5, segA: 2, segB: 6, segC: 2, angA: 12, angC: 12, boxRise: 1.2,
        snowBase: 1, speed: 20
      }
    },
    /* --- Boardercross / freeride ------------------------------------- */
    'Virage relevé': {
      kind: 'turn', color: '#e67e22', group: 'Boardercross',
      label: 'Virage relevé (banked turn)',
      p: { width: 8, turnRadius: 15, turnAngle: 90, turnDir: 1, turnBankAngle: 30, speed: 35 }
    },
    'Rouleaux / bosses': {
      kind: 'roller', color: '#2c9c8f', group: 'Boardercross',
      label: 'Rouleaux (whoops)',
      p: { width: 8, rollerLen: 8, rollerH: 1.2, rollerCount: 3, speed: 30 }
    },
    'Spine': {
      kind: 'spine', color: '#9b59b6', group: 'Freestyle',
      label: 'Spine (arête)',
      p: { width: 10, spineLen: 14, spineH: 2.5, noseLen: 4, speed: 30 }
    },
    'Quarter pipe': {
      kind: 'quarter', color: '#c0507a', group: 'Freestyle',
      label: 'Quarter pipe',
      p: { width: 10, qRadius: 4, qHeight: 3.5, qFlat: 3, speed: 35 }
    }
  };

  /** Profils disponibles pour un box / rail. */
  const JIB_SHAPES = {
    flat: 'Plat',
    rainbow: 'Arc-en-ciel (rainbow)',
    up: 'Montée',
    down: 'Descente',
    flat_down: 'Plat + descente',
    up_flat: 'Montée + plat',
    up_flat_down: 'Montée + plat + descente',
    down_flat_down: 'Descente + plat + descente (kink)'
  };

  const JIB_TYPES = { box: 'Box (large)', rail: 'Rail (tube)', wallride: 'Wall-ride' };

  let selectedId = null;
  let placing = null;
  let chart = null;
  let handles = null;          // poignées de manipulation sur la carte

  /* ==================================================================
     REPÈRE LOCAL D'UN MODULE
     ================================================================== */

  /** Longueur totale du module le long de son axe. */
  function moduleLength(p) {
    switch (p.kind) {
      case 'takeoff': return p.kickLen;
      case 'table': return p.kickLen + p.tableLen + p.landLen;
      case 'gap': return p.kickLen + p.gapLen + p.landLen;
      case 'landing': return p.knollLen + p.landLen;
      case 'jib': return jibSegments(p).reduce((a, s) => a + s.len, 0);
      case 'turn': return (p.turnRadius + p.width / 2) * Math.abs(p.turnAngle) * D2R;
      case 'roller': return p.rollerLen * p.rollerCount;
      case 'spine': return p.noseLen + p.spineLen;
      case 'quarter': return p.qFlat + p.qRadius;
      default: return 10;
    }
  }

  /** Découpage longitudinal d'un box selon son profil. */
  function jibSegments(p) {
    const A = { len: Math.max(0.1, p.segA), ang: p.angA };
    const B = { len: Math.max(0.1, p.segB), ang: 0 };
    const C = { len: Math.max(0.1, p.segC), ang: -p.angC };
    switch (p.jibShape) {
      case 'flat': return [{ len: p.segA + p.segB + p.segC, ang: 0 }];
      case 'rainbow': return [{ len: p.segA + p.segB + p.segC, ang: 0, arc: true }];
      case 'up': return [{ len: p.segA + p.segB + p.segC, ang: p.angA }];
      case 'down': return [{ len: p.segA + p.segB + p.segC, ang: -p.angC }];
      case 'flat_down': return [{ len: p.segA + p.segB, ang: 0 }, C];
      case 'up_flat': return [A, { len: p.segB + p.segC, ang: 0 }];
      case 'up_flat_down': return [A, B, C];
      case 'down_flat_down': return [{ len: p.segA, ang: -p.angA }, B, C];
      default: return [{ len: p.segA + p.segB + p.segC, ang: 0 }];
    }
  }

  /**
   * Repère métrique du module en Lambert-93.
   * Recalculé à chaque modification : il porte l'axe, la longueur et les
   * altitudes de référence lues dans le MNT.
   */
  function frameOf(f) {
    const p = f.props;
    const c = toL93(p.lng, p.lat);
    const len = moduleLength(p);

    // Direction de l'axe en L93 (le nord de grille diffère du nord géographique)
    const cg = turf.point([p.lng, p.lat]);
    const ahead = turf.destination(cg, 50, p.rotation, { units: 'meters' }).geometry.coordinates;
    const a93 = toL93(ahead[0], ahead[1]);
    let ux = a93[0] - c[0], uy = a93[1] - c[1];
    const n = Math.hypot(ux, uy) || 1;
    ux /= n; uy /= n;

    // Point d'entrée = amont de l'axe
    const ex = c[0] - ux * len / 2, ey = c[1] - uy * len / 2;
    const xx = c[0] + ux * len / 2, xy = c[1] + uy * len / 2;

    const z0raw = getZ([ex, ey]);
    const z1raw = getZ([xx, xy]);
    const z0 = isValidZ(z0raw) ? z0raw : (isValidZ(z1raw) ? z1raw : 0);
    const z1 = isValidZ(z1raw) ? z1raw : z0;
    const slope = Math.atan2(z1 - z0, len || 1);   // < 0 : le module descend

    return {
      cx: c[0], cy: c[1], ex, ey, xx, xy, ux, uy,
      vx: -uy, vy: ux, len, z0, z1, slope,
      base: (p.baseSnow || 0) / 100
    };
  }

  function ensureFrame(f) {
    if (!f._frame || f._dirty) { f._frame = frameOf(f); f._dirty = false; }
    return f._frame;
  }
  function touch(f) { f._dirty = true; }

  /* ==================================================================
     PROFIL LONGITUDINAL (cote projetée sur l'axe, u en mètres)
     ================================================================== */

  /**
   * Cote projetée sur l'axe du module.
   * @returns {number|null} altitude, ou null hors du module
   */
  function axisZ(f, u) {
    const p = f.props, fr = ensureFrame(f);
    const g = uz => { const z = getZ([fr.ex + fr.ux * uz, fr.ey + fr.uy * uz]); return isValidZ(z) ? z + fr.base : fr.z0 + fr.base; };
    const z0 = fr.z0 + fr.base;
    const tanS = Math.tan(fr.slope);

    switch (p.kind) {
      case 'takeoff': return kickZ(p, fr, u, z0, tanS);

      case 'table': {
        const kl = p.kickLen, tEnd = kl + p.tableLen;
        if (u <= kl) return kickZ(p, fr, u, z0, tanS);
        const zLip = kickZ(p, fr, kl, z0, tanS);
        if (u <= tEnd) return zLip + (u - kl) * tanS;
        const zLand = zLip + p.tableLen * tanS + (p.knollH || 0);
        return Math.max(g(u), zLand - (u - tEnd) * Math.tan(p.landingAngle * D2R));
      }

      case 'gap': {
        const kl = p.kickLen, gEnd = kl + p.gapLen;
        if (u <= kl) return kickZ(p, fr, u, z0, tanS);
        if (u <= gEnd) return g(u);                       // le gap est le terrain nu
        const zLand = z0 + gEnd * tanS + (p.landEntryHeight || 0);
        return Math.max(g(u), zLand - (u - gEnd) * Math.tan(p.landingAngle * D2R));
      }

      case 'landing': {
        const kn = p.knollLen;
        if (u <= kn) return g(u) + (p.knollH || 0) * (kn > 0 ? u / kn : 1);
        const zTop = g(kn) + (p.knollH || 0);
        return Math.max(g(u), zTop - (u - kn) * Math.tan(p.landingAngle * D2R));
      }

      case 'jib': {
        const segs = jibSegments(p);
        const total = segs.reduce((a, s) => a + s.len, 0);
        if (u < 0 || u > total) return null;
        // Les angles des tronçons sont comptés PAR RAPPORT À LA PENTE :
        // « plat » signifie parallèle au terrain, comme on pose réellement un box.
        if (segs[0].arc) {                                // arc-en-ciel
          const h = p.boxRise, half = total / 2;
          return z0 + u * tanS + p.boxH + h * (1 - Math.pow((u - half) / half, 2));
        }
        let acc = 0, z = z0 + p.boxH;
        for (const sg of segs) {
          if (u <= acc + sg.len) return z + (u - acc) * (tanS + Math.tan(sg.ang * D2R));
          z += sg.len * (tanS + Math.tan(sg.ang * D2R));
          acc += sg.len;
        }
        return z;
      }

      case 'roller': {
        const lam = p.rollerLen;
        if (u < 0 || u > lam * p.rollerCount) return null;
        return g(u) + p.rollerH * 0.5 * (1 - Math.cos(2 * Math.PI * u / lam));
      }

      case 'spine': {
        if (u < 0) return null;
        if (u <= p.noseLen) return g(u) + p.spineH * (p.noseLen > 0 ? u / p.noseLen : 1);
        return g(u) + p.spineH;                            // la forme latérale fait le reste
      }

      case 'quarter': {
        if (u < 0) return null;
        if (u <= p.qFlat) return g(u);
        const R = Math.max(0.5, p.qRadius);
        const d = Math.min(u - p.qFlat, R);
        const h = R - Math.sqrt(Math.max(0, R * R - d * d));       // transition circulaire
        const vert = Math.max(0, (u - p.qFlat) - R) * 3;           // mur vertical au-dessus
        return g(p.qFlat) + Math.min(h + vert, p.qHeight);
      }

      default: return null;
    }
  }

  /** Parabole de tremplin : raccorde la pente naturelle à l'angle d'appel. */
  function kickZ(p, fr, u, z0, tanS) {
    const kl = Math.max(0.5, p.kickLen);
    let th = p.kickAngle;
    const slopeDeg = fr.slope / D2R;
    if (th <= slopeDeg) th = slopeDeg + 5;               // le tremplin doit relever
    const a = (Math.tan(th * D2R) - tanS) / (2 * kl);
    const uu = Math.max(0, Math.min(u, kl));
    return z0 + uu * tanS + a * uu * uu;
  }

  /** Angle de la lèvre effectivement réalisé (degrés). */
  function effectiveKickAngle(f) {
    const fr = ensureFrame(f), p = f.props;
    const slopeDeg = fr.slope / D2R;
    return Math.max(p.kickAngle ?? 15, slopeDeg + 5);
  }

  /* ==================================================================
     CHAMP D'ALTITUDE 2D
     ================================================================== */

  /**
   * Cote projetée du module au point Lambert-93 (X, Y).
   * @returns {{z:number, w:number, kind:string}|null}
   *          `w` = 1 au cœur du module, décroît dans le talus latéral.
   */
  function zAt(f, X, Y) {
    if (!f.visible) return null;
    const p = f.props, fr = ensureFrame(f);
    const talus = Math.max(0.2, p.talus ?? 2);

    /* --- Virage relevé : géométrie radiale --- */
    if (p.kind === 'turn') {
      const dx = X - fr.cx, dy = Y - fr.cy;
      const r = Math.hypot(dx, dy);
      const R = p.turnRadius, W = p.width, dir = p.turnDir || 1;
      if (r < R - talus || r > R + W + talus) return null;

      // Angle du point dans le repère du virage
      const a0 = p.rotation - 90;
      let ang = (Math.atan2(dx, dy) / D2R);              // azimut de grille
      let rel = ((ang - a0) * dir) % 360; if (rel < 0) rel += 360;
      if (rel > p.turnAngle + 5) return null;

      const zi = getZ([fr.cx + dx / (r || 1) * R, fr.cy + dy / (r || 1) * R]);
      const zInner = (isValidZ(zi) ? zi : fr.z0) + fr.base;
      const rr = Math.min(Math.max(r, R), R + W);
      const z = zInner + (rr - R) * Math.tan(p.turnBankAngle * D2R);
      const over = Math.max(0, R - r, r - (R + W));
      return { z, w: Math.max(0, 1 - over / talus), kind: 'turn' };
    }

    /* --- Modules rectangulaires --- */
    const dx = X - fr.ex, dy = Y - fr.ey;
    const u = dx * fr.ux + dy * fr.uy;
    const v = dx * fr.vx + dy * fr.vy;

    let half = p.width / 2;
    // Le spine s'affine latéralement ; le quarter pipe est un mur transversal
    if (u < -talus || u > fr.len + talus) return null;
    if (Math.abs(v) > half + talus) return null;

    const uc = Math.max(0, Math.min(u, fr.len));
    let z = axisZ(f, uc);
    if (z === null || !isValidZ(z)) return null;

    // Mise en forme latérale
    if (p.kind === 'spine') {
      const gz = getZ([X, Y]);
      const base = (isValidZ(gz) ? gz : fr.z0) + fr.base;
      const k = Math.max(0, 1 - Math.abs(v) / half);      // toit à deux pentes
      z = base + (z - base) * k;
    }

    const overV = Math.max(0, Math.abs(v) - half);
    const overU = Math.max(0, -u, u - fr.len);
    const w = Math.max(0, Math.min(1 - overV / talus, 1 - overU / talus));
    return { z, w, kind: p.kind };
  }

  /**
   * Cote du terrain aménagé : terrain naturel recouvert par tous les modules.
   * C'est cette fonction qu'utilisent la vue 3D, le cubage et la balistique.
   * @returns {{z:number, kind:string|null}}
   */
  function surfaceAt(X, Y, terrainZ) {
    const zT = terrainZ !== undefined ? terrainZ : getZ([X, Y]);
    if (!isValidZ(zT)) return { z: null, kind: null };
    let best = zT, kind = null;
    for (const f of APP.parks) {
      if (!f.visible) continue;
      const r = zAt(f, X, Y);
      if (!r) continue;
      const z = blendZ(r, zT, f);
      if (z > best) { best = z; kind = r.kind; }
    }
    return { z: best, kind };
  }

  /**
   * Fondu du modelé vers le terrain naturel dans le talus.
   * w = 1 au cœur du module (cote du projet), w = 0 au bord (terrain nu) ;
   * la couche de neige de base s'estompe de la même manière.
   */
  function blendZ(r, zT, f) {
    const base = (f.props.baseSnow || 0) / 100;
    return r.w * r.z + (1 - r.w) * (zT + base * r.w);
  }

  /* ==================================================================
     EMPRISE CARTOGRAPHIQUE
     ================================================================== */

  function footprint(f) {
    const p = f.props, fr = ensureFrame(f);
    const t = p.talus ?? 2;

    if (p.kind === 'turn') {
      const pts = [];
      const R = p.turnRadius, W = p.width, dir = p.turnDir || 1;
      const steps = 26;
      const inner = [], outer = [];
      for (let i = 0; i <= steps; i++) {
        const a = (p.rotation - 90 + p.turnAngle * dir * i / steps) * D2R;
        const sx = Math.sin(a), sy = Math.cos(a);
        inner.push([fr.cx + sx * R, fr.cy + sy * R]);
        outer.push([fr.cx + sx * (R + W), fr.cy + sy * (R + W)]);
      }
      pts.push(...inner, ...outer.reverse());
      return pts.map(q => { const g = toWGS(q[0], q[1]); return [g.lng, g.lat]; });
    }

    const hw = p.width / 2 + t * 0.5;
    const corner = (u, v) => {
      const x = fr.ex + fr.ux * u + fr.vx * v;
      const y = fr.ey + fr.uy * u + fr.vy * v;
      const g = toWGS(x, y);
      return [g.lng, g.lat];
    };
    return [corner(0, -hw), corner(fr.len, -hw), corner(fr.len, hw), corner(0, hw)];
  }

  /* ==================================================================
     CUBAGE (intégration 2D, même convention que le terrassement)
     ================================================================== */

  /**
   * Volume du module : intégration du champ 2D contre le terrain naturel.
   * La couche de neige de base est comprise, sur toute l'emprise.
   */
  function cubature(f) {
    const p = f.props, fr = ensureFrame(f);
    const ring = footprint(f).map(c => toL93(c[0], c[1]));
    const bb = GEOM.bboxOf(ring);
    const step = Math.max(0.2, Math.min(0.6, Math.sqrt(bb.w * bb.h / 40000)));
    const cell = step * step;
    const baseSnow = (p.baseSnow || 0) / 100;

    // Un box/rail sans butte de neige est une structure : seule la couche de
    // neige de base sous le module représente de la matière à produire.
    const structureOnly = (p.kind === 'jib' && !p.snowBase);

    let fill = 0, cut = 0, area = 0, hMax = 0;
    for (let y = bb.minY + step / 2; y <= bb.maxY; y += step) {
      for (let x = bb.minX + step / 2; x <= bb.maxX; x += step) {
        const r = zAt(f, x, y);
        if (!r) continue;
        const zT = getZ([x, y]);
        if (!isValidZ(zT)) continue;
        area += cell;
        const z = structureOnly ? zT + baseSnow * r.w : blendZ(r, zT, f);
        const dz = z - zT;
        if (dz > 0) { fill += dz * cell; if (dz > hMax) hMax = dz; }
        else cut += -dz * cell;
      }
    }
    return { fill, cut, area, hMax, step };
  }

  /* ==================================================================
     PROFIL EN LONG ET BALISTIQUE
     ================================================================== */

  /**
   * Analyse complète : profil du terrain, du modelé (tous modules confondus)
   * et trajectoire du pratiquant.
   */
  function analyse(f) {
    const p = f.props, fr = ensureFrame(f);
    const projD = p.projectionDist;
    const steps = 240;
    const total = fr.len + projD * 2;
    const du = total / steps;

    const pk = [], terrain = [], snow = [], traj = [], geo = [];
    const srcKind = [];

    for (let i = 0; i <= steps; i++) {
      const u = -projD + i * du;
      const X = fr.ex + fr.ux * u, Y = fr.ey + fr.uy * u;
      const g = toWGS(X, Y);
      geo.push({ lat: g.lat, lng: g.lng });
      pk.push(+u.toFixed(2));
      const zT = getZ([X, Y]);
      terrain.push(isValidZ(zT) ? +zT.toFixed(2) : null);
      const s = surfaceAt(X, Y, zT);
      snow.push(s.z !== null && Math.abs(s.z - (zT || 0)) > 0.02 ? +s.z.toFixed(2) : null);
      srcKind.push(s.kind);
    }

    /* --- Balistique --- */
    const impact = { time: 0, dist: 0, vImpact: 0, efh: 0, gforce: 0, amplitude: 0 };
    const hasLip = (p.kind === 'takeoff' || p.kind === 'table' || p.kind === 'gap');
    const v0 = (p.speed || 40) / 3.6;

    if (hasLip && v0 > 0) {
      const kl = p.kickLen;
      const zLip = axisZ(f, kl);
      const th = effectiveKickAngle(f) * D2R;
      let vx = v0 * Math.cos(th), vz = v0 * Math.sin(th);
      let simU = kl, simZ = zLip + 1;                 // centre de gravité 1 m au-dessus
      let state = 'AIR';

      for (let i = 0; i <= steps; i++) {
        const u = -projD + i * du;
        if (u <= kl || state === 'LANDED') { traj.push(null); continue; }
        const ground = snow[i] !== null ? snow[i] : terrain[i];
        if (ground === null) { traj.push(null); continue; }

        const t = (u - simU) / vx;
        const zR = simZ + vz * t - 0.5 * G * t * t;

        // Réception sur un box : le pratiquant glisse dessus
        if (state === 'AIR' && srcKind[i] === 'jib' && zR <= ground + 1) {
          state = 'SLIDE'; traj.push(+(ground + 1).toFixed(2)); continue;
        }
        if (state === 'SLIDE') {
          if (srcKind[i] === 'jib') { traj.push(+(ground + 1).toFixed(2)); continue; }
          // sortie du box : nouveau vol depuis la pente de sortie
          const prev = snow[i - 1] !== null ? snow[i - 1] : terrain[i - 1];
          const exitAng = Math.atan2((ground - prev), du) + 5 * D2R;
          vx = v0 * Math.cos(exitAng); vz = v0 * Math.sin(exitAng);
          simU = u; simZ = ground + 1; state = 'AIR';
          traj.push(+simZ.toFixed(2)); continue;
        }

        if (zR <= ground + 1) {
          state = 'LANDED';
          traj.push(+(ground + 1).toFixed(2));
          impact.dist = u - kl;
          impact.time = Math.max(0, (u - simU) / vx);
          const vzEnd = vz - G * impact.time;
          const vTot = Math.hypot(vx, vzEnd);
          impact.vImpact = vTot * 3.6;
          const aTraj = Math.atan2(vzEnd, vx);
          // Pente de la surface au point d'impact
          const prev = (snow[i - 1] !== null ? snow[i - 1] : terrain[i - 1]);
          const aLand = prev !== null ? Math.atan2(ground - prev, du) : fr.slope;
          const vPerp = Math.abs(vTot * Math.sin(aTraj - aLand));
          impact.efh = (vPerp * vPerp) / (2 * G);
          impact.gforce = 1 + (vPerp * vPerp) / (2 * G * 0.4);   // 40 cm de neige
          continue;
        }
        traj.push(+zR.toFixed(2));
        impact.amplitude = Math.max(impact.amplitude, zR - ground - 1);
      }
    } else {
      for (let i = 0; i <= steps; i++) traj.push(null);
    }

    /* --- Élan nécessaire en amont --- */
    let runup = null;
    if (hasLip) {
      const hNeed = (v0 * v0) / (2 * G * 0.9);
      const z0 = fr.z0 + fr.base;
      for (let dd = 1; dd < 220; dd += 1) {
        const X = fr.ex - fr.ux * dd, Y = fr.ey - fr.uy * dd;
        const zc = getZ([X, Y]);
        if (isValidZ(zc) && (zc - z0) >= hNeed) { const g = toWGS(X, Y); runup = { dist: dd, ...g }; break; }
      }
    }

    const cub = cubature(f);
    return {
      pk, terrain, snow, traj, geo, srcKind,
      volume: cub.fill, volumeCut: cub.cut, area: cub.area, hMax: cub.hMax,
      impact, runup, hasLip,
      slopeDeg: fr.slope / D2R, thetaDeg: effectiveKickAngle(f), len: fr.len
    };
  }

  /* ==================================================================
     PLACEMENT ET MANIPULATION SUR LA CARTE
     ================================================================== */

  function startPlace(key) {
    placing = placing === key ? null : key;
    document.querySelectorAll('[data-mod]').forEach(b => b.classList.toggle('active', b.dataset.mod === placing));
    if (placing) {
      cancelDraw();
      toast(`Cliquez sur la carte pour poser « ${CATALOG[placing].label} ».`, 'info');
      APP.map.getContainer().style.cursor = 'copy';
    } else APP.map.getContainer().style.cursor = '';
  }

  /** Azimut de la ligne de plus grande pente au point donné. */
  function downhillBearing(lng, lat) {
    const c = toL93(lng, lat);
    const d = 10;
    const zx1 = getZ([c[0] - d, c[1]]), zx2 = getZ([c[0] + d, c[1]]);
    const zy1 = getZ([c[0], c[1] - d]), zy2 = getZ([c[0], c[1] + d]);
    if (![zx1, zx2, zy1, zy2].every(isValidZ)) return 0;
    const gx = (zx2 - zx1) / (2 * d), gy = (zy2 - zy1) / (2 * d);
    if (Math.hypot(gx, gy) < 1e-6) return 0;
    // La descente suit −gradient ; conversion en azimut de grille
    return (Math.atan2(-gx, -gy) / D2R + 360) % 360;
  }

  function onMapClick(e) {
    if (!placing) return false;
    const n = CATALOG[placing];
    const props = Object.assign({}, COMMON, n.p, {
      key: placing, kind: n.kind,
      lng: e.latlng.lng, lat: e.latlng.lat,
      rotation: Math.round(downhillBearing(e.latlng.lng, e.latlng.lat))
    });
    const f = {
      id: uid(), kind: 'park',
      name: placing + ' ' + (APP.parks.filter(x => x.props.key === placing).length + 1),
      color: n.color, visible: true, props, _dirty: true
    };
    APP.parks.unshift(f);
    startPlace(null);
    selectedId = f.id;
    refresh(f); renderList(); openProfile(f.id);
    if (f.layer) APP.map.fitBounds(f.layer.getBounds().pad(2.2));
    return true;
  }

  function get(id) { return APP.parks.find(f => f.id === id); }

  /* --- Rendu carte --- */

  function render(f) {
    if (f.layer) { APP.map.removeLayer(f.layer); f.layer = null; }
    if (f.deco) { APP.map.removeLayer(f.deco); f.deco = null; }
    if (!f.visible) return;

    const ring = footprint(f).map(c => [c[1], c[0]]);
    f.layer = L.polygon(ring, {
      color: f.color, weight: 2, fillColor: f.color,
      fillOpacity: f.id === selectedId ? 0.55 : 0.35
    }).addTo(APP.map);
    f.layer.bindTooltip(f.name, { sticky: true });
    f.layer.on('click', () => { select(f.id); });

    const deco = L.layerGroup().addTo(APP.map);
    const fr = ensureFrame(f);
    const p = f.props;

    // Axe d'analyse
    const a = toWGS(fr.ex - fr.ux * p.projectionDist, fr.ey - fr.uy * p.projectionDist);
    const b = toWGS(fr.xx + fr.ux * p.projectionDist, fr.xy + fr.uy * p.projectionDist);
    L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#f1c40f', weight: 1, dashArray: '5,5', interactive: false }).addTo(deco);

    // Limites de zones
    zoneMarks(f).forEach(u => {
      const l = toWGS(fr.ex + fr.ux * u + fr.vx * p.width / 2, fr.ey + fr.uy * u + fr.vy * p.width / 2);
      const r = toWGS(fr.ex + fr.ux * u - fr.vx * p.width / 2, fr.ey + fr.uy * u - fr.vy * p.width / 2);
      L.polyline([[l.lat, l.lng], [r.lat, r.lng]], { color: '#fff', weight: 1, dashArray: '3,3', interactive: false }).addTo(deco);
    });

    if (f.analysis && f.analysis.runup) {
      L.circleMarker([f.analysis.runup.lat, f.analysis.runup.lng],
        { radius: 6, color: '#fff', weight: 2, fillColor: '#27ae60', fillOpacity: 1 })
        .bindTooltip(`Départ conseillé — ${fmt(f.analysis.runup.dist, 0)} m en amont`).addTo(deco);
    }
    f.deco = deco;
    if (f.id === selectedId) showHandles(f);
  }

  function zoneMarks(f) {
    const p = f.props;
    switch (p.kind) {
      case 'table': return [p.kickLen, p.kickLen + p.tableLen];
      case 'gap': return [p.kickLen, p.kickLen + p.gapLen];
      case 'landing': return [p.knollLen];
      case 'jib': { const s = jibSegments(p); const out = []; let a = 0; for (const x of s) { a += x.len; out.push(a); } out.pop(); return out; }
      default: return [];
    }
  }

  /**
   * Poignées de manipulation directe : déplacement libre au centre,
   * rotation au bout de l'axe. C'est ce qui donne la liberté de tracé.
   */
  function showHandles(f) {
    hideHandles();
    const fr = ensureFrame(f);
    handles = L.layerGroup().addTo(APP.map);

    const cM = L.marker([f.props.lat, f.props.lng], {
      draggable: true, zIndexOffset: 1000,
      icon: L.divIcon({ className: 'park-handle move', html: '<div>✥</div>', iconSize: [30, 30], iconAnchor: [15, 15] })
    }).addTo(handles);
    cM.bindTooltip('Glisser pour déplacer', { direction: 'top' });
    cM.on('drag', ev => {
      f.props.lng = ev.latlng.lng; f.props.lat = ev.latlng.lat;
      touch(f); renderLight(f);
    });
    cM.on('dragend', () => { refresh(f); renderList(); });

    const nose = toWGS(fr.xx + fr.ux * 6, fr.xy + fr.uy * 6);
    const rM = L.marker([nose.lat, nose.lng], {
      draggable: true, zIndexOffset: 1000,
      icon: L.divIcon({ className: 'park-handle rot', html: '<div>↻</div>', iconSize: [28, 28], iconAnchor: [14, 14] })
    }).addTo(handles);
    rM.bindTooltip('Glisser pour orienter', { direction: 'top' });
    rM.on('drag', ev => {
      const c = turf.point([f.props.lng, f.props.lat]);
      const t = turf.point([ev.latlng.lng, ev.latlng.lat]);
      f.props.rotation = (turf.bearing(c, t) + 360) % 360;
      touch(f); renderLight(f);
      const sv = document.getElementById('sv-rotation');
      if (sv) sv.textContent = fmt(f.props.rotation, 0) + ' °';
      const sl = document.querySelector('#park-props-' + f.id + ' input[data-k="rotation"]');
      if (sl) sl.value = f.props.rotation;
    });
    rM.on('dragend', () => { refresh(f); renderList(); });
  }

  function hideHandles() { if (handles) { APP.map.removeLayer(handles); handles = null; } }

  /** Redessine seulement l'emprise (pendant un glisser, pour rester fluide). */
  function renderLight(f) {
    if (!f.layer) return;
    f.layer.setLatLngs(footprint(f).map(c => [c[1], c[0]]));
  }

  function refresh(f) {
    touch(f);
    f.analysis = analyse(f);
    render(f);
    if (selectedId === f.id && document.getElementById('profile-window').style.display !== 'none') drawChart(f);
    updateStats(f);
  }

  function refreshAll() { APP.parks.forEach(f => { if (f.visible) { touch(f); f.analysis = analyse(f); render(f); } }); }

  /* ==================================================================
     INTERFACE
     ================================================================== */

  function catalogHtml() {
    const groups = {};
    for (const [k, v] of Object.entries(CATALOG)) (groups[v.group] = groups[v.group] || []).push(k);
    return Object.entries(groups).map(([g, keys]) => `
      <div class="cat-group"><div class="cat-title">${g}</div>
      ${keys.map(k => `<button class="mod-btn" data-mod="${k}" style="--mc:${CATALOG[k].color}"
         onclick="SNOWPARK.startPlace('${k}')" ${CATALOG[k].help ? `title="${escapeHtml(CATALOG[k].help)}"` : ''}>${CATALOG[k].label}</button>`).join('')}
      </div>`).join('');
  }

  function renderList() {
    const el = document.getElementById('park-list');
    if (!el) return;
    if (!APP.parks.length) {
      el.innerHTML = `<div class="empty">Aucun module.<br><small>Choisissez un module dans le catalogue puis cliquez sur la carte.</small></div>`;
      hideHandles();
      return;
    }
    el.innerHTML = `<div class="park-total" id="park-total"></div>` + APP.parks.map(f => {
      const sel = f.id === selectedId;
      return `<div class="card park-card ${sel ? 'sel' : ''}" style="--fc:${f.color}">
        <div class="card-head">
          <label class="chk"><input type="checkbox" ${f.visible ? 'checked' : ''} onchange="SNOWPARK.toggle(${f.id})"></label>
          <button class="feat-name" onclick="SNOWPARK.select(${f.id})">${escapeHtml(f.name)}</button>
          <span class="tag">${escapeHtml((CATALOG[f.props.key] || {}).label || f.props.kind).split('—')[0].trim()}</span>
          <button class="icon-btn" title="Dupliquer" onclick="SNOWPARK.duplicate(${f.id})">⧉</button>
          <button class="icon-btn danger" onclick="SNOWPARK.remove(${f.id})">✕</button>
        </div>
        ${sel ? propsHtml(f) : `<div class="park-mini" id="park-mini-${f.id}"></div>`}
      </div>`;
    }).join('');
    APP.parks.forEach(f => { if (f.id !== selectedId) miniStats(f); });
    if (selectedId) { const f = get(selectedId); if (f) updateStats(f); }
    updateTotals();
  }

  function updateTotals() {
    const el = document.getElementById('park-total'); if (!el) return;
    const vis = APP.parks.filter(f => f.visible);
    if (!vis.length) { el.innerHTML = ''; return; }
    let fill = 0, cut = 0;
    vis.forEach(f => { const a = f.analysis || (f.analysis = analyse(f)); fill += a.volume; cut += a.volumeCut; });
    el.innerHTML = `<b>${vis.length} module(s)</b> · neige à façonner <b>${fmt(fill, 0)} m³</b>` +
      (cut > 1 ? ` · décaissement <b>${fmt(cut, 0)} m³</b>` : '');
  }

  function miniStats(f) {
    const el = document.getElementById('park-mini-' + f.id);
    if (!el) return;
    if (!f.analysis) f.analysis = analyse(f);
    const a = f.analysis;
    el.innerHTML = `<span>Neige <b>${fmt(a.volume, 0)} m³</b></span>` +
      (a.volumeCut > 1 ? ` · <span>décaiss. <b>${fmt(a.volumeCut, 0)} m³</b></span>` : '') +
      (a.hasLip ? ` · <span>EFH <b class="${efhClass(a.impact.efh)}">${a.impact.efh ? fmt(a.impact.efh, 2) + ' m' : '—'}</b></span>` : '');
  }

  /* --- Générateurs de contrôles --- */

  function sl(f, key, label, min, max, stp, unit = '') {
    const v = f.props[key] ?? 0;
    const dec = stp < 1 ? 1 : 0;
    return `<label class="slider-row"><span>${label}</span><span class="sv" id="sv-${key}">${fmt(v, dec)} ${unit}</span>
      <input type="range" data-k="${key}" min="${min}" max="${max}" step="${stp}" value="${v}"
             oninput="SNOWPARK.setProp(${f.id},'${key}',this.value,'${unit}',${dec})"></label>`;
  }
  function sel(f, key, label, options) {
    return `<label class="field"><span>${label}</span>
      <select onchange="SNOWPARK.setProp(${f.id},'${key}',this.value)">
        ${Object.entries(options).map(([k, v]) => `<option value="${k}" ${f.props[key] === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select></label>`;
  }

  function propsHtml(f) {
    const k = f.props.kind;
    let s = `<div class="park-props" id="park-props-${f.id}">
      <div class="btn-row">
        <button class="btn tiny" onclick="SNOWPARK.openProfile(${f.id})">📈 Profil &amp; balistique</button>
        <button class="btn tiny" onclick="SNOWPARK.alignDownhill(${f.id})" title="Orienter dans la ligne de plus grande pente">⤓ Ligne de pente</button>
        <input type="color" class="swatch" value="${f.color}" onchange="SNOWPARK.setColor(${f.id},this.value)">
      </div>
      <div class="hint">Sur la carte : poignée <b>✥</b> pour déplacer, <b>↻</b> pour orienter.</div>
      ${sl(f, 'rotation', 'Orientation', 0, 359, 1, '°')}
      ${sl(f, 'width', 'Largeur', 1, 40, 0.5, 'm')}
      ${sl(f, 'talus', 'Talus latéral (fondu)', 0.2, 8, 0.1, 'm')}
      ${sl(f, 'baseSnow', 'Neige de base sur l’emprise', 0, 300, 5, 'cm')}`;

    if (k === 'takeoff' || k === 'table' || k === 'gap') {
      s += `<div class="sub">Tremplin</div>
        ${sl(f, 'kickLen', 'Longueur d’appel', 1, 25, 0.5, 'm')}
        ${sl(f, 'kickAngle', 'Angle d’appel', 0, 60, 0.5, '°')}`;
    }
    if (k === 'table') s += `<div class="sub">Table</div>${sl(f, 'tableLen', 'Longueur de table', 0, 50, 0.5, 'm')}${sl(f, 'knollH', 'Sur-hauteur de réception', -5, 5, 0.1, 'm')}`;
    if (k === 'gap') s += `<div class="sub">Gap</div>${sl(f, 'gapLen', 'Longueur du gap', 0, 40, 0.5, 'm')}${sl(f, 'landEntryHeight', 'Décalage de réception', -15, 15, 0.5, 'm')}`;

    if (k === 'landing') {
      s += `<div class="sub">Butte d’entrée</div>
        ${sl(f, 'knollLen', 'Longueur de butte', 0, 20, 0.5, 'm')}
        ${sl(f, 'knollH', 'Hauteur de butte', 0, 8, 0.1, 'm')}`;
    }
    if (k === 'table' || k === 'gap' || k === 'landing') {
      s += `<div class="sub">Réception</div>
        ${sl(f, 'landLen', 'Longueur de réception', 2, 60, 0.5, 'm')}
        ${sl(f, 'landingAngle', 'Pente de réception', 0, 55, 0.5, '°')}`;
    }

    if (k === 'jib') {
      s += `<div class="sub">Structure</div>
        ${sel(f, 'railType', 'Type', JIB_TYPES)}
        ${sel(f, 'jibShape', 'Profil', JIB_SHAPES)}
        ${sl(f, 'boxH', 'Hauteur d’entrée', 0, 4, 0.05, 'm')}`;
      const sh = f.props.jibShape;
      if (sh === 'rainbow') s += sl(f, 'boxRise', 'Flèche de l’arc', 0.2, 3, 0.05, 'm');
      const needA = ['up', 'up_flat', 'up_flat_down', 'down_flat_down'].includes(sh);
      const needC = ['down', 'flat_down', 'up_flat_down', 'down_flat_down'].includes(sh);
      s += sl(f, 'segA', sh === 'flat' || sh === 'rainbow' ? 'Tronçon 1' : 'Longueur tronçon 1', 0.5, 20, 0.25, 'm');
      s += sl(f, 'segB', 'Longueur tronçon 2 (plat)', 0.5, 25, 0.25, 'm');
      s += sl(f, 'segC', 'Longueur tronçon 3', 0.5, 20, 0.25, 'm');
      if (needA) s += sl(f, 'angA', 'Angle du tronçon 1', 0, 45, 0.5, '°');
      if (needC) s += sl(f, 'angC', 'Angle du tronçon 3', 0, 45, 0.5, '°');
      s += `<label class="chk" style="margin:6px 0"><input type="checkbox" ${f.props.snowBase ? 'checked' : ''}
              onchange="SNOWPARK.setProp(${f.id},'snowBase',this.checked?1:0)"><span>Butte de neige sous la structure (comptée au cubage)</span></label>`;
    }

    if (k === 'turn') {
      s += `<div class="sub">Virage</div>
        <button class="btn tiny" onclick="SNOWPARK.flipTurn(${f.id})">↔️ Inverser le sens</button>
        ${sl(f, 'turnRadius', 'Rayon', 5, 60, 1, 'm')}
        ${sl(f, 'turnAngle', 'Angle d’arc', 30, 180, 5, '°')}
        ${sl(f, 'turnBankAngle', 'Dévers du mur', 0, 75, 1, '°')}`;
    }
    if (k === 'roller') s += `<div class="sub">Rouleaux</div>${sl(f, 'rollerLen', 'Pas entre bosses', 3, 25, 0.5, 'm')}${sl(f, 'rollerH', 'Hauteur', 0.2, 4, 0.1, 'm')}${sl(f, 'rollerCount', 'Nombre', 1, 10, 1, '')}`;
    if (k === 'spine') s += `<div class="sub">Spine</div>${sl(f, 'spineLen', 'Longueur', 4, 40, 0.5, 'm')}${sl(f, 'spineH', 'Hauteur d’arête', 0.5, 6, 0.1, 'm')}${sl(f, 'noseLen', 'Rampe d’attaque', 1, 15, 0.5, 'm')}`;
    if (k === 'quarter') s += `<div class="sub">Quarter</div>${sl(f, 'qFlat', 'Plat d’approche', 0, 15, 0.5, 'm')}${sl(f, 'qRadius', 'Rayon de transition', 1, 10, 0.1, 'm')}${sl(f, 'qHeight', 'Hauteur du mur', 1, 8, 0.1, 'm')}`;

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

    let ballistic = '';
    if (a.hasLip) {
      ballistic = `<hr>
      <div class="sb-row"><span>Temps de vol</span><b>${i.time ? fmt(i.time, 2) + ' s' : '—'}</b></div>
      <div class="sb-row"><span>Portée</span><b>${i.dist ? fmt(i.dist, 1) + ' m' : '—'}</b></div>
      <div class="sb-row"><span>Amplitude max</span><b>${i.amplitude ? fmt(i.amplitude, 1) + ' m' : '—'}</b></div>
      <div class="sb-row"><span>Vitesse d’impact</span><b>${i.vImpact ? fmt(i.vImpact, 1) + ' km/h' : '—'}</b></div>
      <div class="sb-row hl"><span>EFH (hauteur de chute éq.)</span><b class="${efhClass(i.efh)}">${i.efh ? fmt(i.efh, 2) + ' m' : '—'}</b></div>
      <div class="sb-row"><span>Facteur de charge</span><b class="${efhClass(i.efh)}">${i.gforce > 1 ? fmt(i.gforce, 1) + ' g' : '—'}</b></div>
      <div class="sb-note">${i.efh ? (i.efh <= 1 ? '✅ Réception conforme à l’objectif EFH ≤ 1 m.'
        : i.efh <= 1.5 ? '⚠️ EFH élevée : allonger ou redresser la réception, ou réduire la vitesse.'
        : '⛔ EFH excessive : réception à revoir.') : 'Aucun atterrissage détecté dans le plan de coupe : allongez-le ou ajoutez une réception.'}</div>
      ${a.runup ? `<div class="sb-note">Départ conseillé : ${fmt(a.runup.dist, 0)} m en amont.</div>` : ''}`;
    }

    el.innerHTML = `
      <div class="sb-row"><span>Neige à façonner</span><b>${fmt(a.volume, 0)} m³</b></div>
      <div class="sb-row"><span>Terrain à décaisser</span><b>${fmt(a.volumeCut, 0)} m³</b></div>
      <div class="sb-row"><span>Emprise · épaisseur max</span><b>${fmt(a.area, 0)} m² · ${fmt(a.hMax, 2)} m</b></div>
      <div class="sb-row"><span>Longueur · pente naturelle</span><b>${fmt(a.len, 1)} m · ${fmt(a.slopeDeg, 1)} °</b></div>
      ${a.hasLip ? `<div class="sb-row"><span>Angle d’appel effectif</span><b>${fmt(a.thetaDeg, 1)} °</b></div>` : ''}
      ${ballistic}
      ${a.volumeCut > a.volume ? `<div class="sb-note">⚠️ Le modelé passe sous le terrain naturel : ce module demande surtout du décaissement. Vérifiez l’orientation.</div>` : ''}`;
    updateTotals();
  }

  /* ==================================================================
     ACTIONS
     ================================================================== */

  function setProp(id, key, val, unit, dec) {
    const f = get(id); if (!f) return;
    f.props[key] = (typeof val === 'string' && isNaN(parseFloat(val))) ? val : parseFloat(val);
    if (unit !== undefined) {
      const sv = document.getElementById('sv-' + key);
      if (sv) sv.textContent = fmt(f.props[key], dec ?? 0) + ' ' + unit;
    }
    const structural = ['jibShape', 'railType', 'snowBase'].includes(key);
    refresh(f);
    if (structural) renderList();
    APP.parks.forEach(o => { if (o !== f) { touch(o); } });   // les voisins voient le nouveau relief
  }
  function setColor(id, c) { const f = get(id); if (!f) return; f.color = c; render(f); }
  function select(id) {
    selectedId = (selectedId === id ? null : id);
    hideHandles();
    APP.parks.forEach(render);
    renderList();
    if (selectedId) openProfile(selectedId);
  }
  function toggle(id) { const f = get(id); if (!f) return; f.visible = !f.visible; render(f); refreshAll(); renderList(); }
  function flipTurn(id) { const f = get(id); if (!f) return; f.props.turnDir = -(f.props.turnDir || 1); refresh(f); }
  function alignDownhill(id) {
    const f = get(id); if (!f) return;
    f.props.rotation = Math.round(downhillBearing(f.props.lng, f.props.lat));
    refresh(f); renderList();
    toast(`Orienté à ${fmt(f.props.rotation, 0)}° (ligne de plus grande pente).`, 'ok');
  }
  function duplicate(id) {
    const f = get(id); if (!f) return;
    const g = turf.destination(turf.point([f.props.lng, f.props.lat]), f.props.width + 6,
      f.props.rotation + 90, { units: 'meters' }).geometry.coordinates;
    const c = {
      id: uid(), kind: 'park', name: f.name + ' (copie)', color: f.color, visible: true,
      props: { ...f.props, lng: g[0], lat: g[1] }, _dirty: true
    };
    APP.parks.unshift(c); selectedId = c.id; refresh(c); renderList();
  }
  function remove(id) {
    const f = get(id); if (!f) return;
    if (!confirm(`Supprimer « ${f.name} » ?`)) return;
    if (f.layer) APP.map.removeLayer(f.layer);
    if (f.deco) APP.map.removeLayer(f.deco);
    APP.parks = APP.parks.filter(x => x.id !== id);
    if (selectedId === id) { selectedId = null; hideHandles(); }
    refreshAll(); renderList();
  }

  /** Transforme l'emprise du module en surface mesurable (cubature, exports). */
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

  /* ==================================================================
     PROFIL
     ================================================================== */

  function openProfile(id) {
    const f = get(id); if (!f) return;
    if (!hasMNT()) { toast('Activez un MNT pour analyser un module.', 'warn'); return; }
    selectedId = id;
    f.analysis = analyse(f);
    document.getElementById('profile-window').style.display = 'flex';
    document.getElementById('profile-window').classList.add('park-mode');
    document.getElementById('profile-title').textContent = `Profil module — ${f.name}`;
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
    const col = !a.hasLip ? '#7f8c8d' : a.impact.efh <= 1 ? '#2ecc71' : a.impact.efh <= 1.5 ? '#f39c12' : '#e74c3c';

    chart = new Chart(cv.getContext('2d'), {
      type: 'line',
      data: {
        labels: a.pk,
        datasets: [
          { label: 'Terrain naturel', data: a.terrain, borderColor: '#7f8c8d', backgroundColor: '#7f8c8d33', fill: 'start', pointRadius: 0, borderWidth: 2, tension: 0.2, order: 4, spanGaps: true },
          { label: 'Modelé neige / structures', data: a.snow, borderColor: f.color, backgroundColor: f.color + '55', fill: 0, pointRadius: 0, borderWidth: 2, tension: 0.1, order: 3, spanGaps: false },
          { label: 'Trajectoire', data: a.traj, borderColor: col, borderDash: [6, 4], pointRadius: 0, borderWidth: 3, fill: false, tension: 0.25, order: 1, spanGaps: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { title: { display: true, text: 'Distance le long de l’axe (m) — 0 au pied du module' }, ticks: { maxTicksLimit: 14 } },
          y: { title: { display: true, text: 'Altitude NGF (m)' } }
        },
        plugins: { legend: { labels: { boxWidth: 12 } } },
        onHover: (e, els) => { if (els && els.length) { const g = a.geo[els[0].index]; if (g) hoverMap(g.lat, g.lng); } }
      }
    });
  }

  let hov = null;
  function hoverMap(lat, lng) {
    if (!hov) hov = L.circleMarker([lat, lng], { radius: 7, color: '#e74c3c', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(APP.map);
    else hov.setLatLng([lat, lng]);
  }

  /* ==================================================================
     SÉRIALISATION ET EXPORT
     ================================================================== */

  function restore(list) {
    (list || []).forEach(o => {
      const f = {
        id: uid(), kind: 'park', name: o.name, color: o.color,
        visible: o.visible !== false, props: { ...COMMON, ...o.props }, _dirty: true
      };
      APP.parks.push(f); render(f);
    });
    refreshAll(); renderList();
  }

  function exportCSV() {
    if (!APP.parks.length) return toast('Aucun module.', 'warn');
    let csv = 'Module;Type;Profil;Largeur_m;Longueur_m;Neige_apport_m3;Decaissement_m3;Emprise_m2;Ep_max_m;' +
      'Neige_base_cm;Vitesse_kmh;Portee_m;Airtime_s;V_impact_kmh;EFH_m;Charge_g;Orientation_deg;Lon;Lat\n';
    APP.parks.forEach(f => {
      const a = f.analysis || analyse(f);
      csv += [f.name, f.props.kind, f.props.jibShape || '', csvNum(f.props.width, 1), csvNum(a.len, 1),
        csvNum(a.volume, 1), csvNum(a.volumeCut, 1), csvNum(a.area, 1), csvNum(a.hMax, 2),
        csvNum(f.props.baseSnow, 0), csvNum(f.props.speed, 0),
        csvNum(a.impact.dist, 1), csvNum(a.impact.time, 2), csvNum(a.impact.vImpact, 1),
        csvNum(a.impact.efh, 2), csvNum(a.impact.gforce, 2), csvNum(f.props.rotation, 0),
        csvNum(f.props.lng, 7), csvNum(f.props.lat, 7)].join(';') + '\n';
    });
    const tf = APP.parks.reduce((s, f) => s + (f.analysis || analyse(f)).volume, 0);
    const tc = APP.parks.reduce((s, f) => s + (f.analysis || analyse(f)).volumeCut, 0);
    csv += `\nTOTAL apport (m3);${csvNum(tf, 1)}\nTOTAL decaissement (m3);${csvNum(tc, 1)}\n`;
    EXPORTS.saveText(csv, `snowpark_${EXPORTS.stamp()}.csv`, 'text/csv;charset=utf-8');
    toast('Modules exportés en CSV.', 'ok');
  }

  /** Modules dont l'emprise recoupe la boîte donnée (pour la vue 3D). */
  function modulesInBox(bb) {
    return APP.parks.filter(f => {
      if (!f.visible) return false;
      const r = footprint(f).map(c => toL93(c[0], c[1]));
      const b = GEOM.bboxOf(r);
      return !(b.maxX < bb.minX || b.minX > bb.maxX || b.maxY < bb.minY || b.minY > bb.maxY);
    });
  }

  return {
    CATALOG, JIB_SHAPES, JIB_TYPES, catalogHtml, renderList, startPlace, onMapClick,
    setProp, setColor, select, toggle, flipTurn, alignDownhill, duplicate, remove,
    toFeature, openProfile, refreshAll, restore, exportCSV,
    analyse, get, footprint, zAt, surfaceAt, cubature, modulesInBox,
    hideHandles, selected: () => selectedId
  };
})();

window.SNOWPARK = SNOWPARK;
