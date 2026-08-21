/* =====================================================================
   GEOM — Géométrie métrique, triangulation, surfaces de référence
   =====================================================================
   Toutes les fonctions travaillent en Lambert-93 (mètres).
   C'est LA source unique de vérité pour longueurs / surfaces / pentes :
   les panneaux, le PDF et les exports appellent tous `measure()`.
   ===================================================================== */

'use strict';

/* ---------------- Primitives ---------------- */

/** Point dans polygone (ray casting), polygone = [[x,y], …] */
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Aire algébrique (shoelace). Signe > 0 si sens trigonométrique. */
function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return a / 2;
}

function polyArea(poly) { return Math.abs(signedArea(poly)); }

function polyPerimeter(poly, closed = true) {
  let p = 0;
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % poly.length;
    p += Math.hypot(poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]);
  }
  return p;
}

function bboxOf(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Polygone approchant un cercle.
 * 180 côtés => l'aire du polygone vaut 99,99 % de πR² : les statistiques
 * affichées et les volumes calculés portent bien sur la MÊME géométrie.
 */
function circlePolygonL93(centerL93, radius, n = 180) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n;
    pts.push([centerL93[0] + radius * Math.cos(a), centerL93[1] + radius * Math.sin(a)]);
  }
  return pts;
}

/* ---------------- Mesures d'un tracé ---------------- */

/**
 * Mesures complètes et cohérentes d'un tracé.
 * @returns {{
 *   type:string, length2D:number, length3D:number, perimeter2D:number,
 *   areaH:number, areaDev:number, zMin:number|null, zMax:number|null,
 *   zStart:number|null, zEnd:number|null, deltaZ:number|null,
 *   slopeMean:number|null, slopeMax:number|null, climb:number, drop:number,
 *   nPts:number, zSource:string
 * }}
 */
function measure(d) {
  const pts = d.ptsGPS || [];
  const l93 = ptsToL93(pts);
  const zs = pts.map(effectiveZ);
  const known = zs.filter(isValidZ);

  const res = {
    type: d.type,
    nPts: pts.length,
    nParts: 1,
    length2D: 0, length3D: 0, perimeter2D: 0,
    areaH: 0, areaDev: 0,
    zMin: known.length ? Math.min(...known) : null,
    zMax: known.length ? Math.max(...known) : null,
    zStart: isValidZ(zs[0]) ? zs[0] : null,
    zEnd: isValidZ(zs[zs.length - 1]) ? zs[zs.length - 1] : null,
    deltaZ: null, slopeMean: null, slopeMax: null,
    climb: 0, drop: 0,
    zSource: pts.some(p => p.customZ !== undefined) ? 'mixte (Z forcés)' : 'MNT'
  };

  if (l93.length < 2) return res;

  const closed = (d.type === 'area' || d.type === 'circle');

  if (closed) {
    // Surface éventuellement composée de plusieurs emprises
    const rings = ringsOf(d);
    res.nParts = rings.length;
    const polys = [];
    let allZ = [];
    for (const ring of rings) {
      const p93 = ptsToL93(ring);
      const rz = ring.map(effectiveZ);
      polys.push(p93);
      allZ = allZ.concat(rz.filter(isValidZ));
      res.perimeter2D += polyPerimeter(p93, true);
      res.areaH += polyArea(p93);
      res.areaDev += developedArea(p93, rz);
      res.nPts += (ring === pts ? 0 : ring.length);
    }
    if (allZ.length) { res.zMin = Math.min(...allZ); res.zMax = Math.max(...allZ); }
    res.length2D = res.perimeter2D;

    // Emprises sécantes : l'addition des aires compterait deux fois le recouvrement
    if (polys.length > 1 && ringsOverlap(polys)) {
      const u = unionArea(polys);
      res.overlap = res.areaH - u;
      if (res.overlap > 0.005 * res.areaH) {
        res.areaDev *= u / res.areaH;
        res.areaH = u;
        res.hasOverlap = true;
      }
    }
    return res;
  }

  // Tracés ouverts (lignes)
  for (let i = 0; i < l93.length - 1; i++) {
    const j = i + 1;
    const dl = Math.hypot(l93[j][0] - l93[i][0], l93[j][1] - l93[i][1]);
    res.length2D += dl;
    res.perimeter2D += dl;

    if (isValidZ(zs[i]) && isValidZ(zs[j])) {
      const dz = zs[j] - zs[i];
      res.length3D += Math.hypot(dl, dz);
      if (dz > 0) res.climb += dz; else res.drop += -dz;
      const sl = dl > 0 ? Math.abs(dz / dl) * 100 : 0;
      if (res.slopeMax === null || sl > res.slopeMax) res.slopeMax = sl;
    } else {
      res.length3D += dl;
    }
  }
  if (res.zStart !== null && res.zEnd !== null) {
    res.deltaZ = res.zEnd - res.zStart;
    res.slopeMean = res.length2D > 0 ? (res.deltaZ / res.length2D) * 100 : null;
  }
  return res;
}

/**
 * Surface développée (le long du terrain) d'un polygone :
 * triangulation en éventail depuis le barycentre, altitudes = Z effectifs.
 * Toujours >= surface horizontale.
 */
function developedArea(l93, zs) {
  const n = l93.length;
  if (n < 3) return 0;
  let cx = 0, cy = 0, cz = 0, cn = 0;
  for (let i = 0; i < n; i++) {
    cx += l93[i][0]; cy += l93[i][1];
    if (isValidZ(zs[i])) { cz += zs[i]; cn++; }
  }
  cx /= n; cy /= n; cz = cn ? cz / cn : 0;

  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const A = [l93[i][0], l93[i][1], isValidZ(zs[i]) ? zs[i] : cz];
    const B = [l93[j][0], l93[j][1], isValidZ(zs[j]) ? zs[j] : cz];
    const C = [cx, cy, cz];
    area += triArea3D(A, B, C);
  }
  return area;
}

function triArea3D(A, B, C) {
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
  const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(nx, ny, nz);
}

/* ---------------- Triangulation de Delaunay (Bowyer–Watson) ---------------- */

/**
 * Triangule un nuage de points {x,y,z} et ne conserve que les triangles
 * dont le barycentre est dans le polygone (gestion des contours concaves).
 */
function delaunay(pts, clipPoly) {
  const n = pts.length;
  if (n < 3) return [];

  const bb = bboxOf(pts.map(p => [p.x, p.y]));
  const dmax = Math.max(bb.w, bb.h) || 1;
  const midx = (bb.minX + bb.maxX) / 2, midy = (bb.minY + bb.maxY) / 2;

  const s1 = { x: midx - 20 * dmax, y: midy - dmax, z: 0, id: -1 };
  const s2 = { x: midx, y: midy + 20 * dmax, z: 0, id: -2 };
  const s3 = { x: midx + 20 * dmax, y: midy - dmax, z: 0, id: -3 };

  let tris = [[s1, s2, s3]];
  const work = pts.map((p, i) => ({ ...p, id: i }));

  for (const pt of work) {
    const bad = [];
    for (const t of tris) if (inCircumcircle(pt, t)) bad.push(t);

    // Arêtes du "trou" : celles qui n'appartiennent qu'à un seul mauvais triangle
    const count = new Map();
    for (const t of bad) {
      for (const e of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
        const k = e[0].id < e[1].id ? `${e[0].id}|${e[1].id}` : `${e[1].id}|${e[0].id}`;
        const rec = count.get(k);
        if (rec) rec.n++; else count.set(k, { n: 1, e });
      }
    }
    tris = tris.filter(t => !bad.includes(t));
    for (const { n: c, e } of count.values()) if (c === 1) tris.push([e[0], e[1], pt]);
  }

  const out = [];
  for (const t of tris) {
    if (t[0].id < 0 || t[1].id < 0 || t[2].id < 0) continue;
    if (clipPoly) {
      const cx = (t[0].x + t[1].x + t[2].x) / 3;
      const cy = (t[0].y + t[1].y + t[2].y) / 3;
      if (!pointInPoly(cx, cy, clipPoly)) continue;
    }
    out.push(t);
  }
  return out;
}

function inCircumcircle(p, t) {
  const [A, B, C] = t;
  const D = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
  if (Math.abs(D) < 1e-12) return false;
  const a2 = A.x * A.x + A.y * A.y, b2 = B.x * B.x + B.y * B.y, c2 = C.x * C.x + C.y * C.y;
  const ux = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / D;
  const uy = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / D;
  const r2 = (A.x - ux) ** 2 + (A.y - uy) ** 2;
  return (p.x - ux) ** 2 + (p.y - uy) ** 2 <= r2 * (1 + 1e-9);
}

/* ---------------- Surfaces de référence (projet) ---------------- */

/**
 * Fabrique un évaluateur Z pour la surface "PLAN" (facettes TIN rigides).
 * Correction : plus de tolérance barycentrique de ±5 % (qui faisait se
 * chevaucher les facettes) et, hors triangulation, on projette sur le
 * triangle le PLUS PROCHE EN DISTANCE RÉELLE, pas sur son barycentre.
 */
function makePlaneSurface(borderPts, clipPoly) {
  const tris = delaunay(borderPts, clipPoly);
  if (!tris.length) {
    // Repli : plan des moindres carrés sur les points de bordure
    return leastSquaresPlane(borderPts);
  }
  const cache = tris.map(t => ({
    t,
    minX: Math.min(t[0].x, t[1].x, t[2].x), maxX: Math.max(t[0].x, t[1].x, t[2].x),
    minY: Math.min(t[0].y, t[1].y, t[2].y), maxY: Math.max(t[0].y, t[1].y, t[2].y)
  }));

  const f = (x, y) => {
    for (const c of cache) {
      if (x < c.minX || x > c.maxX || y < c.minY || y > c.maxY) continue;
      const b = barycentric(x, y, c.t);
      if (b && b.u >= -1e-9 && b.v >= -1e-9 && b.w >= -1e-9) {
        return b.u * c.t[0].z + b.v * c.t[1].z + b.w * c.t[2].z;
      }
    }
    // Hors TIN : projection sur le triangle le plus proche (distance au bord)
    let bestD = Infinity, bestZ = null;
    for (const c of cache) {
      const pr = closestPointOnTriangle(x, y, c.t);
      if (pr.d2 < bestD) { bestD = pr.d2; bestZ = pr.z; }
    }
    return bestZ;
  };
  f.triangles = tris;
  return f;
}

function barycentric(px, py, t) {
  const [A, B, C] = t;
  const d = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
  if (Math.abs(d) < 1e-12) return null;
  const u = ((B.y - C.y) * (px - C.x) + (C.x - B.x) * (py - C.y)) / d;
  const v = ((C.y - A.y) * (px - C.x) + (A.x - C.x) * (py - C.y)) / d;
  return { u, v, w: 1 - u - v };
}

function closestPointOnTriangle(px, py, t) {
  let bestD = Infinity, bestZ = t[0].z;
  for (let i = 0; i < 3; i++) {
    const A = t[i], B = t[(i + 1) % 3];
    const dx = B.x - A.x, dy = B.y - A.y;
    const L2 = dx * dx + dy * dy;
    let s = L2 > 0 ? ((px - A.x) * dx + (py - A.y) * dy) / L2 : 0;
    s = Math.max(0, Math.min(1, s));
    const qx = A.x + s * dx, qy = A.y + s * dy;
    const d2 = (px - qx) ** 2 + (py - qy) ** 2;
    if (d2 < bestD) { bestD = d2; bestZ = A.z + s * (B.z - A.z); }
  }
  return { d2: bestD, z: bestZ };
}

function leastSquaresPlane(pts) {
  const n = pts.length;
  if (!n) return () => null;
  let sx = 0, sy = 0, sz = 0, sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const p of pts) {
    sx += p.x; sy += p.y; sz += p.z;
    sxx += p.x * p.x; sxy += p.x * p.y; syy += p.y * p.y;
    sxz += p.x * p.z; syz += p.y * p.z;
  }
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const b = [sxz, syz, sz];
  const sol = solve3(A, b);
  if (!sol) { const zm = sz / n; return () => zm; }
  return (x, y) => sol[0] * x + sol[1] * y + sol[2];
}

function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/**
 * Surface "COURBE" (talutage souple) — pondération inverse de la distance.
 * Correction majeure : l'ancienne formule w = 1/(d²+1) dépendait de l'unité
 * et NE PASSAIT PAS par les points de bordure (la surface projet ne
 * raccordait donc pas le terrain naturel au droit du contour, ce qui
 * faussait tous les volumes « Courbe »). Ici w = 1/d^p : la surface est
 * exactement égale à Z aux sommets du contour.
 */
function makeSmoothSurface(borderPts, power = 2) {
  const P = borderPts;
  return (x, y) => {
    let num = 0, den = 0;
    for (const p of P) {
      const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d2 < 1e-6) return p.z;
      const w = 1 / Math.pow(d2, power / 2);
      num += p.z * w; den += w;
    }
    return den > 0 ? num / den : null;
  };
}

/** Surface plane horizontale à cote constante. */
function makeFlatSurface(z) { return () => z; }


/* ---------------- Emprises multiples (surfaces composées) ---------------- */

/**
 * Une surface peut être composée de plusieurs emprises (« parties ») :
 * on trace une plateforme, puis on lui ajoute un talus, une aire de retournement…
 * et la cubature porte sur l'UNION des emprises.
 * `ptsGPS` reste la partie principale ; `extraRings` contient les suivantes.
 */
function ringsOf(d) {
  const r = [d.ptsGPS];
  if (d.extraRings && d.extraRings.length) for (const e of d.extraRings) if (e && e.length >= 3) r.push(e);
  return r;
}

/** Toutes les parties converties en Lambert-93. */
function ringsL93(d) { return ringsOf(d).map(ptsToL93); }

/** Le point est-il dans l'union des emprises ? */
function pointInRings(x, y, polys) {
  for (const p of polys) if (pointInPoly(x, y, p)) return true;
  return false;
}

function bboxOfRings(polys) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) {
    const b = bboxOf(p);
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Aire de l'union d'un ensemble de polygones, par balayage régulier.
 * Employée seulement quand les emprises se chevauchent : sans recouvrement,
 * la somme des aires exactes est utilisée (plus précise).
 */
function unionArea(polys, step) {
  if (polys.length === 1) return polyArea(polys[0]);
  const bb = bboxOfRings(polys);
  const st = step || Math.max(0.05, Math.sqrt(bb.w * bb.h / 200000));
  let a = 0;
  for (let y = bb.minY + st / 2; y <= bb.maxY; y += st)
    for (let x = bb.minX + st / 2; x <= bb.maxX; x += st)
      if (pointInRings(x, y, polys)) a += st * st;
  return a;
}

/** Les emprises se recouvrent-elles (test rapide par boîtes puis par sommets) ? */
function ringsOverlap(polys) {
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const a = bboxOf(polys[i]), b = bboxOf(polys[j]);
      if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
      if (polys[j].some(p => pointInPoly(p[0], p[1], polys[i]))) return true;
      if (polys[i].some(p => pointInPoly(p[0], p[1], polys[j]))) return true;
      return true;   // boîtes sécantes : on reste prudent
    }
  }
  return false;
}

/* ---------------- Outils pour le damage ---------------- */

/**
 * Axe principal d'un polygone (analyse en composantes principales sur les
 * sommets pondérés par la longueur des côtés).
 * @returns {{cx:number, cy:number, angle:number, long:number, larg:number}}
 *          angle en radians, `long`/`larg` = étendue selon l'axe et sa normale.
 */
function principalAxis(poly) {
  let sw = 0, cx = 0, cy = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const w = Math.hypot(poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]);
    cx += (poly[i][0] + poly[j][0]) / 2 * w;
    cy += (poly[i][1] + poly[j][1]) / 2 * w;
    sw += w;
  }
  if (sw === 0) return { cx: poly[0][0], cy: poly[0][1], angle: 0, long: 0, larg: 0 };
  cx /= sw; cy /= sw;

  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const w = Math.hypot(poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]);
    const mx = (poly[i][0] + poly[j][0]) / 2 - cx;
    const my = (poly[i][1] + poly[j][1]) / 2 - cy;
    sxx += mx * mx * w; syy += my * my * w; sxy += mx * my * w;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);

  // Étendues selon l'axe et sa normale
  const ca = Math.cos(angle), sa = Math.sin(angle);
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const p of poly) {
    const dx = p[0] - cx, dy = p[1] - cy;
    const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
    uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
  }
  return { cx, cy, angle, long: uMax - uMin, larg: vMax - vMin, uMin, uMax, vMin, vMax };
}

/**
 * Intervalles d'une droite infinie situés à l'intérieur d'un polygone.
 * La droite est paramétrée par un point d'origine et une direction unitaire.
 * @returns {Array<[number,number]>} couples d'abscisses curvilignes (règle pair-impair)
 */
function clipLineToPoly(ox, oy, dx, dy, poly) {
  const ts = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;              // parallèle
    const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den;   // sur la droite
    const u = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;   // sur le côté
    if (u >= 0 && u < 1) ts.push(t);                  // borne haute exclue : pas de doublon aux sommets
  }
  ts.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1] - ts[i] > 1e-6) out.push([ts[i], ts[i + 1]]);
  return out;
}

/** Intervalles intérieurs à l'union de plusieurs polygones, fusionnés. */
function clipLineToRings(ox, oy, dx, dy, polys) {
  let segs = [];
  for (const p of polys) segs = segs.concat(clipLineToPoly(ox, oy, dx, dy, p));
  segs.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged;
}

window.GEOM = {
  pointInPoly, signedArea, polyArea, polyPerimeter, bboxOf, circlePolygonL93,
  measure, developedArea, delaunay, makePlaneSurface, makeSmoothSurface,
  makeFlatSurface, leastSquaresPlane, triArea3D,
  ringsOf, ringsL93, pointInRings, bboxOfRings, unionArea, ringsOverlap,
  principalAxis, clipLineToPoly, clipLineToRings
};
window.ringsOf = ringsOf;
