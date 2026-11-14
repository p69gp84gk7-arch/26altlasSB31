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
 *    « Factures pièces » (un sous-dossier par année) et listées dans l'onglet « Factures » ;
 *  - la documentation technique (captures, photos, PDF) est rangée par appareil dans le
 *    dossier Drive « Documentation technique » et listée dans l'onglet « Documentation » ;
 *  - les coordonnées GPS des adresses clients (carte) sont gardées dans l'onglet « Adresses » ;
 *  - les tarifs du simulateur sont dans l'onglet « Paramètres ».
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
  DOCS_FOLDER_ID: '1c4z_x9nx9SSiQqPRckfbk4_eWaDmsB30',
  DOCS_SHEET_NAME: 'Documentation',
  DOC_PREFIX: 'DOC-',
  SHEET_NAME: 'Interventions',
  FACTURES_SHEET_NAME: 'Factures',
  ID_PREFIX: 'INT-',
  FACTURE_PREFIX: 'FAC-',
  MAX_FILE_MB: 20
};

// Ordre des colonnes A → T de la feuille « Interventions ».
// La colonne U (Marge) est calculée par une formule dans la feuille : le script n'y écrit jamais.
// Les temps sont enregistrés en minutes.
var COLUMNS = [
  'id',               // A  ID
  'nom',              // B  Nom
  'prenom',           // C  Prénom
  'telephone',        // D  Téléphone
  'adresse',          // E  Adresse
  'appareil',         // F  Type d'appareil
  'marque',           // G  Marque
  'reference',        // H  Référence de l'appareil (texte)
  'panne',            // I  Panne / travaux
  'dateDiagnostic',   // J  Date de diagnostic
  'tempsDiagnostic',  // K  Temps diagnostic (min)
  'dateIntervention', // L  Date d'intervention
  'tempsReparation',  // M  Temps réparation (min)
  'piece',            // N  Pièce utilisée
  'montantPiece',     // O  Montant pièce (€)
  'montantRegle',     // P  Montant réglé (€)
  'termine',          // Q  Terminé
  'dossierPhotos',    // R  Dossier photos (lien Drive)
  'creeLe',           // S  Créé le
  'modifieLe'         // T  Modifié le
];
var HEADERS = ['ID', 'Nom', 'Prénom', 'Téléphone', 'Adresse', "Type d'appareil", 'Marque', 'Référence', 'Panne / travaux',
  'Date de diagnostic', 'Temps diagnostic (min)', "Date d'intervention", 'Temps réparation (min)', 'Pièce utilisée', 'Montant pièce (€)', 'Montant réglé (€)',
  'Terminé', 'Dossier photos', 'Créé le', 'Modifié le'];
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

// Ordre des colonnes A → I de l'onglet « Documentation » (une ligne par document).
var DOC_COLUMNS = [
  'id',          // A  ID (DOC-0001)
  'reference',   // B  Référence de l'appareil (texte) : identifie l'appareil
  'marque',      // C  Marque
  'appareil',    // D  Type d'appareil
  'categorie',   // E  Catégorie (Vue éclatée, Schéma électrique…)
  'titre',       // F  Titre / description
  'fichier',     // G  Fichier (lien Drive)
  'format',      // H  « image » ou « pdf »
  'ajouteLe'     // I  Ajouté le
];
var DOC_HEADERS = ['ID', 'Référence', 'Marque', "Type d'appareil", 'Catégorie', 'Titre', 'Fichier', 'Format', 'Ajouté le'];
var DCOL = {};
DOC_COLUMNS.forEach(function (name, i) { DCOL[name] = i; });
var NB_DOC_COLS = DOC_COLUMNS.length;
var DOC_CATEGORIES = ['Vue éclatée', 'Schéma électrique', 'Manuel de service', 'Codes erreur', 'Notice', 'Autre'];

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

    // Un champ absent de la demande (ancienne version de l'application encore ouverte)
    // garde sa valeur actuelle au lieu d'être effacé.
    var field = function (key, parse) {
      if (data[key] === undefined && existing) return existing[COL[key]];
      return parse(data[key]);
    };
    if (data.dateDiagnostic === undefined && data.dateAppel !== undefined) data.dateDiagnostic = data.dateAppel;

    var row = new Array(NB_COLS);
    row[COL.id] = existing ? existing[COL.id] : nextId_(sh);
    row[COL.nom] = clean_(data.nom);
    row[COL.prenom] = field('prenom', clean_);
    row[COL.telephone] = field('telephone', clean_);
    row[COL.adresse] = field('adresse', clean_);
    row[COL.appareil] = field('appareil', clean_);
    row[COL.marque] = field('marque', clean_);
    row[COL.reference] = field('reference', clean_);
    row[COL.panne] = field('panne', clean_);
    row[COL.dateDiagnostic] = field('dateDiagnostic', parseDate_);
    row[COL.tempsDiagnostic] = field('tempsDiagnostic', parseMinutes_);
    row[COL.dateIntervention] = field('dateIntervention', parseDate_);
    row[COL.tempsReparation] = field('tempsReparation', parseMinutes_);
    row[COL.piece] = field('piece', clean_);
    row[COL.montantPiece] = field('montantPiece', parseAmount_);
    row[COL.montantRegle] = field('montantRegle', parseAmount_);
    row[COL.termine] = field('termine', function (v) { return v === true || v === 'true'; });
    row[COL.dossierPhotos] = existing ? existing[COL.dossierPhotos] : '';
    row[COL.creeLe] = existing ? existing[COL.creeLe] : now;
    row[COL.modifieLe] = now;

    // Le téléphone est enregistré comme texte (garde le 0 initial).
    var range = sh.getRange(rowIndex, 1, 1, NB_COLS);
    sh.getRange(rowIndex, COL.telephone + 1).setNumberFormat('@');
    sh.getRange(rowIndex, COL.reference + 1).setNumberFormat('@'); // ex. « 911.239.123 » reste du texte
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

/**
 * Choix des listes déroulantes : onglet « Listes » (modifiable dans la feuille)
 * + valeurs déjà enregistrées dans les interventions et les factures.
 */
function getListes() {
  var sh = getListesSheet_();
  var out = { types: [], marques: [], fournisseurs: [] };
  var last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r) {
      out.types.push(r[0]);
      out.marques.push(r[1]);
      out.fournisseurs.push(r[2]);
    });
  }
  // Du plus ancien au plus récent : en cas d'écritures différentes, la première saisie est gardée.
  listInterventions().reverse().forEach(function (it) {
    out.types.push(it.appareil);
    out.marques.push(it.marque);
  });
  listFactures().reverse().forEach(function (f) { out.fournisseurs.push(f.fournisseur); });
  listDocs().forEach(function (d) {
    out.types.push(d.appareil);
    out.marques.push(d.marque);
  });
  return { types: uniqueSorted_(out.types), marques: uniqueSorted_(out.marques), fournisseurs: uniqueSorted_(out.fournisseurs) };
}

/** Liens utiles affichés dans l'application. */
function getLinks() {
  return {
    sheetUrl: SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getUrl(),
    photosUrl: DriveApp.getFolderById(CONFIG.PHOTOS_FOLDER_ID).getUrl(),
    facturesUrl: DriveApp.getFolderById(CONFIG.FACTURES_FOLDER_ID).getUrl(),
    docsUrl: DriveApp.getFolderById(CONFIG.DOCS_FOLDER_ID).getUrl()
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
// Documentation technique (par appareil = par référence)
// ---------------------------------------------------------------------------

/** Tous les documents, triés par marque, référence puis catégorie. */
function listDocs() {
  var sh = getDocsSheet_();
  var last = lastDataRow_(sh);
  if (last < 2) return [];
  var tz = getTimeZone_();
  var out = [];
  sh.getRange(2, 1, last - 1, NB_DOC_COLS).getValues().forEach(function (row) {
    if (String(row[DCOL.id]).trim() === '') return;
    var rec = rowToObject_(DOC_COLUMNS, row, tz);
    rec.id = String(rec.id);
    rec.reference = String(rec.reference);
    out.push(rec);
  });
  out.sort(function (a, b) {
    return String(a.marque).localeCompare(String(b.marque), 'fr') ||
      String(a.reference).localeCompare(String(b.reference), 'fr') ||
      DOC_CATEGORIES.indexOf(a.categorie) - DOC_CATEGORIES.indexOf(b.categorie) ||
      String(a.id).localeCompare(String(b.id));
  });
  return out;
}

/**
 * Ajoute un document (capture, photo ou PDF) à un appareil, ou modifie ses informations.
 * Le fichier est rangé dans « Documentation technique/<Marque> <Référence> » et nommé
 * « Catégorie - Titre - DOC-xxxx ». Si la marque ou la référence changent, il est déplacé.
 * @param {Object} data {id?, reference, marque, appareil, categorie, titre}
 * @param {Object=} file {name, dataUrl} obligatoire pour un nouveau document
 */
function saveDoc(data, file) {
  data = data || {};
  var reference = clean_(data.reference);
  if (!reference) throw new Error("La référence de l'appareil est obligatoire.");
  var categorie = DOC_CATEGORIES.indexOf(clean_(data.categorie)) >= 0 ? clean_(data.categorie) : 'Autre';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getDocsSheet_();
    var tz = getTimeZone_();
    var rowIndex = data.id ? findRow_(sh, data.id) : -1;
    if (data.id && rowIndex < 0) throw new Error('Document introuvable : ' + data.id);
    var existing = rowIndex > 0 ? sh.getRange(rowIndex, 1, 1, NB_DOC_COLS).getValues()[0] : null;
    if (!existing) {
      if (!file || !file.dataUrl) throw new Error('Ajoutez le fichier (capture, photo ou PDF).');
      rowIndex = lastDataRow_(sh) + 1;
    }
    var row = new Array(NB_DOC_COLS);
    row[DCOL.id] = existing ? existing[DCOL.id] : nextId_(sh, CONFIG.DOC_PREFIX);
    row[DCOL.reference] = reference;
    row[DCOL.marque] = clean_(data.marque);
    row[DCOL.appareil] = clean_(data.appareil);
    row[DCOL.categorie] = categorie;
    row[DCOL.titre] = clean_(data.titre);
    row[DCOL.fichier] = existing ? existing[DCOL.fichier] : '';
    row[DCOL.format] = existing ? existing[DCOL.format] : '';
    row[DCOL.ajouteLe] = existing ? existing[DCOL.ajouteLe] : new Date();

    var folder = machineFolder_(row[DCOL.marque], reference);
    var baseName = [categorie, row[DCOL.titre], row[DCOL.id]].filter(function (x) { return String(x).trim() !== ''; })
      .join(' - ').replace(/[\\/:*?"<>|]/g, '-');
    if (existing) {
      var f = docFileFromUrl_(row[DCOL.fichier]);
      if (f) {
        var name = baseName + extension_(f.getName(), f.getMimeType());
        if (f.getName() !== name) f.setName(name);
        var inFolder = false, parents = f.getParents();
        while (parents.hasNext()) { if (parents.next().getId() === folder.getId()) inFolder = true; }
        if (!inFolder) f.moveTo(folder);
      }
    } else {
      var blob = dataUrlToBlob_(file.dataUrl, baseName);
      var mime = blob.getContentType();
      if (mime !== 'application/pdf' && mime.indexOf('image/') !== 0) {
        throw new Error('Format non accepté : PDF ou image uniquement.');
      }
      blob.setName(baseName + extension_(file.name, mime));
      row[DCOL.fichier] = folder.createFile(blob).getUrl();
      row[DCOL.format] = mime === 'application/pdf' ? 'pdf' : 'image';
    }
    sh.getRange(rowIndex, DCOL.reference + 1).setNumberFormat('@');
    sh.getRange(rowIndex, 1, 1, NB_DOC_COLS).setValues([row]);
    SpreadsheetApp.flush();
    var rec = rowToObject_(DOC_COLUMNS, row, tz);
    rec.id = String(rec.id);
    rec.reference = String(rec.reference);
    return rec;
  } finally {
    lock.releaseLock();
  }
}

/** Supprime un document : la ligne est retirée, le fichier part à la corbeille Drive (30 jours). */
function deleteDoc(id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getDocsSheet_();
    var rowIndex = findRow_(sh, id);
    if (rowIndex < 0) throw new Error('Document introuvable : ' + id);
    var f = docFileFromUrl_(sh.getRange(rowIndex, DCOL.fichier + 1).getValue());
    if (f) f.setTrashed(true);
    sh.deleteRow(rowIndex);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** Contenu d'une image de documentation (data URL) pour l'afficher dans l'application. */
function getDocData(fileId) {
  var f = DriveApp.getFileById(fileId);
  if (!isUnder_(f, CONFIG.DOCS_FOLDER_ID)) throw new Error("Ce fichier n'appartient pas à la documentation.");
  var blob = f.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

// ---------------------------------------------------------------------------
// Carte : géocodage des adresses (service de l'IGN, Géoplateforme, sans clé)
// ---------------------------------------------------------------------------
var GEOCODE_URL = 'https://data.geopf.fr/geocodage/search';
var GEO_SHEET_NAME = 'Adresses';
var GEO_HEADERS = ['Adresse', 'Latitude', 'Longitude', 'Adresse trouvée', 'Précision', 'Recherché le'];
var GEO_MAX_PAR_APPEL = 40; // limite le temps d'une requête ; la suite est faite à l'appel suivant

/**
 * Points de la carte : coordonnées de chaque adresse client (et de l'adresse de départ).
 * Les adresses déjà trouvées sont lues dans l'onglet « Adresses » ; les nouvelles sont géocodées.
 * @return {{points: Object[], depart: Object, restant: number}}
 */
function getCarte() {
  var params = getParametres();
  var vues = {};
  var adresses = listInterventions().reverse().map(function (it) { return clean_(it.adresse); }).filter(function (a) {
    var k = geoKey_(a);
    if (!a || vues[k]) return false;
    vues[k] = true;
    return true;
  });
  var depart = clean_(params.adresseDepart);
  var toutes = depart ? adresses.concat([depart]) : adresses;
  var geo = geocodeAddresses_(toutes);
  return {
    points: adresses.map(function (a) { return geoPoint_(a, geo.cache); }),
    depart: depart ? geoPoint_(depart, geo.cache) : null,
    restant: geo.restant
  };
}

function geoKey_(a) { return clean_(a).toLowerCase().replace(/\s+/g, ' '); }

function geoPoint_(adresse, cache) {
  var c = cache[geoKey_(adresse)];
  return {
    adresse: adresse,
    lat: c && c.lat !== '' ? Number(c.lat) : null,
    lng: c && c.lng !== '' ? Number(c.lng) : null,
    label: c ? c.label : '',
    score: c && c.score !== '' ? Number(c.score) : null,
    trouve: !!(c && c.lat !== ''),
    recherche: !!c
  };
}

function getGeoSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(GEO_SHEET_NAME);
  if (sh) return sh;
  sh = ss.insertSheet(GEO_SHEET_NAME);
  sh.getRange(1, 1, 1, GEO_HEADERS.length).setValues([GEO_HEADERS]);
  sh.getRange(1, 1, 1, GEO_HEADERS.length).setFontWeight('bold').setBackground('#1f3864').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidths(1, GEO_HEADERS.length, 160);
  return sh;
}

/** Géocode les adresses absentes de l'onglet « Adresses » (une seule fois par adresse). */
function geocodeAddresses_(adresses) {
  var sh = getGeoSheet_();
  var cache = {};
  var last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 5).getValues().forEach(function (r) {
      if (clean_(r[0])) cache[geoKey_(r[0])] = { lat: r[1], lng: r[2], label: r[3], score: r[4] };
    });
  }
  var manquantes = adresses.filter(function (a) { return clean_(a) && !cache[geoKey_(a)]; });
  var lot = manquantes.slice(0, GEO_MAX_PAR_APPEL);
  if (lot.length) {
    var reponses = UrlFetchApp.fetchAll(lot.map(function (a) {
      return { url: GEOCODE_URL + '?limit=1&q=' + encodeURIComponent(clean_(a).slice(0, 200)), muteHttpExceptions: true };
    }));
    var rows = [];
    var now = new Date();
    lot.forEach(function (a, i) {
      var res = reponses[i];
      if (!res || res.getResponseCode() !== 200) return; // service indisponible : on réessaiera plus tard
      var f = null;
      try { f = (JSON.parse(res.getContentText()).features || [])[0] || null; } catch (e) { return; }
      var rec = f && f.geometry && f.geometry.coordinates
        ? { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
            label: (f.properties && f.properties.label) || '', score: (f.properties && f.properties.score) || '' }
        : { lat: '', lng: '', label: 'Adresse introuvable', score: '' };
      cache[geoKey_(a)] = rec;
      rows.push([clean_(a), rec.lat, rec.lng, rec.label, rec.score, now]);
    });
    if (rows.length) {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        sh.getRange(sh.getLastRow() + 1, 1, rows.length, GEO_HEADERS.length).setValues(rows);
      } finally {
        lock.releaseLock();
      }
    }
  }
  return { cache: cache, restant: Math.max(manquantes.length - lot.length, 0) };
}

// ---------------------------------------------------------------------------
// Paramètres du simulateur de tarification (onglet « Paramètres », modifiable)
// ---------------------------------------------------------------------------
var PARAMS_SHEET_NAME = 'Paramètres';
// Valeurs d'exemple au premier lancement : à adapter à vos tarifs.
var PARAMS_DEFAUT = [
  ['adresseDepart', '', "Adresse de départ des tournées (calcul des distances)"],
  ['tauxHoraire', 45, "Taux horaire main d'œuvre (€ HT / heure)"],
  ['forfaitDeplacement', 30, 'Forfait déplacement (€ HT)'],
  ['kmInclus', 20, 'Km inclus dans le forfait (aller-retour)'],
  ['prixKm', 0.6, 'Prix par km au-delà (€ HT / km)'],
  ['forfaitDiagnostic', 0, 'Forfait diagnostic (€ HT ; 0 = temps passé × taux horaire)'],
  ['arrondiMinutes', 15, "Main d'œuvre arrondie au multiple supérieur (minutes)"],
  ['coefficientPieces', 1.3, 'Coefficient sur le prix d’achat des pièces (1,3 = +30 %)'],
  ['minimumFacture', 0, 'Montant minimum facturé (€ HT ; 0 = aucun)'],
  ['tauxTVA', 0, 'TVA en % (0 = TVA non applicable, art. 293 B du CGI)'],
  ['vitesseMoyenne', 50, 'Vitesse moyenne sur la route (km/h, temps de trajet)'],
  ['facteurRoute', 1.3, 'Distance route ≈ distance à vol d’oiseau × ce facteur']
];

function getParamsSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(PARAMS_SHEET_NAME);
  if (sh) return sh;
  sh = ss.insertSheet(PARAMS_SHEET_NAME);
  var rows = [['Paramètre', 'Valeur', 'Description']].concat(PARAMS_DEFAUT);
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#1f3864').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidths(1, 3, 220);
  return sh;
}

/** Tarifs du simulateur : valeurs de l'onglet « Paramètres », complétées par les valeurs d'exemple. */
function getParametres() {
  var out = {};
  PARAMS_DEFAUT.forEach(function (p) { out[p[0]] = p[1]; });
  var sh = getParamsSheet_();
  var last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
      var k = clean_(r[0]);
      if (!out.hasOwnProperty(k)) return;
      out[k] = k === 'adresseDepart' ? clean_(r[1]) : (r[1] === '' ? out[k] : Number(String(r[1]).replace(',', '.')));
    });
  }
  return out;
}

/** Enregistre les tarifs (seules les clés connues sont acceptées). */
function saveParametres(data) {
  data = data || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getParamsSheet_();
    var last = sh.getLastRow();
    var keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return clean_(r[0]); }) : [];
    PARAMS_DEFAUT.forEach(function (p) {
      var k = p[0];
      if (data[k] === undefined) return;
      var v;
      if (k === 'adresseDepart') v = clean_(data[k]);
      else {
        v = Number(String(data[k]).replace(',', '.'));
        if (!isFinite(v) || v < 0) throw new Error('Valeur invalide pour « ' + p[2] + ' ».');
      }
      var i = keys.indexOf(k);
      if (i >= 0) sh.getRange(i + 2, 2).setValue(v);
      else { sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[k, v, p[2]]]); keys.push(k); }
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return getParametres();
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
  if (name === CONFIG.SHEET_NAME) ensureSchema_(sh);
  return sh;
}

var _schemaChecked = false;

// Colonnes ajoutées par des versions successives : insérées à leur place si elles manquent.
var COLONNES_AJOUTEES = {
  'Marque': { width: 130 },
  'Référence': { width: 160, format: '@' },
  'Temps diagnostic (min)': { width: 110, format: '0" min"' },
  'Temps réparation (min)': { width: 110, format: '0" min"' }
};

/**
 * Met la feuille « Interventions » à jour automatiquement quand le code ajoute des colonnes :
 * chaque colonne manquante est insérée à sa place (les données, la formule de marge, la case
 * « Terminé » et le récapitulatif se décalent tout seuls), puis les titres sont mis à jour.
 * Le récapitulatif reçoit les lignes de temps passé si elles manquent.
 */
function ensureSchema_(sh) {
  if (_schemaChecked) return;
  var width = Math.max(sh.getLastColumn(), NB_COLS);
  var headers = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  var changed = false;
  for (var i = 0; i < HEADERS.length; i++) {
    var want = HEADERS[i];
    if (headers[i] === want) continue;
    var add = COLONNES_AJOUTEES[want];
    if (add && headers.indexOf(want) === -1) {
      sh.insertColumnBefore(i + 1);
      headers.splice(i, 0, want);
      sh.setColumnWidth(i + 1, add.width);
      if (add.format) sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat(add.format);
    } else {
      headers[i] = want; // colonne renommée (ex. « Appareil » → « Type d'appareil »)
    }
    changed = true;
  }
  if (changed) sh.getRange(1, 1, 1, NB_COLS).setValues([HEADERS]);
  ensureRecap_();
  _schemaChecked = true;
}

/** Lignes « temps passé » du récapitulatif (ajoutées une seule fois, sous les autres). */
function ensureRecap_() {
  var sh = getSpreadsheet_().getSheetByName('Récapitulatif');
  if (!sh) return;
  var last = Math.max(sh.getLastRow(), 1);
  var labels = sh.getRange(1, 1, last, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  if (labels.indexOf('Temps de diagnostic (h)') !== -1) return;
  var colDiag = columnLetter_(COL.tempsDiagnostic + 1);
  var colRep = columnLetter_(COL.tempsReparation + 1);
  var margeRow = labels.indexOf('Marge (€)') + 1;
  var r = last + 1;
  sh.getRange(r, 1, 3, 1).setValues([['Temps de diagnostic (h)'], ['Temps de réparation (h)'], ['Marge par heure (€/h)']]);
  // Formules sans séparateur d'arguments : valables quelle que soit la langue de la feuille.
  sh.getRange(r, 2).setFormula('=SUM(Interventions!' + colDiag + '2:' + colDiag + ')/60');
  sh.getRange(r + 1, 2).setFormula('=SUM(Interventions!' + colRep + '2:' + colRep + ')/60');
  if (margeRow > 0) sh.getRange(r + 2, 2).setFormula('=IFERROR(B' + margeRow + '/(B' + r + '+B' + (r + 1) + '))');
  sh.getRange(r, 2, 2, 1).setNumberFormat('0.0" h"');
  sh.getRange(r + 2, 2).setNumberFormat('#,##0.00" €/h"');
}

function columnLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

var LISTES_SHEET_NAME = 'Listes';
var LISTES_DEFAUT = {
  types: ['Lave-linge', 'Sèche-linge', 'Lave-linge séchant', 'Lave-vaisselle', 'Réfrigérateur',
    'Réfrigérateur-congélateur', 'Congélateur', 'Cave à vin', 'Four', 'Micro-ondes', 'Plaque de cuisson',
    'Cuisinière', 'Hotte', 'Chauffe-eau', 'Climatisation', 'Aspirateur', 'Petit électroménager'],
  marques: ['AEG', 'Arthur Martin', 'Beko', 'Bosch', 'Brandt', 'Candy', 'De Dietrich', 'Electrolux', 'Essentiel B',
    'Faure', 'Gorenje', 'Grundig', 'Haier', 'Hisense', 'Hoover', 'Hotpoint', 'Indesit', 'LG', 'Liebherr', 'Listo',
    'Miele', 'Neff', 'Panasonic', 'Proline', 'Rosières', 'Samsung', 'Sauter', 'Sharp', 'Siemens', 'Smeg',
    'Thomson', 'Valberg', 'Vedette', 'Whirlpool']
};

/** Onglet « Listes » (créé avec des valeurs courantes s'il n'existe pas). */
function getListesSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(LISTES_SHEET_NAME);
  if (sh) return sh;
  sh = ss.insertSheet(LISTES_SHEET_NAME);
  var n = Math.max(LISTES_DEFAUT.types.length, LISTES_DEFAUT.marques.length);
  var rows = [["Types d'appareil", 'Marques', 'Fournisseurs']];
  for (var i = 0; i < n; i++) {
    rows.push([LISTES_DEFAUT.types[i] || '', LISTES_DEFAUT.marques[i] || '', '']);
  }
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#1f3864').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidths(1, 3, 200);
  return sh;
}

/** Valeurs non vides, sans doublon (majuscules ignorées), triées dans l'ordre français. */
function uniqueSorted_(values) {
  var seen = {}, out = [];
  values.forEach(function (v) {
    v = clean_(v);
    var k = v.toLowerCase();
    if (v && !seen[k]) { seen[k] = true; out.push(v); }
  });
  return out.sort(function (a, b) { return a.localeCompare(b, 'fr', { sensitivity: 'base' }); });
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
  rec.reference = String(rec.reference);
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

/** Durée en minutes (nombre entier ≥ 0) ; vide → cellule vide. */
function parseMinutes_(v) {
  var s = clean_(v);
  if (s === '') return '';
  var n = Number(s);
  if (!isFinite(n) || n < 0) throw new Error('Durée invalide : ' + v);
  return Math.round(n);
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

/** Onglet « Documentation » (créé s'il n'existe pas). */
function getDocsSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(CONFIG.DOCS_SHEET_NAME);
  if (sh) return sh;
  sh = ss.insertSheet(CONFIG.DOCS_SHEET_NAME);
  sh.getRange(1, 1, 1, NB_DOC_COLS).setValues([DOC_HEADERS]);
  sh.getRange(1, 1, 1, NB_DOC_COLS).setFontWeight('bold').setBackground('#1f3864').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidths(1, NB_DOC_COLS, 150);
  sh.getRange(2, DCOL.reference + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  return sh;
}

/** Dossier de l'appareil « <Marque> <Référence> » dans « Documentation technique » (créé si besoin). */
function machineFolder_(marque, reference) {
  var name = [marque, reference].map(clean_).filter(Boolean).join(' ').replace(/[\\/:*?"<>|]/g, '-');
  var root = DriveApp.getFolderById(CONFIG.DOCS_FOLDER_ID);
  var it = root.getFoldersByName(name);
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed()) return f;
  }
  return root.createFolder(name);
}

/** Vrai si le fichier est dans le dossier rootId ou dans un de ses sous-dossiers directs. */
function isUnder_(file, rootId) {
  var parents = file.getParents();
  while (parents.hasNext()) {
    var p = parents.next();
    if (p.getId() === rootId) return true;
    var gp = p.getParents();
    while (gp.hasNext()) {
      if (gp.next().getId() === rootId) return true;
    }
  }
  return false;
}

function docFileFromUrl_(url) {
  var m = /\/d\/([\w-]+)/.exec(String(url || ''));
  if (!m) return null;
  try {
    var f = DriveApp.getFileById(m[1]);
    return !f.isTrashed() && isUnder_(f, CONFIG.DOCS_FOLDER_ID) ? f : null;
  } catch (e) {
    return null;
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
  VERSION: '2026-11-14.1',
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
    getLinks: getLinks,
    getListes: getListes,
    listDocs: listDocs,
    saveDoc: saveDoc,
    deleteDoc: deleteDoc,
    getDocData: getDocData,
    getCarte: getCarte,
    getParametres: getParametres,
    saveParametres: saveParametres
  }
};
