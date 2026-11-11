/**
 * Fichier clients – Dépannages électroménager : CHARGEUR (à coller une seule fois).
 *
 * Ce petit script relie l'application (hébergée sur GitHub Pages) à votre feuille
 * Google Sheets et à votre Google Drive. Il ne contient pas la logique de l'application :
 * il télécharge le fichier backend/api.js depuis GitHub (branche main) et l'exécute.
 * Les modifications fusionnées sur GitHub sont donc appliquées automatiquement,
 * sans rien recoller ici.
 *
 * Sécurité : l'accès est protégé par une clé secrète. Sans cette clé, l'API refuse toute demande.
 *
 * Obtenir le lien de connexion (téléphone ou ordinateur) : dans cet éditeur, choisir la fonction
 * « envoyerLienParEmail » dans la liste en haut, puis « Exécuter » : le lien arrive dans votre Gmail.
 * Sur ordinateur, le menu de la feuille « Dépannages › Lien de connexion » fait la même chose.
 */

// Adresse de l'application Web (Déployer › Gérer les déploiements, se termine par /exec).
// Facultatif : si elle est vide, le script essaie de la trouver tout seul.
var ADRESSE_API = '';

var GITHUB_REPO = 'p69gp84gk7-arch/26altlasSB31';
var GITHUB_BRANCH = 'main';
var API_SOURCE_URL = 'https://raw.githubusercontent.com/' + GITHUB_REPO + '/' + GITHUB_BRANCH + '/backend/api.js';
var APP_URL = 'https://' + GITHUB_REPO.split('/')[0] + '.github.io/' + GITHUB_REPO.split('/')[1] + '/';
var CACHE_FRESH_SECONDS = 300;    // le code est relu sur GitHub toutes les 5 minutes au plus
var CACHE_BACKUP_SECONDS = 21600; // copie de secours si GitHub est momentanément inaccessible

// ---------------------------------------------------------------------------
// API appelée par l'application
// ---------------------------------------------------------------------------

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Requête invalide.' });
  }
  if (!checkKey_(req.key)) {
    return json_({ ok: false, code: 'AUTH',
      error: 'Clé de connexion invalide. Dans la feuille : menu Dépannages › Lien de connexion.' });
  }
  try {
    if (req.action === 'reload') {
      return json_({ ok: true, data: { version: loadApi_(true).VERSION } });
    }
    var api = loadApi_(false);
    var fn = api.ACTIONS[req.action];
    if (typeof fn !== 'function') throw new Error('Action inconnue : ' + req.action);
    var data = fn.apply(null, req.args || []);
    return json_({ ok: true, data: data === undefined ? null : data });
  } catch (err) {
    return json_({ ok: false, error: (err && err.message) || String(err) });
  }
}

/** Simple vérification que l'API est en ligne (ne renvoie aucune donnée). */
function doGet() {
  return json_({ ok: true, message: 'API Dépannages en ligne. Application : ' + APP_URL });
}

// ---------------------------------------------------------------------------
// Menu de la feuille
// ---------------------------------------------------------------------------

function onOpen() {
  var ui = ui_();
  if (!ui) return; // exécuté depuis l'éditeur ou script non lié à la feuille : pas de menu
  ui.createMenu('Dépannages')
    .addItem('Lien de connexion', 'afficherLienConnexion')
    .addItem('Appliquer les mises à jour GitHub maintenant', 'mettreAJourMaintenant')
    .addSeparator()
    .addItem('Changer la clé (déconnecte tous les appareils)', 'changerCle')
    .addToUi();
}

/**
 * À exécuter depuis l'éditeur (fonctionne aussi sur téléphone) :
 * envoie le lien de connexion dans votre boîte Gmail et l'affiche dans le journal d'exécution.
 */
function envoyerLienParEmail() {
  var url = adresseApi_();
  if (!url) {
    throw new Error("Adresse de l'application Web introuvable : collez-la entre les guillemets de " +
      "ADRESSE_API en haut du fichier (Déployer › Gérer les déploiements › URL qui finit par /exec).");
  }
  var link = lienConnexion_(url);
  var to = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: to,
    subject: 'Dépannages – lien de connexion',
    body: 'Ouvrez ce lien une fois sur chaque téléphone / ordinateur :\n\n' + link +
      '\n\nCe lien contient votre clé secrète : ne le transférez pas.',
    htmlBody: '<p>Ouvrez ce lien <b>une fois</b> sur chaque téléphone / ordinateur :</p>' +
      '<p><a href="' + link + '">Ouvrir le fichier clients</a></p>' +
      '<p style="font-size:12px;color:#667085">Sur iPhone : appui long sur le lien › Ouvrir dans Safari, ' +
      'puis Partager › Sur l\'écran d\'accueil.<br>Lien complet (à coller si l\'application le demande) :<br>' +
      link + '</p><p style="font-size:12px;color:#667085">Ce lien contient votre clé secrète : ne le transférez pas.</p>'
  });
  Logger.log('Lien envoyé à ' + to + ' : ' + link);
  return link;
}

/** Sur ordinateur, depuis le menu de la feuille : fenêtre avec le lien à copier. */
function afficherLienConnexion() {
  var ui = ui_();
  if (!ui) return envoyerLienParEmail();
  var t = HtmlService.createTemplate(DIALOG_HTML_);
  t.key = getOrCreateKey_();
  t.url = adresseApi_();
  t.appUrl = APP_URL;
  ui.showModalDialog(t.evaluate().setWidth(520).setHeight(430), 'Lien de connexion');
}

/** Appelé par la boîte de dialogue : mémorise l'adresse /exec du déploiement. */
function enregistrerAdresseApi(url) {
  url = String(url || '').trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    throw new Error("L'adresse doit commencer par https://script.google.com/ et se terminer par /exec");
  }
  PropertiesService.getScriptProperties().setProperty('WEBAPP_URL', url);
  return url;
}

function mettreAJourMaintenant() {
  var api = loadApi_(true);
  var msg = 'Code à jour (version ' + api.VERSION + ').';
  var ui = ui_();
  if (ui) ui.alert(msg); else Logger.log(msg);
}

/** Nouvelle clé : tous les appareils sont déconnectés ; le nouveau lien est envoyé par e-mail. */
function changerCle() {
  var ui = ui_();
  if (ui) {
    var ok = ui.alert('Changer la clé ?',
      'Tous les téléphones et ordinateurs connectés devront rouvrir le nouveau lien de connexion.',
      ui.ButtonSet.OK_CANCEL);
    if (ok !== ui.Button.OK) return;
  }
  PropertiesService.getScriptProperties().setProperty('API_KEY', newKey_());
  if (ui) afficherLienConnexion(); else envoyerLienParEmail();
}

// ---------------------------------------------------------------------------
// Fonctions internes
// ---------------------------------------------------------------------------

var _api = null;

/** Interface de la feuille, ou null (éditeur, téléphone, script non lié à une feuille). */
function ui_() {
  try { return SpreadsheetApp.getUi(); } catch (e) { return null; }
}

/** Adresse /exec : ADRESSE_API, sinon celle enregistrée, sinon celle du déploiement. */
function adresseApi_() {
  var props = PropertiesService.getScriptProperties();
  var url = String(ADRESSE_API || '').trim() || props.getProperty('WEBAPP_URL') || '';
  if (!url) {
    try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  }
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) return '';
  props.setProperty('WEBAPP_URL', url);
  return url;
}

function lienConnexion_(url) {
  return APP_URL + '#connexion=' + encodeURIComponent(url) + '&cle=' + getOrCreateKey_();
}

/** Télécharge (ou reprend du cache) backend/api.js et renvoie son objet API. */
function loadApi_(force) {
  if (_api && !force) return _api;
  var cache = CacheService.getScriptCache();
  var code = force ? null : cache.get('api_fresh');
  if (!code) {
    var res = null;
    try {
      res = UrlFetchApp.fetch(API_SOURCE_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
    } catch (e) { res = null; }
    if (res && res.getResponseCode() === 200) {
      code = res.getContentText();
      try {
        cache.put('api_fresh', code, CACHE_FRESH_SECONDS);
        cache.put('api_backup', code, CACHE_BACKUP_SECONDS);
      } catch (e) { /* code trop gros pour le cache : il sera relu à chaque fois */ }
    } else {
      code = cache.get('api_backup');
      if (!code) {
        throw new Error('Impossible de télécharger le code depuis GitHub (' +
          (res ? 'HTTP ' + res.getResponseCode() : 'réseau') + ').');
      }
    }
  }
  _api = new Function(code + '\n;return API;')();
  return _api;
}

function checkKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!expected || typeof key !== 'string' || key.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function getOrCreateKey_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('API_KEY');
  if (!key) {
    key = newKey_();
    props.setProperty('API_KEY', key);
  }
  return key;
}

function newKey_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Jamais appelée : sert seulement à ce que Google demande, dès l'installation,
 * les autorisations dont le code téléchargé depuis GitHub a besoin
 * (Google Sheets, Google Drive, accès à GitHub).
 */
function autorisations_() {
  SpreadsheetApp.openById('x');
  DriveApp.getFolderById('x').createFolder('x');
  DriveApp.getFileById('x').setTrashed(true);
  UrlFetchApp.fetch('https://raw.githubusercontent.com/');
  MailApp.sendEmail('x', 'x', 'x');
}

var DIALOG_HTML_ = [
  '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.4">',
  '<p><b>1.</b> Adresse de l\'API (URL de l\'application Web copiée lors du déploiement, se termine par <code>/exec</code>) :</p>',
  '<input id="u" style="width:100%;padding:6px" value="<?= url ?>" placeholder="https://script.google.com/macros/s/.../exec">',
  '<button onclick="save()" style="margin-top:6px">Enregistrer l\'adresse</button> <span id="m" style="color:#b42318"></span>',
  '<p><b>2.</b> Ouvrez ce lien <b>une fois</b> sur chaque téléphone / ordinateur (envoyez-le-vous par e-mail ou SMS) :</p>',
  '<textarea id="l" readonly style="width:100%;height:90px;font-size:12px" onclick="this.select()"></textarea>',
  '<p><button onclick="copy()">Copier le lien</button> <a id="o" href="#" target="_blank">Ouvrir l\'application</a></p>',
  '<p style="color:#667085;font-size:12px">Ce lien contient votre clé secrète : ne le partagez pas. ',
  'En cas de perte d\'un téléphone : menu Dépannages › Changer la clé.</p>',
  '</div>',
  '<script>',
  'var KEY = <?!= JSON.stringify(key) ?>, APP = <?!= JSON.stringify(appUrl) ?>;',
  'function render(){var u=document.getElementById("u").value.trim();',
  ' var link=u?APP+"#connexion="+encodeURIComponent(u)+"&cle="+KEY:"(enregistrez d\'abord l\'adresse ci-dessus)";',
  ' document.getElementById("l").value=link; document.getElementById("o").href=u?link:"#";}',
  'function save(){var u=document.getElementById("u").value; document.getElementById("m").textContent="…";',
  ' google.script.run.withSuccessHandler(function(){document.getElementById("m").style.color="#1e7b45";',
  ' document.getElementById("m").textContent="Enregistrée"; render();})',
  ' .withFailureHandler(function(e){document.getElementById("m").textContent=e.message;}).enregistrerAdresseApi(u);}',
  'function copy(){var t=document.getElementById("l"); t.select(); document.execCommand("copy");}',
  'document.getElementById("u").addEventListener("input",render); render();',
  '</script>'
].join('\n');
