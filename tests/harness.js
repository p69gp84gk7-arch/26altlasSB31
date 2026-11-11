/**
 * Simulation minimale des services Google Apps Script (SpreadsheetApp, DriveApp…)
 * pour tester le chargeur apps-script/Code.gs et l'API backend/api.js sans compte Google.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const API_SOURCE = fs.readFileSync(path.join(ROOT, 'backend/api.js'), 'utf8');
const LOADER_SOURCE = fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8');
const PHOTOS_ID = '1jgvigMTAK_tkB3WVTiqkmEa93CGMLKQh';
const FACTURES_ID = '1X2txYHkLIRCRfKAw1SOZR3qR1Egu69X8';
const DOCS_ID = '1c4z_x9nx9SSiQqPRckfbk4_eWaDmsB30';
const API_KEY = 'cle-de-test-0123456789abcdef0123456789abcdef0123456789abcdef0123';

function iter(a) { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; }

function mkSheet(header) {
  const rows = [header];
  const fmt = {};
  const cell = (r, c) => { const v = (rows[r - 1] || [])[c - 1]; return v === undefined ? '' : v; };
  return {
    _rows: rows,
    getLastRow: () => rows.length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
      getValue: () => cell(r, c),
      setValues: (vals) => vals.forEach((row, i) => {
        rows[r - 1 + i] = rows[r - 1 + i] || [];
        row.forEach((v, j) => {
          // Comme Sheets : une chaîne de chiffres devient un nombre, sauf format texte « @ ».
          if (typeof v === 'string' && /^\d+$/.test(v) && fmt[(r + i) + ':' + (c + j)] !== '@') v = Number(v);
          rows[r - 1 + i][c - 1 + j] = v;
        });
      }),
      setValue: (v) => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; },
      setFormula: (f) => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = f; },
      setNumberFormat: (f) => { fmt[r + ':' + c] = f; },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; },
    }),
    deleteRow: (r) => rows.splice(r - 1, 1),
    // Comme Sheets : les données à droite de la colonne se décalent d'un cran.
    insertColumnAfter: (c) => rows.forEach(row => { while (row.length < c) row.push(''); row.splice(c, 0, ''); }),
    insertColumnBefore: (c) => rows.forEach(row => { while (row.length < c - 1) row.push(''); row.splice(c - 1, 0, ''); }),
    getLastColumn: () => Math.max(...rows.map(r => r.length)),
    getMaxRows: () => Math.max(rows.length, 1000),
    setColumnWidth() {}, setColumnWidths() {}, setFrozenRows() {},
  };
}

function makeEnv(options = {}) {
  const items = {};
  let nid = 0;

  function mkFolder(name, parent, forcedId) {
    const id = forcedId || ('fold' + (++nid));
    const f = {
      _kind: 'folder', _name: name, _parent: parent, _trashed: false,
      getId: () => id, getName: () => f._name, setName: n => { f._name = n; },
      getUrl: () => 'https://drive.google.com/drive/folders/' + id,
      isTrashed: () => f._trashed, getParents: () => iter(f._parent ? [f._parent] : []),
      createFolder: n => mkFolder(n, f),
      getFoldersByName: n => iter(Object.values(items).filter(x => x._kind === 'folder' && x._parent === f && x._name === n)),
      createFile: blob => mkFile(blob, f),
      getFiles: () => iter(Object.values(items).filter(x => x._kind === 'file' && x._parent === f && !x._trashed)),
    };
    items[id] = f;
    return f;
  }
  function mkFile(blob, parent) {
    const id = 'file' + (++nid);
    const created = new Date(Date.now() + nid);
    const f = {
      _kind: 'file', _name: blob.name, _parent: parent, _trashed: false, _mime: blob.type, _bytes: blob.bytes,
      getId: () => id, getName: () => f._name, setName: n => { f._name = n; },
      getUrl: () => 'https://drive.google.com/file/d/' + id + '/view',
      getMimeType: () => f._mime, getDateCreated: () => created,
      getParents: () => iter([f._parent]), moveTo: p => { f._parent = p; },
      isTrashed: () => f._trashed, setTrashed: t => { f._trashed = t; },
      getBlob: () => ({ getContentType: () => f._mime, getBytes: () => f._bytes }),
    };
    items[id] = f;
    return f;
  }

  const photosRoot = mkFolder('Photos interventions', null, PHOTOS_ID);
  const facturesRoot = mkFolder('Factures pièces', null, FACTURES_ID);
  const docsRoot = mkFolder('Documentation technique', null, DOCS_ID);
  // Titres de la feuille réelle avant l'ajout de la colonne « Marque » (mise à jour automatique testée).
  const sheet = mkSheet(['ID', 'Nom', 'Prénom', 'Téléphone', 'Adresse', 'Appareil', 'Panne / travaux', "Date de l'appel",
    "Date d'intervention", 'Pièce utilisée', 'Montant pièce (€)', 'Montant réglé (€)', 'Terminé', 'Dossier photos',
    'Créé le', 'Modifié le', 'Marge (€)']);
  const fsheet = mkSheet(['ID', 'Date', 'Fournisseur', 'N°', 'Pièce', 'Montant', 'Intervention', 'Client', 'Fichier', 'Ajoutée le']);
  // Récapitulatif tel que créé à l'installation (lignes 1 à 8).
  const recap = mkSheet(['Indicateur', 'Valeur']);
  [['Interventions', '=COUNTA(Interventions!A2:A)'], ['Terminées', '=COUNTIF(…)'], ['En cours', '=B2-B3'],
    ['Total pièces (€)', '=SUM(…)'], ['Total réglé par les clients (€)', '=SUM(…)'], ['Marge (€)', '=B6-B5'],
    ['Total factures pièces archivées (€)', '=SUM(Factures!F2:F)']].forEach(r => recap._rows.push(r));
  const extraSheets = { 'Récapitulatif': recap };
  const ss = {
    getSheetByName: n => (n === 'Interventions' ? sheet : n === 'Factures' ? fsheet : extraSheets[n] || null),
    insertSheet: n => (extraSheets[n] = mkSheet([])),
    getSpreadsheetTimeZone: () => 'Europe/Paris',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/test',
  };

  const cacheStore = {};
  const props = { API_KEY };
  const fetches = [];
  const mails = [];
  const ctx = {
    console,
    SpreadsheetApp: { openById: () => ss, flush: () => {}, getUi: () => { throw new Error('pas d\'interface'); } },
    DriveApp: {
      getFolderById: id => { if (!items[id]) throw new Error('introuvable'); return items[id]; },
      getFileById: id => { if (!items[id]) throw new Error('introuvable'); return items[id]; },
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => 'Europe/Paris', getEffectiveUser: () => ({ getEmail: () => 'moi@example.com' }) },
    MailApp: { sendEmail: (msg) => { mails.push(msg); } },
    Logger: { log: () => {} },
    CacheService: { getScriptCache: () => ({ get: k => cacheStore[k] || null, put: (k, v) => { cacheStore[k] = v; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    UrlFetchApp: {
      fetch: (url) => {
        fetches.push(url);
        if (options.githubDown) return { getResponseCode: () => 503, getContentText: () => '' };
        return { getResponseCode: () => 200, getContentText: () => API_SOURCE };
      },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }),
    },
    Utilities: {
      formatDate: (d, tz, f) => {
        const p = n => String(n).padStart(2, '0');
        return f.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
          .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()));
      },
      parseDate: (s, tz, f) => {
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
        // Date du « bac à sable » (comme dans Apps Script) pour que instanceof Date fonctionne.
        return new ctx.Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      },
      base64Decode: s => Buffer.from(s, 'base64'),
      base64Encode: b => Buffer.from(b).toString('base64'),
      newBlob: (bytes, type, name) => {
        const b = { bytes, type, name, getContentType: () => b.type, setName: n => { b.name = n; }, getBytes: () => b.bytes };
        return b;
      },
      getUuid: () => require('crypto').randomUUID(),
    },
    HtmlService: {},
    ScriptApp: { getService: () => ({ getUrl: () => options.deployedUrl || null }) },
  };
  vm.createContext(ctx);
  ctx.Date = vm.runInContext('Date', ctx);
  vm.runInContext(LOADER_SOURCE, ctx);

  /** Appel HTTP simulé : POST JSON → réponse JSON du chargeur. */
  function post(action, args, key = API_KEY) {
    const out = ctx.doPost({ postData: { contents: JSON.stringify({ key, action, args }) } });
    return JSON.parse(out.getContent());
  }
  /** Appel direct d'une action (lève une erreur comme le ferait l'application). */
  function api(action, ...args) {
    const res = post(action, args);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  }

  return { ctx, post, api, mails, items, extraSheets, rows: sheet._rows, frows: fsheet._rows, photosRoot, facturesRoot, docsRoot, props, fetches, cacheStore };
}

module.exports = { makeEnv, API_KEY };
