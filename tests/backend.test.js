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
  let r1 = api('saveIntervention', { nom: 'Dupont', prenom: 'Marie', telephone: '0612345678', dateAppel: '2026-11-10',
    dateIntervention: '2026-11-12', piece: 'Pompe', montantPiece: '45,90', montantRegle: '120', termine: false });
  assert.equal(r1.id, 'INT-0001');
  assert.equal(r1.telephone, '0612345678');
  assert.equal(r1.montantPiece, 45.9);
  assert.equal(r1.dateAppel, '2026-11-10');
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
  assert.match(rows[1][13], /folders\//);
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
