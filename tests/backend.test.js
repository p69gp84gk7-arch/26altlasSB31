// Tests du chargeur (apps-script/Code.gs) et de l'API (backend/api.js) avec des services Google simulés.
const test = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./harness');

const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64');
const jpg = 'data:image/jpeg;base64,' + Buffer.from('jpg').toString('base64');

test('chargeur : clé obligatoire, actions inconnues refusées, code lu depuis GitHub puis mis en cache', () => {
  const env = makeEnv();
  assert.deepEqual(env.post('listInterventions', [], 'mauvaise-cle').code, 'AUTH');
  assert.equal(env.post('listInterventions', [], null).code, 'AUTH');
  assert.match(env.post('eval', []).error, /Action inconnue/);
  assert.deepEqual(env.api('listInterventions'), []);
  env.api('listFactures');
  assert.equal(env.fetches.length, 1, 'le code GitHub ne doit être téléchargé qu\'une fois');
  assert.ok(env.fetches[0].startsWith('https://raw.githubusercontent.com/p69gp84gk7-arch/26altlasSB31/main/backend/api.js'));
  assert.ok(env.api('reload').version);
  assert.equal(env.fetches.length, 2, 'reload force un nouveau téléchargement');
});

test('chargeur : copie de secours si GitHub est indisponible', () => {
  const env = makeEnv();
  env.api('listInterventions');
  delete env.cacheStore.api_fresh;
  const down = makeEnv({ githubDown: true });
  assert.match(down.post('listInterventions', []).error, /GitHub/);
  Object.assign(down.cacheStore, { api_backup: env.cacheStore.api_backup });
  assert.deepEqual(down.api('listInterventions'), []);
});

test('interventions : création, numérotation, montants, téléphone en texte, mise à jour, suppression', () => {
  const { api, rows } = makeEnv();
  let r1 = api('saveIntervention', { nom: 'Dupont', prenom: 'Marie', telephone: '0612345678', dateDiagnostic: '2026-11-10',
    dateIntervention: '2026-11-12', piece: 'Pompe', montantPiece: '45,90', montantRegle: '120', termine: false });
  assert.equal(r1.id, 'INT-0001');
  assert.equal(r1.telephone, '0612345678');
  assert.equal(r1.montantPiece, 45.9);
  assert.equal(r1.dateDiagnostic, '2026-11-10');
  assert.equal(r1.dateIntervention, '2026-11-12');
  const r2 = api('saveIntervention', { nom: 'Martin', prenom: 'Paul' });
  assert.equal(r2.id, 'INT-0002');
  assert.equal(r2.montantPiece, '');
  r1 = api('saveIntervention', Object.assign({}, r1, { termine: true, montantRegle: '130.5' }));
  assert.equal(r1.termine, true);
  assert.equal(r1.montantRegle, 130.5);
  assert.equal(rows.length, 3);
  assert.deepEqual(api('listInterventions').map(x => x.id), ['INT-0002', 'INT-0001']);
  assert.throws(() => api('saveIntervention', { nom: '' }), /obligatoire/);
  assert.throws(() => api('saveIntervention', { nom: 'X', montantPiece: 'abc' }), /Montant invalide/);
  api('deleteIntervention', 'INT-0001');
  assert.equal(api('listInterventions').length, 1);
  assert.equal(api('saveIntervention', { nom: 'Z' }).id, 'INT-0003');
});

test('photos : dossier créé au premier envoi, renommé avec le client, suppression vers la corbeille', () => {
  const { api, rows, items, photosRoot } = makeEnv();
  const r1 = api('saveIntervention', { nom: 'Dupont', prenom: 'Marie' });
  assert.deepEqual(api('listPhotos', r1.id), { folderUrl: '', photos: [] });
  const ph = api('uploadPhoto', r1.id, 'a.jpg', jpg);
  assert.equal(api('listPhotos', r1.id).photos.length, 1);
  assert.match(rows[1][16], /folders\//);
  assert.equal(api('getPhotoData', ph.id), jpg);
  api('saveIntervention', Object.assign({}, r1, { nom: 'Durand' }));
  const folder = Object.values(items).find(x => x._kind === 'folder' && x._parent === photosRoot);
  assert.equal(folder.getName(), 'INT-0001 - Durand Marie');
  assert.throws(() => api('getPhotoData', photosRoot.getId()));
  api('deletePhoto', ph.id);
  assert.equal(api('listPhotos', r1.id).photos.length, 0);
});

test('factures : archivage, contrôles, rangement par année, renommage et suppression', () => {
  const { api, items, frows, facturesRoot } = makeEnv();
  const iv = api('saveIntervention', { nom: 'Dupont', prenom: 'Marie' });
  assert.throws(() => api('saveFacture', { date: '2026-11-12' }), /fichier/);
  assert.throws(() => api('saveFacture', { fournisseur: 'X' }, { name: 'a.pdf', dataUrl: pdf }), /date/);
  assert.throws(() => api('saveFacture', { date: '2026-11-12', intervention: 'INT-9999' }, { name: 'a.pdf', dataUrl: pdf }), /introuvable/);
  assert.throws(() => api('saveFacture', { date: '2026-11-12' }, { name: 'a.txt', dataUrl: 'data:text/plain;base64,eHg=' }), /PDF ou image/);

  let f1 = api('saveFacture', { date: '2026-11-12', fournisseur: 'Pièces Express', numero: '00123', piece: 'Pompe',
    montant: '45,90', intervention: iv.id }, { name: 'facture.pdf', dataUrl: pdf });
  assert.equal(f1.id, 'FAC-0001');
  assert.equal(f1.client, 'Dupont Marie');
  assert.equal(f1.montant, 45.9);
  assert.equal(f1.numero, '00123');
  const file = Object.values(items).find(x => x._kind === 'file');
  assert.equal(file.getName(), '2026-11-12_Pièces-Express_00123_FAC-0001.pdf');
  assert.equal(file._parent.getName(), '2026');
  assert.equal(file._parent._parent, facturesRoot);

  const f2 = api('saveFacture', { date: '2025-12-30', fournisseur: 'Stock SA' }, { name: 'IMG_1.jpg', dataUrl: jpg });
  assert.equal(f2.id, 'FAC-0002');
  assert.equal(f2.intervention, '');
  assert.deepEqual(api('listFactures').map(x => x.id), ['FAC-0001', 'FAC-0002']);

  f1 = api('saveFacture', Object.assign({}, f1, { date: '2025-06-01', numero: 'A-9' }));
  assert.equal(file.getName(), '2025-06-01_Pièces-Express_A-9_FAC-0001.pdf');
  assert.equal(file._parent.getName(), '2025');
  assert.equal(Object.values(items).filter(x => x._kind === 'folder' && x._name === '2025').length, 1);
  assert.equal(f1.fichier, frows[1][8]);

  api('deleteFacture', 'FAC-0001');
  assert.equal(file._trashed, true);
  assert.equal(api('listFactures').length, 1);
  assert.equal(api('saveFacture', { date: '2026-01-01' }, { name: 'x.pdf', dataUrl: pdf }).id, 'FAC-0003');
  assert.match(api('getLinks').facturesUrl, /1X2tx/);
});

test('chargeur : lien de connexion envoyé par e-mail (utilisable depuis un téléphone)', () => {
  const sansAdresse = makeEnv();
  assert.doesNotThrow(() => sansAdresse.ctx.onOpen(), 'onOpen ne doit pas planter sans interface');
  assert.throws(() => sansAdresse.ctx.envoyerLienParEmail(), /ADRESSE_API/);

  const exec = 'https://script.google.com/macros/s/AKfyTEST/exec';
  const env = makeEnv({ deployedUrl: exec });
  const link = env.ctx.envoyerLienParEmail();
  assert.equal(env.mails.length, 1);
  assert.equal(env.mails[0].to, 'moi@example.com');
  assert.ok(env.mails[0].htmlBody.includes(link));
  // Le lien est lu par l'application comme dans web/index.html (parseLink)
  const params = new URLSearchParams(link.slice(link.indexOf('#') + 1));
  assert.ok(link.startsWith('https://p69gp84gk7-arch.github.io/26altlasSB31/#'));
  assert.equal(params.get('connexion'), exec);
  assert.equal(params.get('cle'), env.props.API_KEY);
  assert.equal(env.props.WEBAPP_URL, exec);
  // La clé du lien est acceptée par l'API
  assert.equal(env.post('listInterventions', [], params.get('cle')).ok, true);

  // Nouvelle clé : l'ancienne est refusée, un nouveau lien est envoyé
  env.ctx.changerCle();
  assert.equal(env.mails.length, 2);
  assert.equal(env.post('listInterventions', [], params.get('cle')).code, 'AUTH');
});

test('feuille : colonne Marque ajoutée automatiquement, données existantes décalées, titres à jour', () => {
  const { api, rows, ctx } = makeEnv();
  // Ligne écrite par l'ancienne version (sans Marque, « Date de l'appel » en H)
  const d = new ctx.Date(2026, 10, 10, 12);
  rows.push(['INT-0001', 'Dupont', 'Marie', '0612345678', '', 'Lave-linge Bosch', 'Fuite', d, '', 'Pompe', 45.9, 120, true, '', d, d]);
  const list = api('listInterventions');
  assert.equal(rows[0][5], "Type d'appareil");
  assert.equal(rows[0][6], 'Marque');
  assert.equal(rows[0][8], 'Date de diagnostic');
  assert.equal(rows[0][9], 'Temps diagnostic (min)');
  assert.equal(rows[0][10], "Date d'intervention");
  assert.equal(rows[0][11], 'Temps réparation (min)');
  assert.equal(rows[0][19], 'Marge (€)', 'la colonne de marge se décale en T');
  assert.equal(list[0].appareil, 'Lave-linge Bosch');
  assert.equal(list[0].marque, '');
  assert.equal(list[0].panne, 'Fuite');
  assert.equal(list[0].dateDiagnostic, '2026-11-10');
  assert.equal(list[0].montantPiece, 45.9);
  assert.equal(list[0].termine, true);
  // Une seule insertion, même après plusieurs appels
  api('listInterventions');
  assert.equal(rows[0].filter(h => h === 'Marque').length, 1);
  assert.equal(rows[0].filter(h => h === 'Temps réparation (min)').length, 1);
});

test('feuille : depuis la version avec Marque, seules les colonnes de temps sont ajoutées', () => {
  const { api, rows, ctx } = makeEnv();
  // Feuille telle qu'elle est après la mise à jour « Marque » (état réel actuel)
  rows[0] = ['ID', 'Nom', 'Prénom', 'Téléphone', 'Adresse', "Type d'appareil", 'Marque', 'Panne / travaux',
    'Date de diagnostic', "Date d'intervention", 'Pièce utilisée', 'Montant pièce (€)', 'Montant réglé (€)',
    'Terminé', 'Dossier photos', 'Créé le', 'Modifié le', 'Marge (€)'];
  const d = new ctx.Date(2026, 9, 31, 12), d2 = new ctx.Date(2026, 10, 7, 12);
  rows.push(['INT-0001', 'Jalabert', 'Jean Philippe', '', '', 'Sèche-linge', 'Whirlpool', 'Courroie HS', d, d2,
    'Courroie', 25.98, '', false, 'https://drive.google.com/drive/folders/abc', d, d]);
  const it = api('listInterventions')[0];
  assert.equal(rows[0].length, 20);
  assert.equal(it.marque, 'Whirlpool');
  assert.equal(it.dateDiagnostic, '2026-10-31');
  assert.equal(it.tempsDiagnostic, '');
  assert.equal(it.dateIntervention, '2026-11-07');
  assert.equal(it.piece, 'Courroie');
  assert.equal(it.montantPiece, 25.98);
  assert.equal(it.dossierPhotos, 'https://drive.google.com/drive/folders/abc');
});

test('temps : diagnostic et réparation en minutes, récapitulatif en heures', () => {
  const { api, rows, extraSheets } = makeEnv();
  const r = api('saveIntervention', { nom: 'Dupont', tempsDiagnostic: '30', tempsReparation: '75' });
  assert.equal(r.tempsDiagnostic, 30);
  assert.equal(r.tempsReparation, 75);
  assert.equal(rows[1][9], 30);
  assert.equal(rows[1][11], 75);
  assert.throws(() => api('saveIntervention', { nom: 'X', tempsReparation: '-5' }), /Durée invalide/);
  const r2 = api('saveIntervention', { id: r.id, nom: 'Dupont', tempsDiagnostic: '' });
  assert.equal(r2.tempsDiagnostic, '');
  assert.equal(r2.tempsReparation, 75, 'temps absent de la demande : conservé');
  const recap = extraSheets['Récapitulatif']._rows;
  assert.deepEqual(recap.slice(8).map(x => x[0]), ['Temps de diagnostic (h)', 'Temps de réparation (h)', 'Marge par heure (€/h)']);
  assert.equal(recap[8][1], '=SUM(Interventions!J2:J)/60');
  assert.equal(recap[9][1], '=SUM(Interventions!L2:L)/60');
  assert.equal(recap[10][1], '=IFERROR(B7/(B9+B10))');
  api('listInterventions');
  assert.equal(recap.length, 11, 'lignes ajoutées une seule fois');
});

test('interventions : un champ absent (ancienne application) garde sa valeur', () => {
  const { api } = makeEnv();
  const r = api('saveIntervention', { nom: 'Dupont', appareil: 'Four', marque: 'Bosch', dateDiagnostic: '2026-11-10', montantPiece: '20' });
  const r2 = api('saveIntervention', { id: r.id, nom: 'Dupont', dateAppel: '2026-11-12' });
  assert.equal(r2.marque, 'Bosch');
  assert.equal(r2.appareil, 'Four');
  assert.equal(r2.montantPiece, 20);
  assert.equal(r2.dateDiagnostic, '2026-11-12', 'dateAppel (ancien nom) est accepté');
});

test('listes déroulantes : onglet Listes créé, valeurs enregistrées ajoutées, sans doublon, triées', () => {
  const { api, extraSheets } = makeEnv();
  api('saveIntervention', { nom: 'A', appareil: 'Robot pâtissier', marque: 'KitchenAid' });
  api('saveIntervention', { nom: 'B', appareil: 'four', marque: 'bosch' });
  api('saveFacture', { date: '2026-11-12', fournisseur: 'Pièces Express' }, { name: 'a.pdf', dataUrl: pdf });
  api('saveFacture', { date: '2026-11-12', fournisseur: 'Agora Pièces' }, { name: 'b.pdf', dataUrl: pdf });
  api('saveFacture', { date: '2026-11-12', fournisseur: 'pièces express' }, { name: 'c.pdf', dataUrl: pdf });
  const l = api('getListes');
  assert.ok(extraSheets.Listes, 'onglet Listes créé');
  assert.equal(extraSheets.Listes._rows[0][0], "Types d'appareil");
  assert.ok(l.types.includes('Lave-linge') && l.types.includes('Robot pâtissier'));
  assert.equal(l.types.filter(t => t.toLowerCase() === 'four').length, 1);
  assert.ok(l.marques.includes('KitchenAid') && l.marques.includes('Whirlpool'));
  assert.equal(l.marques.filter(m => m.toLowerCase() === 'bosch').length, 1);
  assert.deepEqual(l.fournisseurs, ['Agora Pièces', 'Pièces Express']);
  assert.deepEqual(l.marques, [...l.marques].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })));
  // Valeur ajoutée à la main dans l'onglet Listes
  extraSheets.Listes._rows.push(['', '', 'Fournisseur Manuel']);
  assert.ok(api('getListes').fournisseurs.includes('Fournisseur Manuel'));
});
