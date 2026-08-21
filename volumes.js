/* =====================================================================
   VOLUMES — Moteur de cubature (déblai / remblai)
   =====================================================================
   CORRECTIONS APPORTÉES PAR RAPPORT À LA VERSION D'ORIGINE
   ---------------------------------------------------------------------
   1) INVERSION DÉBLAI / REMBLAI
      L'ancien code additionnait dans `tTas` le terrain SITUÉ AU-DESSUS du
      projet (= matière à excaver = DÉBLAI) puis l'affichait sous le nom
      « Remblai », et inversement. Les profils en travers, eux, utilisaient
      la bonne convention : les deux outils se contredisaient.
      → Convention unique désormais :
            DÉBLAI  = Σ (Zterrain − Zprojet)⁺   (à excaver / à évacuer)
            REMBLAI = Σ (Zprojet − Zterrain)⁺   (à apporter)

   2) SURFACE DE LA MAILLE JAMAIS PRISE EN COMPTE
      L'ancien code sommait des hauteurs (m) et affichait des m³ : cela ne
      « marchait » que parce que le pas valait exactement 1 m. Le volume
      est maintenant Σ Δz × pas², avec un pas adaptatif.

   3) MAILLES DE BORDURE
      Une maille était comptée entièrement ou pas du tout selon que son
      centre tombait dans le polygone : sur une petite plateforme l'erreur
      atteignait facilement 10 %. Les mailles coupées par le contour sont
      désormais sous-échantillonnées (n×n) et pondérées par leur taux de
      recouvrement réel.

   4) CONTRÔLE DE COHÉRENCE
      Le résultat expose la surface réellement intégrée par la grille et
      l'écart avec la surface exacte du polygone : si l'écart dépasse 1 %,
      un avertissement est affiché plutôt qu'un chiffre faussement précis.

   5) DONNÉES TERRAIN MANQUANTES
      Les trous du MNT ne sont plus comptés comme Δz = 0 ; leur surface est
      isolée et signalée.
   ===================================================================== */

'use strict';

const MAX_CELLS = 400000;   // plafond de mailles pour rester interactif

/**
 * Choisit un pas de grille adapté à l'emprise.
 * @returns {number} pas en mètres
 */
function autoStep(bb) {
  const area = Math.max(1, bb.w * bb.h);
  let step = Math.sqrt(area / 120000);            // ~120 000 mailles visées
  step = Math.max(0.10, Math.min(2.0, step));     // bornes raisonnables
  // Arrondi sur des valeurs « propres »
  const nice = [0.10, 0.20, 0.25, 0.50, 1.00, 2.00];
  return nice.reduce((a, b) => (Math.abs(b - step) < Math.abs(a - step) ? b : a));
}

/**
 * Cubature d'un tracé fermé contre une surface de référence.
 *
 * @param {object} d       tracé (type 'area' ou 'circle')
 * @param {string} mode    'flat' | 'plane' | 'smooth'
 * @param {object} opts    { refZ, step, subSample }
 * @returns {object} résultat structuré
 */
function computeVolume(d, mode, opts = {}) {
  // Une surface peut être composée de plusieurs emprises : on intègre sur l'union
  const rings = GEOM.ringsOf(d);
  const polys = (d.type === 'circle' && d.center && d.radius)
    ? [GEOM.circlePolygonL93(toL93(d.center.lng, d.center.lat), d.radius)]
    : rings.map(ptsToL93);
  const poly = polys[0];

  const bb = GEOM.bboxOfRings(polys);
  const overlapping = polys.length > 1 && GEOM.ringsOverlap(polys);
  const areaSum = polys.reduce((a, p) => a + GEOM.polyArea(p), 0);

  let step = opts.step && opts.step !== 'auto' ? Number(opts.step) : autoStep(bb);
  while ((bb.w / step) * (bb.h / step) > MAX_CELLS) step *= 1.5;
  const cellArea = step * step;
  const sub = Math.max(1, Math.min(6, opts.subSample ?? APP.settings.subSample));

  /* --- Surface de référence (le « projet ») --- */
  // Les points d'appui viennent de TOUTES les emprises : le plan de facettes et
  // la surface souple englobent ainsi la totalité de la zone terrassée.
  const border = [];
  polys.forEach((p93, ri) => {
    const ring = (d.type === 'circle') ? null : rings[ri];
    p93.forEach((p, i) => {
      const z = ring ? effectiveZ(ring[i]) : getZ(p);
      if (isValidZ(z)) border.push({ x: p[0], y: p[1], z });
    });
  });
  const clipHull = polys.length === 1 ? poly : null;   // pas de découpe stricte en multi-emprises

  let refFn, refLabel;
  if (mode === 'flat') {
    const z = Number(opts.refZ);
    if (!isValidZ(z)) return { error: 'Altitude de référence invalide.' };
    refFn = GEOM.makeFlatSurface(z);
    refLabel = `Plateforme à ${fmt(z)} m NGF`;
  } else if (mode === 'plane') {
    if (border.length < 3) return { error: 'Au moins 3 points avec altitude connue sont nécessaires.' };
    refFn = GEOM.makePlaneSurface(border, clipHull);
    refLabel = 'Plan de facettes (TIN sur le contour)';
  } else {
    if (border.length < 3) return { error: 'Au moins 3 points avec altitude connue sont nécessaires.' };
    refFn = GEOM.makeSmoothSurface(border, 2);
    refLabel = 'Surface souple (talutage lissé)';
  }

  /* --- Balayage de la grille --- */
  let cut = 0, fill = 0;            // m³ en place
  let areaCut = 0, areaFill = 0;    // m² concernés
  let areaGrid = 0, areaNoData = 0;
  let dzMax = 0, dzMin = 0;         // creux/bosse extrêmes (signés)
  let cells = 0;

  const x0 = bb.minX - step, x1 = bb.maxX + step;
  const y0 = bb.minY - step, y1 = bb.maxY + step;

  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const cx = x + step / 2, cy = y + step / 2;

      // Test rapide : les 4 coins + le centre de la maille
      const c0 = GEOM.pointInRings(x, y, polys);
      const c1 = GEOM.pointInRings(x + step, y, polys);
      const c2 = GEOM.pointInRings(x + step, y + step, polys);
      const c3 = GEOM.pointInRings(x, y + step, polys);
      const center = GEOM.pointInRings(cx, cy, polys);
      const allIn = c0 && c1 && c2 && c3 && center;
      const allOut = !c0 && !c1 && !c2 && !c3 && !center;
      if (allOut) continue;

      cells++;

      if (allIn) {
        // Maille pleine : un seul échantillon au centre
        accumulate(cx, cy, cellArea);
      } else {
        // Maille de bordure : sous-échantillonnage pondéré
        const subArea = cellArea / (sub * sub);
        for (let sy = 0; sy < sub; sy++) {
          for (let sx = 0; sx < sub; sx++) {
            const px = x + (sx + 0.5) * step / sub;
            const py = y + (sy + 0.5) * step / sub;
            if (GEOM.pointInRings(px, py, polys)) accumulate(px, py, subArea);
          }
        }
      }
    }
  }

  function accumulate(px, py, a) {
    const zT = getZ([px, py]);
    if (!isValidZ(zT)) { areaNoData += a; return; }
    const zP = refFn(px, py);
    if (!isValidZ(zP)) { areaNoData += a; return; }
    areaGrid += a;
    const dz = zT - zP;                    // > 0 : terrain au-dessus du projet
    if (dz > 0) { cut += dz * a; areaCut += a; if (dz > dzMax) dzMax = dz; }
    else if (dz < 0) { fill += -dz * a; areaFill += a; if (dz < dzMin) dzMin = dz; }
  }

  /* --- Contrôles de cohérence --- */
  const areaExact = overlapping ? GEOM.unionArea(polys, Math.min(step / 2, 0.25)) : areaSum;
  const warnings = [];
  if (polys.length > 1) {
    warnings.push(`Surface composée de ${polys.length} emprises` +
      (overlapping ? ` — recouvrement de ${fmtM2(areaSum - areaExact)} déduit du total.` : '.'));
  }
  const totalArea = areaGrid + areaNoData;
  const ecart = areaExact > 0 ? Math.abs(totalArea - areaExact) / areaExact * 100 : 0;
  if (ecart > 1) {
    warnings.push(`Écart d'intégration de ${fmt(ecart, 1)} % entre la grille (${fmtM2(totalArea)}) ` +
      `et la surface exacte (${fmtM2(areaExact)}) — réduisez le pas de calcul.`);
  }
  if (areaNoData > 0.01 * areaExact) {
    warnings.push(`${fmtM2(areaNoData)} (${fmt(areaNoData / areaExact * 100, 1)} %) sans donnée MNT : ` +
      `non pris en compte dans le volume.`);
  }
  if (cells < 200) {
    warnings.push('Emprise très petite au regard du pas de calcul : diminuez le pas pour fiabiliser le résultat.');
  }

  const S = APP.settings;
  return {
    mode, refLabel,
    refZ: mode === 'flat' ? Number(opts.refZ) : null,
    step, subSample: sub, cells,
    areaExact, areaGrid: totalArea, areaNoData,
    areaCut, areaFill,
    cut, fill,
    net: cut - fill,                          // > 0 : excédent de déblai
    cutFoisonne: cut * S.foisonnement,        // volume transporté (bennes)
    fillEnPlace: fill,
    fillApport: fill / S.tassement,           // matériau à approvisionner
    tonnesCut: cut * S.densite,
    epaisMoyCut: areaCut > 0 ? cut / areaCut : 0,
    epaisMoyFill: areaFill > 0 ? fill / areaFill : 0,
    dzMax, dzMin,
    warnings,
    date: new Date().toISOString()
  };
}

/** Libellé court d'un mode de cubature */
function modeLabel(mode) {
  return { flat: 'Plateforme (Z constant)', plane: 'Plan / facettes', smooth: 'Courbe / talutage' }[mode] || mode;
}

/**
 * Rendu HTML d'un résultat de cubature (panneau latéral).
 */
function volumeCardHtml(r, id, idx) {
  if (r.error) return `<div class="vol-card err">${escapeHtml(r.error)}</div>`;
  const bal = r.net >= 0
    ? `<span class="pos">Excédent de ${fmtM3(Math.abs(r.net))}</span> à évacuer`
    : `<span class="neg">Déficit de ${fmtM3(Math.abs(r.net))}</span> à apporter`;

  const inc = window.volumeUncertainty ? window.volumeUncertainty(r.areaGrid) : null;
  const incHtml = inc
    ? `<div class="vol-inc" title="Le MNT source code les altitudes en nombres entiers : cette marge traduit la précision réelle de la donnée, pas celle du calcul.">± ${fmt(inc, 0)} m³ liés à la précision verticale du MNT</div>`
    : '';

  return `<div class="vol-card">
    <div class="vol-head">
      <b>${escapeHtml(modeLabel(r.mode))}</b>
      <button class="icon-btn" title="Supprimer ce calcul" onclick="removeVolume(${id},${idx})">✕</button>
    </div>
    <div class="vol-sub">${escapeHtml(r.refLabel)} · pas ${fmt(r.step, 2)} m</div>
    <div class="vol-grid">
      <div class="vol-cell cut"><span>Déblai</span><b>${fmtM3(r.cut)}</b><i>${fmtM2(r.areaCut)} · ép. moy. ${fmt(r.epaisMoyCut)} m</i></div>
      <div class="vol-cell fill"><span>Remblai</span><b>${fmtM3(r.fill)}</b><i>${fmtM2(r.areaFill)} · ép. moy. ${fmt(r.epaisMoyFill)} m</i></div>
    </div>
    <div class="vol-bal">⚖️ Bilan : ${bal}</div>
    ${incHtml}
    <details class="vol-more"><summary>Détail chantier</summary>
      <div>Déblai foisonné (×${fmt(APP.settings.foisonnement, 2)}) : <b>${fmtM3(r.cutFoisonne)}</b> ≈ ${fmt(r.tonnesCut, 0)} t</div>
      <div>Apport pour remblai compacté (÷${fmt(APP.settings.tassement, 2)}) : <b>${fmtM3(r.fillApport)}</b></div>
      <div>Hauteur max de déblai : ${fmtM(r.dzMax)} · de remblai : ${fmtM(Math.abs(r.dzMin))}</div>
      <div>Surface intégrée : ${fmtM2(r.areaGrid)} / exacte ${fmtM2(r.areaExact)}${r.areaNoData > 0 ? ` · sans MNT ${fmtM2(r.areaNoData)}` : ''}</div>
      <div>${fmt(r.cells, 0)} mailles · sous-échantillonnage bordure ${r.subSample}×${r.subSample}</div>
    </details>
    ${r.warnings.map(w => `<div class="vol-warn">⚠️ ${escapeHtml(w)}</div>`).join('')}
  </div>`;
}

window.VOL = { computeVolume, modeLabel, volumeCardHtml, autoStep };
