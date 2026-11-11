/**
 * Fichier clients – Dépannages électroménager
 *
 * Application web Google Apps Script :
 *  - les fiches d'intervention sont stockées dans la feuille Google Sheets « Interventions » ;
 *  - les photos sont rangées dans Google Drive, un sous-dossier par intervention,
 *    à l'intérieur du dossier « Photos interventions ».
 *
 * Voir README.md pour l'installation.
 */

// ---------------------------------------------------------------------------
// Configuration : identifiants de la feuille et du dossier photos dans Drive.
// (créés dans le dossier Drive « Dépannages électroménager »)
// ---------------------------------------------------------------------------
var CONFIG = {
  SPREADSHEET_ID: '1n6WC_Ik14bE6ZwapDIAAXgPPw8xaqzCUeX0QENBxons',
  PHOTOS_FOLDER_ID: '1jgvigMTAK_tkB3WVTiqkmEa93CGMLKQh',
  SHEET_NAME: 'Interventions',
  ID_PREFIX: 'INT-'
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

// ---------------------------------------------------------------------------
// Point d'entrée de l'application web
// ---------------------------------------------------------------------------
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Dépannages – Fichier clients')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

/** Ajoute un menu « Dépannages » dans la feuille (si le script est lié à la feuille). */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Dépannages')
      .addItem("Ouvrir l'application", 'ouvrirApplication')
      .addToUi();
  } catch (e) {
    // Script autonome : pas d'interface de feuille, rien à faire.
  }
}

function ouvrirApplication() {
  var url = ScriptApp.getService().getUrl();
  var html = url
    ? '<p style="font-family:Arial">Lien de l\'application :</p>' +
      '<p><a href="' + url + '" target="_blank" style="font-family:Arial;font-size:16px">Ouvrir le fichier clients</a></p>'
    : '<p style="font-family:Arial">L\'application n\'est pas encore déployée. ' +
      'Dans l\'éditeur Apps Script : Déployer › Nouveau déploiement › Application Web.</p>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(360).setHeight(140),
    'Fichier clients'
  );
}

// ---------------------------------------------------------------------------
// Fonctions appelées par l'application (google.script.run)
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
    photosUrl: DriveApp.getFolderById(CONFIG.PHOTOS_FOLDER_ID).getUrl()
  };
}

// ---------------------------------------------------------------------------
// Fonctions internes
// ---------------------------------------------------------------------------

function getSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getSheet_() {
  var sh = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) throw new Error('Onglet « ' + CONFIG.SHEET_NAME + ' » introuvable dans la feuille.');
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

function nextId_(sh) {
  var last = lastDataRow_(sh);
  var max = 0;
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      var m = /(\d+)\s*$/.exec(String(r[0]));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
  }
  return CONFIG.ID_PREFIX + ('0000' + (max + 1)).slice(-4);
}

function toRecord_(row, tz) {
  var rec = {};
  COLUMNS.forEach(function (name, i) {
    var v = row[i];
    if (v instanceof Date) {
      var fmt = (name === 'creeLe' || name === 'modifieLe') ? 'dd/MM/yyyy HH:mm' : 'yyyy-MM-dd';
      v = Utilities.formatDate(v, tz, fmt);
    } else if (v === null || v === undefined) {
      v = '';
    }
    rec[name] = v;
  });
  rec.id = String(rec.id);
  rec.telephone = String(rec.telephone);
  rec.termine = rec.termine === true;
  return rec;
}

function clean_(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

/** « 2026-11-11 » → Date à midi (évite les décalages de fuseau horaire). */
function parseDate_(v) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean_(v));
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
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
