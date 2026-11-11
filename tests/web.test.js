// Test de bout en bout : l'interface web (web/) dans Chromium, format iPhone,
// reliée au chargeur + API simulés (tests/harness.js). Nécessite Playwright.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { makeEnv, API_KEY } = require('./harness');

const SITE = 'https://p69gp84gk7-arch.github.io/26altlasSB31/';
const API_URL = 'https://script.google.com/macros/s/TEST/exec';
const WEB = path.join(__dirname, '..', 'web');
const LINK = SITE + '#connexion=' + encodeURIComponent(API_URL) + '&cle=' + API_KEY;
const fixture = name => path.join(__dirname, name);

async function openApp(env) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  if (process.env.DEBUG_WEB) { page.on('console', m => console.log('console:', m.text())); page.on('requestfailed', r => console.log('failed:', r.url(), r.failure().errorText)); }
  await context.route(SITE + '**', route => {
    const file = new URL(route.request().url()).pathname.replace('/26altlasSB31/', '') || 'index.html';
    const p = path.join(WEB, file);
    if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ body: fs.readFileSync(p), contentType: file.endsWith('.html') ? 'text/html; charset=utf-8' : undefined });
  });
  await context.route(API_URL, route => {
    const req = JSON.parse(route.request().postData());
    const out = env.ctx.doPost({ postData: { contents: JSON.stringify(req) } });
    route.fulfill({ body: out.getContent(), contentType: 'application/json', headers: { 'access-control-allow-origin': '*' } });
  });
  return { browser, page, errors };
}

test('connexion, interventions, photos et factures depuis le site GitHub Pages', { timeout: 120000 }, async () => {
  const env = makeEnv();
  const { browser, page, errors } = await openApp(env);
  try {
    // Sans connexion : écran de connexion
    await page.goto(SITE);
    await page.waitForSelector('#viewSetup:not(.hidden)');

    // Lien de connexion : mémorisé puis retiré de la barre d'adresse
    await page.goto(LINK);
    await page.waitForSelector('#viewList:not(.hidden) .empty');
    assert.equal(new URL(page.url()).hash, '');

    // Nouvelle intervention + photo (enregistrement automatique)
    await page.click('#btnNew');
    await page.fill('#nom', 'Dupont');
    await page.fill('#prenom', 'Marie');
    await page.fill('#telephone', '0612345678');
    await page.fill('#piece', 'Pompe de vidange');
    // Listes déroulantes : valeurs de l'onglet « Listes » + nouvelle marque via « Autre… »
    await page.waitForFunction(() => [...document.querySelectorAll('#appareil option')].some(o => o.value === 'Lave-linge'));
    await page.selectOption('#appareil', 'Lave-linge');
    await page.selectOption('#marque', '__autre__');
    await page.fill('#marqueAutre', 'Marque Inconnue');
    // Référence : liens de documentation préparés avec la marque et la référence
    assert.equal(await page.locator('#docLinks a').count(), 0);
    await page.fill('#reference', 'WAT28420FF/01');
    assert.equal(await page.locator('#docLinks a').count(), 7);
    const vue = decodeURIComponent(await page.getAttribute('#docLinks a >> nth=0', 'href'));
    assert.match(vue, /Marque Inconnue "WAT28420FF\/01" vue éclatée/);
    await page.fill('#dateDiagnostic', '2026-11-10');
    // Temps passés : 30 min de diagnostic + 1 h 15 de réparation
    await page.selectOption('#tempsDiagnostic', '30');
    await page.selectOption('#tempsReparation', '75');
    await page.fill('#montantPiece', '45,90');
    await page.fill('#montantRegle', '120');
    // Toucher le bouton doit ouvrir le sélecteur de fichiers (comme sur iPhone)
    const [photoChooser] = await Promise.all([page.waitForEvent('filechooser'), page.tap('#btnAddPhoto')]);
    assert.equal(photoChooser.isMultiple(), true);
    await photoChooser.setFiles(fixture('fixture-photo.jpg'));
    await page.waitForFunction(() => document.querySelectorAll('.ph img').length === 1 && !document.body.innerText.includes('Envoi…'));
    assert.equal(env.rows[1][0], 'INT-0001');
    assert.equal(env.rows[1][3], '0612345678');
    assert.equal(env.rows[1][5], 'Lave-linge');
    assert.equal(env.rows[1][6], 'Marque Inconnue');
    assert.equal(env.rows[1][7], 'WAT28420FF/01');
    assert.equal(env.rows[1][10], 30);
    assert.equal(env.rows[1][12], 75);
    assert.match(await page.textContent('#marginLine'), /Temps passé : 1 h 45/);
    assert.match(await page.textContent('#marginLine'), /42,34\s€ \/ heure/);

    // Facture liée depuis la fiche
    await page.click('#btnAddFacture');
    await page.waitForSelector('#viewFacture:not(.hidden)');
    assert.equal(await page.inputValue('#fIntervention'), 'INT-0001');
    assert.equal(await page.inputValue('#fMontant'), '45,90');
    await page.selectOption('#fFournisseur', '__autre__');
    await page.fill('#fFournisseurAutre', 'Pièces Express');
    const [pdfChooser] = await Promise.all([page.waitForEvent('filechooser'), page.tap('#btnPickFile')]);
    await pdfChooser.setFiles(fixture('fixture-facture.pdf'));
    await page.waitForFunction(() => document.getElementById('fFileName').textContent === 'fixture-facture.pdf');
    await page.click('#btnFSave');
    await page.waitForSelector('#viewForm:not(.hidden) #formFactures .item');
    assert.match(await page.textContent('#formFactures .total'), /45,90/);

    // Documentation : capture ajoutée depuis la fiche, rangée par appareil (référence)
    assert.match(await page.textContent('#formDocs'), /Aucun document/);
    await page.click('#btnFormAddDoc');
    await page.waitForSelector('#viewDoc:not(.hidden)');
    assert.equal(await page.inputValue('#dReference'), 'WAT28420FF/01');
    assert.equal(await page.inputValue('#dMarque'), 'Marque Inconnue');
    await page.selectOption('#dCategorie', 'Vue éclatée');
    await page.fill('#dTitre', 'Tambour');
    const [docChooser] = await Promise.all([page.waitForEvent('filechooser'), page.tap('#btnPickDoc')]);
    await docChooser.setFiles(fixture('fixture-photo.jpg'));
    await page.waitForSelector('#dPreview img');
    await page.click('#btnDSave');
    await page.waitForSelector('#viewForm:not(.hidden) #formDocs .doc-tile img');
    const docRow = env.extraSheets.Documentation._rows[1];
    assert.deepEqual(docRow.slice(0, 6), ['DOC-0001', 'WAT28420FF/01', 'Marque Inconnue', 'Lave-linge', 'Vue éclatée', 'Tambour']);
    const docFile = Object.values(env.items).find(x => x._kind === 'file' && x._name.startsWith('Vue éclatée - Tambour'));
    assert.equal(docFile._parent.getName(), 'Marque Inconnue WAT28420FF-01');
    assert.equal(docFile._bytes.length, fs.statSync(fixture('fixture-photo.jpg')).size, 'capture envoyée sans recompression');

    // Fiche appareil : documents + interventions ; ajout d'un schéma en PDF
    await page.click('#btnFormMachine');
    await page.waitForSelector('#viewMachine:not(.hidden)');
    assert.equal(await page.textContent('#mTitle'), 'Marque Inconnue WAT28420FF/01');
    assert.equal(await page.locator('#mInterventions .item').count(), 1);
    await page.click('#btnMAddDoc');
    await page.selectOption('#dCategorie', 'Schéma électrique');
    const [pdfDocChooser] = await Promise.all([page.waitForEvent('filechooser'), page.tap('#btnPickDoc')]);
    await pdfDocChooser.setFiles(fixture('fixture-facture.pdf'));
    await page.waitForFunction(() => document.getElementById('dFileName').textContent === 'fixture-facture.pdf');
    await page.click('#btnDSave');
    await page.waitForSelector('#viewMachine:not(.hidden)');
    await page.waitForFunction(() => document.querySelectorAll('#mDocs .doc-tile').length === 2);
    assert.match(await page.textContent('#mDocs'), /PDF/);
    await page.click('#btnMBack');
    await page.waitForSelector('#viewForm:not(.hidden)');
    assert.equal(await page.locator('#formDocs .doc-tile').count(), 2);

    // Terminer, revenir à la liste
    await page.check('#termine');
    await page.click('#btnSave');
    await page.waitForFunction(() => document.getElementById('toast').textContent === 'Fiche enregistrée');
    await page.click('#btnBack');
    assert.equal(await page.locator('#list .item').count(), 1);
    assert.match(await page.textContent('#stMargin'), /74,10/);

    // Onglet factures
    await page.click('[data-tab=factures]');
    await page.waitForSelector('#fList .item');
    assert.equal(await page.locator('#fList .item').count(), 1);

    // Onglet Documentation : l'appareil et ses 2 documents
    await page.click('[data-tab=docs]');
    await page.waitForSelector('#dList .item');
    assert.equal(await page.locator('#dList .item').count(), 1);
    assert.match(await page.textContent('#dList'), /2 documents · 1 intervention/);
    await page.click('#dList .item');
    await page.waitForSelector('#viewMachine:not(.hidden)');
    await page.click('#mDocs .doc-tile >> nth=1');
    await page.waitForSelector('#viewDoc:not(.hidden)');
    await page.fill('#dTitre', 'Carte de puissance');
    await page.click('#btnDSave');
    await page.waitForSelector('#viewMachine:not(.hidden)');
    assert.match(await page.textContent('#mDocs'), /Carte de puissance/);
    await page.click('#btnMBack');
    await page.click('[data-tab=factures]');

    // Nouvelle facture : le fournisseur déjà enregistré est proposé dans la liste
    await page.click('#btnNewFacture');
    const fournisseurs = await page.$$eval('#fFournisseur option', os => os.map(o => o.value));
    assert.ok(fournisseurs.includes('Pièces Express'));
    await page.click('#btnFBack');

    // La nouvelle marque est proposée dans les fiches suivantes
    await page.click('#btnNew');
    const marques = await page.$$eval('#marque option', os => os.map(o => o.value));
    assert.ok(marques.includes('Marque Inconnue') && marques.includes('Bosch'));
    await page.click('#btnBack');

    // Rechargement : la connexion est gardée sur l'appareil
    await page.goto(SITE);
    await page.waitForSelector('#list .item');
    assert.equal(await page.locator('#list .item').count(), 1);

    // Clé changée côté serveur : retour à l'écran de connexion
    env.props.API_KEY = 'nouvelle-cle';
    await page.goto(SITE);
    await page.waitForSelector('#viewSetup:not(.hidden)');
    assert.match(await page.textContent('#setupMsg'), /Clé de connexion invalide/);

    // Reconnexion en collant le lien
    env.props.API_KEY = API_KEY;
    await page.fill('#setupLink', LINK);
    await page.click('#btnSetup');
    await page.waitForSelector('#viewList:not(.hidden) #list .item');

    // Appareil neuf : le lien ouvert directement (chargement complet) connecte l'appareil
    await page.evaluate(() => localStorage.clear());
    await page.goto('about:blank');
    await page.goto(LINK);
    await page.waitForSelector('#viewList:not(.hidden) #list .item');
    assert.equal(new URL(page.url()).hash, '');

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
