/**
 * Fichier clients – Dépannages électroménager : logique serveur (API).
 *
 * CE FICHIER N'EST PAS À COLLER DANS APPS SCRIPT.
 * Il est téléchargé depuis GitHub (branche main) et exécuté par le petit chargeur
 * apps-script/Code.gs installé une seule fois dans la feuille. Toute modification
 * fusionnée dans main est donc prise en compte automatiquement (sous 5 minutes).
 *
 * Données :
 *  - les fiches d'intervention sont stockées dans la feuille Google Sheets « Interventions » ;
 *  - les photos sont rangées dans Google Drive, un sous-dossier par intervention,
 *    à l'intérieur du dossier « Photos interventions » ;
 *  - les factures des pièces commandées sont archivées dans le dossier Drive
 *    « Factures pièces » (un sous-dossier par année) et listées dans l'onglet « Factures ».
 *
 * Les fonctions appelables par l'application sont listées dans API.ACTIONS (en bas du fichier).
 */

// ---------------------------------------------------------------------------
// Configuration : identifiants de la feuille et des dossiers dans Drive.
// (créés dans le dossier Drive « Dépannages électroménager »)
// ---------------------------------------------------------------------------
var CONFIG = {
  SPREADSHEET_ID: '1n6WC_Ik14bE6ZwapDIAAXgPPw8xaqzCUeX0QENBxons',
  PHOTOS_FOLDER_ID: '1jgvigMTAK_tkB3WVTiqkmEa93CGMLKQh',
  FACTURES_FOLDER_ID: '1X2txYHkLIRCRfKAw1SOZR3qR1Egu69X8',
  SHEET_NAME: 'Interventions',
  FACTURES_SHEET_NAME: 'Factures',
  ID_PREFIX: 'INT-',
  FACTURE_PREFIX: 'FAC-',
  MAX_FILE_MB: 20
};

// Ordre des colonnes A → P de la feuille « Interventions ».
// La colonne Q (Marge) est calculée par une formule dans la feuille : le script n'y écrit jamais.
var COLUMNS = [
  'id',               // A  ID
  'nom',              // B  Nom
  'prenom',           // C  Prénom
  'telephone',        // D  Téléphone
  'adresse',          // E  Adresse
  'appareil',         // F  Appareil
  'panne',            // G  Panne / travaux
  'dateAppel',        // H  Date de l'appel
  'dateIntervention', // I  Date d'intervention
  'piece',            // J  Pièce utilisée
  'montantPiece',     // K  Montant pièce (€)
  'montantRegle',     // L  Montant réglé (€)
  'termine',          // M  Terminé
  'dossierPhotos',    // N  Dossier photos (lien Drive)
  'creeLe',           // O  Créé le
  'modifieLe'         // P  Modifié le
];
var COL = {};
COLUMNS.forEach(function (name, i) { COL[name] = i; });
var NB_COLS = COLUMNS.length;

// Ordre des colonnes A → J de l'onglet « Factures ».
var FAC_COLUMNS = [
  'id',           // A  ID
  'date',         // B  Date facture
  'fournisseur',  // C  Fournisseur
  'numero',       // D  N° facture
  'piece',        // E  Pièce
  'montant',      // F  Montant (€)
  'intervention', // G  Intervention (ID INT-xxxx, vide = stock)
  'client',       // H  Client (nom de l'intervention liée)
  'fichier',      // I  Fichier (lien Drive)
  'ajouteeLe'     // J  Ajoutée le
];
var FCOL = {};
FAC_COLUMNS.forEach(function (name, i) { FCOL[name] = i; });
var NB_FAC_COLS = FAC_COLUMNS.length;

// ---------------------------------------------------------------------------
// Fonctions appelées par l'application
// ---------------------------------------------------------------------------

/** Renvoie toutes les interventions, la plus récente en premier. */
function listInterventions() {
  var sh = getSheet_();
  var last = lastDataRow_(sh);
  if (last < 2) return [];
  var tz = getTimeZone_();
  var values = sh.getRange(2, 1, last - 1, NB_COLS).getValues();
  var out = [];
  values.forEach(function (row) {
    if (String(row[COL.id]).trim() === '') return;
    out.push(toRecord_(row, tz));
  });
  out.reverse();
  return out;
}

/**
 * Crée ou met à jour une intervention.
 * @param {Object} data champs du formulaire (id vide = nouvelle fiche)
 * @return {Object} la fiche enregistrée
 */
function saveIntervention(data) {
  data = data || {};
  if (!String(data.nom || '').trim()) {
    throw new Error('Le nom du client est obligatoire.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_();
    var tz = getTimeZone_();
    var now = new Date();
    var rowIndex = data.id ? findRow_(sh, data.id) : -1;
    var existing = null;

    if (data.id && rowIndex < 0) {
      throw new Error('Intervention introuvable : ' + data.id);
    }
    if (rowIndex > 0) {
      existing = sh.getRange(rowIndex, 1, 1, NB_COLS).getValues()[0];
    } else {
      rowIndex = lastDataRow_(sh) + 1;
    }

    var row = new Array(NB_COLS);
    row[COL.id] = existing ? existing[COL.id] : nextId_(sh);
    row[COL.nom] = clean_(data.nom);
    row[COL.prenom] = clean_(data.prenom);
    row[COL.telephone] = clean_(data.telephone);
    row[COL.adresse] = clean_(data.adresse);
    row[COL.appareil] = clean_(data.appareil);
    row[COL.panne] = clean_(data.panne);
    row[COL.dateAppel] = parseDate_(data.dateAppel);
    row[COL.dateIntervention] = parseDate_(data.dateIntervention);
    row[COL.piece] = clean_(data.piece);
    row[COL.montantPiece] = parseAmount_(data.montantPiece);
    row[COL.montantRegle] = parseAmount_(data.montantRegle);
    row[COL.termine] = data.termine === true || data.termine === 'true';
    row[COL.dossierPhotos] = existing ? existing[COL.dossierPhotos] : '';
    row[COL.creeLe] = existing ? existing[COL.creeLe] : now;
    row[COL.modifieLe] = now;

    // Le téléphone est enregistré comme texte (garde le 0 initial).
    var range = sh.getRange(rowIndex, 1, 1, NB_COLS);
    sh.getRange(rowIndex, COL.telephone + 1).setNumberFormat('@');
    range.setValues([row]);

    // Si le client a été renommé, on renomme aussi son dossier photos.
    if (existing && row[COL.dossierPhotos]) {
      var folder = folderFromUrl_(row[COL.dossierPhotos]);
      if (folder) {
        var wanted = folderName_(row);
        if (folder.getName() !== wanted) folder.setName(wanted);
      }
    }

    SpreadsheetApp.flush();
    return toRecord_(row, tz);
  } finally {
    lock.releaseLock();
  }
}

/** Supprime la ligne de l'intervention. Le dossier photos est conservé dans Drive. */
function deleteIntervention(id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_();
    var rowIndex = findRow_(sh, id);
    if (rowIndex < 0) throw new Error('Intervention introuvable : ' + id);
    sh.deleteRow(rowIndex);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** Liste les photos d'une intervention (sans leur contenu). */
function listPhotos(id) {
  var folder = getInterventionFolder_(id, false);
  if (!folder) return { folderUrl: '', photos: [] };
  var photos = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (String(f.getMimeType()).indexOf('image/') !== 0) continue;
    photos.push({
      id: f.getId(),
      name: f.getName(),
      url: f.getUrl(),
      created: f.getDateCreated().getTime()
    });
  }
  photos.sort(function (a, b) { return a.created - b.created; });
  return { folderUrl: folder.getUrl(), photos: photos };
}

/**
 * Enregistre une photo dans le dossier de l'intervention.
 * @param {string} id identifiant de l'intervention
 * @param {string} fileName nom du fichier
 * @param {string} dataUrl image encodée « data:image/jpeg;base64,... »
 */
function uploadPhoto(id, fileName, dataUrl) {
  var match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!match) throw new Error('Image invalide.');
  var mime = match[1];
  if (mime.indexOf('image/') !== 0) throw new Error("Le fichier n'est pas une image.");
  var folder = getInterventionFolder_(id, true);
  var stamp = Utilities.formatDate(new Date(), getTimeZone_(), 'yyyy-MM-dd_HH-mm-ss');
  var name = stamp + '_' + String(fileName || 'photo.jpg').replace(/[\\/:*?"<>|]/g, '_');
  var blob = Utilities.newBlob(Utilities.base64Decode(match[2]), mime, name);
  var f = folder.createFile(blob);
  return { id: f.getId(), name: f.getName(), url: f.getUrl(), created: f.getDateCreated().getTime() };
}

/** Renvoie le contenu d'une photo (data URL) pour l'afficher dans l'application. */
function getPhotoData(fileId) {
  var f = checkPhoto_(fileId);
  var blob = f.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/** Met une photo à la corbeille Drive (récupérable pendant 30 jours). */
function deletePhoto(fileId) {
  checkPhoto_(fileId).setTrashed(true);
  return true;
}

/** Liens utiles affichés dans l'application. */
function getLinks() {
  return {
    sheetUrl: SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getUrl(),
    photosUrl: DriveApp.getFolderById(CONFIG.PHOTOS_FOLDER_ID).getUrl(),
    facturesUrl: DriveApp.getFolderById(CONFIG.FACTURES_FOLDER_ID).getUrl()
  };
}

// ---------------------------------------------------------------------------
// Factures des pièces commandées
// ---------------------------------------------------------------------------

/** Renvoie toutes les factures archivées, la plus récente en premier. */
function listFactures() {
  var sh = getSheet_(CONFIG.FACTURES_SHEET_NAME);
  var last = lastDataRow_(sh);
  if (last < 2) return [];
  var tz = getTimeZone_();
  var out = [];
  sh.getRange(2, 1, last - 1, NB_FAC_COLS).getValues().forEach(function (row) {
    if (String(row[FCOL.id]).trim() !== '') out.push(factureToRecord_(row, tz));
  });
  out.sort(function (a, b) {
    return String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id));
  });
  return out;
}

/**
 * Archive une nouvelle facture ou met à jour ses informations.
 * Le fichier est rangé dans « Factures pièces/<année> » et renommé
 * « date_fournisseur_numéro_ID » pour être retrouvé facilement dans Drive.
 * @param {Object} data informations (id vide = nouvelle facture)
 * @param {Object=} file {name, dataUrl} obligatoire pour une nouvelle facture
 */
function saveFacture(data, file) {
  data = data || {};
  var date = parseDate_(data.date);
  if (!date) throw new Error('La date de la facture est obligatoire.');
  var montant = parseAmount_(data.montant);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_(CONFIG.FACTURES_SHEET_NAME);
    var tz = getTimeZone_();
    var rowIndex = data.id ? findRow_(sh, data.id) : -1;
    if (data.id && rowIndex < 0) throw new Error('Facture introuvable : ' + data.id);
    var existing = rowIndex > 0 ? sh.getRange(rowIndex, 1, 1, NB_FAC_COLS).getValues()[0] : null;
    if (!existing) {
      if (!file || !file.dataUrl) throw new Error('Ajoutez le fichier de la facture (PDF ou photo).');
      rowIndex = lastDataRow_(sh) + 1;
    }

    // Intervention liée (facultative : pièce commandée pour le stock).
    var interventionId = clean_(data.intervention);
    var client = '';
    if (interventionId) {
      var ish = getSheet_();
      var irow = findRow_(ish, interventionId);
      if (irow < 0) throw new Error('Intervention introuvable : ' + interventionId);
      var iv = ish.getRange(irow, 1, 1, NB_COLS).getValues()[0];
      client = [iv[COL.nom], iv[COL.prenom]].join(' ').trim();
    }

    var row = new Array(NB_FAC_COLS);
    row[FCOL.id] = existing ? existing[FCOL.id] : nextId_(sh, CONFIG.FACTURE_PREFIX);
    row[FCOL.date] = date;
    row[FCOL.fournisseur] = clean_(data.fournisseur);
    row[FCOL.numero] = clean_(data.numero);
    row[FCOL.piece] = clean_(data.piece);
    row[FCOL.montant] = montant;
    row[FCOL.intervention] = interventionId;
    row[FCOL.client] = client;
    row[FCOL.fichier] = existing ? existing[FCOL.fichier] : '';
    row[FCOL.ajouteeLe] = existing ? existing[FCOL.ajouteeLe] : new Date();

    var yearFolder = getYearFolder_(date, tz);
    var baseName = factureFileName_(row, tz);
    if (existing) {
      // Renomme / déplace le fichier si la date, le fournisseur ou le numéro ont changé.
      var f = factureFileFromUrl_(row[FCOL.fichier]);
      if (f) {
        var ext = extension_(f.getName(), f.getMimeType());
        if (f.getName() !== baseName + ext) f.setName(baseName + ext);
        var inYear = false, parents = f.getParents();
        while (parents.hasNext()) { if (parents.next().getId() === yearFolder.getId()) inYear = true; }
        if (!inYear) f.moveTo(yearFolder);
      }
    } else {
      var blob = dataUrlToBlob_(file.dataUrl, baseName);
      var mime = blob.getContentType();
      if (mime !== 'application/pdf' && mime.indexOf('image/') !== 0) {
        throw new Error('Format non accepté : PDF ou image uniquement.');
      }
      blob.setName(baseName + extension_(file.name, mime));
      row[FCOL.fichier] = yearFolder.createFile(blob).getUrl();
    }

    sh.getRange(rowIndex, FCOL.numero + 1).setNumberFormat('@');
    sh.getRange(rowIndex, 1, 1, NB_FAC_COLS).setValues([row]);
    SpreadsheetApp.flush();
    return factureToRecord_(row, tz);
  } finally {
    lock.releaseLock();
  }
}

/** Supprime une facture : la ligne est retirée et le fichier part à la corbeille Drive (30 jours). */
function deleteFacture(id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_(CONFIG.FACTURES_SHEET_NAME);
    var rowIndex = findRow_(sh, id);
    if (rowIndex < 0) throw new Error('Facture introuvable : ' + id);
    var url = sh.getRange(rowIndex, FCOL.fichier + 1).getValue();
    var f = factureFileFromUrl_(url);
    if (f) f.setTrashed(true);
    sh.deleteRow(rowIndex);
    return true;
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Fonctions internes
// ---------------------------------------------------------------------------

function getSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getSheet_(name) {
  name = name || CONFIG.SHEET_NAME;
  var sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Onglet « ' + name + ' » introuvable dans la feuille.');
  return sh;
}

function getTimeZone_() {
  return getSpreadsheet_().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
}

/** Dernière ligne dont la colonne A (ID) est remplie. */
function lastDataRow_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]).trim() !== '') return i + 2;
  }
  return 1;
}

function findRow_(sh, id) {
  var last = lastDataRow_(sh);
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function nextId_(sh, prefix) {
  var last = lastDataRow_(sh);
  var max = 0;
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      var m = /(\d+)\s*$/.exec(String(r[0]));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
  }
  return (prefix || CONFIG.ID_PREFIX) + ('0000' + (max + 1)).slice(-4);
}

function toRecord_(row, tz) {
  var rec = rowToObject_(COLUMNS, row, tz);
  rec.id = String(rec.id);
  rec.telephone = String(rec.telephone);
  rec.termine = rec.termine === true;
  return rec;
}

function factureToRecord_(row, tz) {
  var rec = rowToObject_(FAC_COLUMNS, row, tz);
  rec.id = String(rec.id);
  rec.numero = String(rec.numero);
  rec.intervention = String(rec.intervention);
  return rec;
}

/** Ligne de feuille → objet ; les dates deviennent du texte (google.script.run ne transmet pas les Date). */
function rowToObject_(columns, row, tz) {
  var rec = {};
  columns.forEach(function (name, i) {
    var v = row[i];
    if (v instanceof Date) {
      var fmt = /(Le)$/.test(name) ? 'dd/MM/yyyy HH:mm' : 'yyyy-MM-dd';
      v = Utilities.formatDate(v, tz, fmt);
    } else if (v === null || v === undefined) {
      v = '';
    }
    rec[name] = v;
  });
  return rec;
}

function clean_(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

/** « 2026-11-11 » → Date à midi dans le fuseau de la feuille (évite les décalages d'un jour). */
function parseDate_(v) {
  var s = clean_(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return Utilities.parseDate(s + ' 12:00', getTimeZone_(), 'yyyy-MM-dd HH:mm');
}

/** « 45,90 » ou « 45.90 € » → 45.9 ; vide → cellule vide. */
function parseAmount_(v) {
  var s = clean_(v).replace(/\s|€/g, '').replace(',', '.');
  if (s === '') return '';
  var n = Number(s);
  if (isNaN(n)) throw new Error('Montant invalide : ' + v);
  return Math.round(n * 100) / 100;
}

function folderName_(row) {
  return [row[COL.id], '-', row[COL.nom], row[COL.prenom]].join(' ').replace(/\s+/g, ' ').trim();
}

function folderFromUrl_(url) {
  var m = /folders\/([\w-]+)/.exec(String(url || ''));
  if (!m) return null;
  try {
    var f = DriveApp.getFolderById(m[1]);
    return f.isTrashed() ? null : f;
  } catch (e) {
    return null;
  }
}

/** Dossier photos de l'intervention ; le crée au premier ajout de photo si besoin. */
function getInterventionFolder_(id, create) {
  var sh = getSheet_();
  var rowIndex = findRow_(sh, id);
  if (rowIndex < 0) throw new Error('Intervention introuvable : ' + id);
  var row = sh.getRange(rowIndex, 1, 1, NB_COLS).getValues()[0];
  var folder = folderFromUrl_(row[COL.dossierPhotos]);
  if (folder || !create) return folder;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // Relire au cas où un autre envoi vient de créer le dossier.
    rowIndex = findRow_(sh, id);
    row = sh.getRange(rowIndex, 1, 1, NB_COLS).getValues()[0];
    folder = folderFromUrl_(row[COL.dossierPhotos]);
    if (folder) return folder;
    folder = DriveApp.getFolderById(CONFIG.PHOTOS_FOLDER_ID).createFolder(folderName_(row));
    sh.getRange(rowIndex, COL.dossierPhotos + 1).setValue(folder.getUrl());
    SpreadsheetApp.flush();
    return folder;
  } finally {
    lock.releaseLock();
  }
}

/** Vérifie que le fichier est bien une photo rangée dans « Photos interventions ». */
function checkPhoto_(fileId) {
  var f = DriveApp.getFileById(fileId);
  var parents = f.getParents();
  while (parents.hasNext()) {
    var p = parents.next();
    var gp = p.getParents();
    while (gp.hasNext()) {
      if (gp.next().getId() === CONFIG.PHOTOS_FOLDER_ID) return f;
    }
  }
  throw new Error("Cette photo n'appartient pas au dossier des interventions.");
}

/** Sous-dossier de l'année dans « Factures pièces » (créé si besoin). */
function getYearFolder_(date, tz) {
  var year = Utilities.formatDate(date, tz, 'yyyy');
  var root = DriveApp.getFolderById(CONFIG.FACTURES_FOLDER_ID);
  var it = root.getFoldersByName(year);
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed()) return f;
  }
  return root.createFolder(year);
}

/** Ex. « 2026-11-12_Pieces-Express_FA-1234_FAC-0007 » */
function factureFileName_(row, tz) {
  var parts = [
    Utilities.formatDate(row[FCOL.date], tz, 'yyyy-MM-dd'),
    row[FCOL.fournisseur],
    row[FCOL.numero],
    row[FCOL.id]
  ].filter(function (x) { return String(x).trim() !== ''; });
  return parts.join('_').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
}

function extension_(name, mime) {
  var m = /(\.[A-Za-z0-9]{2,5})$/.exec(String(name || ''));
  if (m) return m[1].toLowerCase();
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/heic') return '.heic';
  return '.jpg';
}

function dataUrlToBlob_(dataUrl, name) {
  var m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) throw new Error('Fichier invalide.');
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > CONFIG.MAX_FILE_MB * 1024 * 1024) {
    throw new Error('Fichier trop volumineux (' + CONFIG.MAX_FILE_MB + ' Mo maximum).');
  }
  return Utilities.newBlob(bytes, m[1], name);
}

/** Fichier de facture à partir de son lien, uniquement s'il est rangé dans « Factures pièces ». */
function factureFileFromUrl_(url) {
  var m = /\/d\/([\w-]+)/.exec(String(url || ''));
  if (!m) return null;
  try {
    var f = DriveApp.getFileById(m[1]);
    if (f.isTrashed()) return null;
    var parents = f.getParents();
    while (parents.hasNext()) {
      var p = parents.next();
      if (p.getId() === CONFIG.FACTURES_FOLDER_ID) return f;
      var gp = p.getParents();
      while (gp.hasNext()) {
        if (gp.next().getId() === CONFIG.FACTURES_FOLDER_ID) return f;
      }
    }
  } catch (e) {
    // fichier supprimé ou inaccessible
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fonctions exposées à l'application (appelées par le chargeur apps-script/Code.gs)
// ---------------------------------------------------------------------------
var API = {
  VERSION: '2026-11-11.2',
  ACTIONS: {
    listInterventions: listInterventions,
    saveIntervention: saveIntervention,
    deleteIntervention: deleteIntervention,
    listPhotos: listPhotos,
    uploadPhoto: uploadPhoto,
    getPhotoData: getPhotoData,
    deletePhoto: deletePhoto,
    listFactures: listFactures,
    saveFacture: saveFacture,
    deleteFacture: deleteFacture,
    getLinks: getLinks
  }
};
