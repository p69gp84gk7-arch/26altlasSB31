/**
 * Fichier clients – Dépannages électroménager : CHARGEUR (à coller une seule fois).
 *
 * Ce petit script relie l'application (hébergée sur GitHub Pages) à votre feuille
 * Google Sheets et à votre Google Drive. Il ne contient pas la logique de l'application :
 * il télécharge le fichier backend/api.js depuis GitHub (branche main) et l'exécute.
 * Les modifications fusionnées sur GitHub sont donc appliquées automatiquement,
 * sans rien recoller ici.
 *
 * Sécurité : l'accès est protégé par une clé secrète (menu Dépannages › Lien de connexion).
 * Sans cette clé, l'API refuse toute demande.
 */

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
  SpreadsheetApp.getUi()
    .createMenu('Dépannages')
    .addItem('Lien de connexion', 'afficherLienConnexion')
    .addItem('Appliquer les mises à jour GitHub maintenant', 'mettreAJourMaintenant')
    .addSeparator()
    .addItem('Changer la clé (déconnecte tous les appareils)', 'changerCle')
    .addToUi();
}

function afficherLienConnexion() {
  var key = getOrCreateKey_();
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBAPP_URL') || '';
  if (!url) {
    var guess = '';
    try { guess = ScriptApp.getService().getUrl() || ''; } catch (e) { /* pas encore déployé */ }
    if (/\/exec$/.test(guess)) url = guess;
  }
  var t = HtmlService.createTemplate(DIALOG_HTML_);
  t.key = key;
  t.url = url;
  t.appUrl = APP_URL;
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(520).setHeight(430), 'Lien de connexion');
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
  SpreadsheetApp.getUi().alert('Code à jour (version ' + api.VERSION + ').');
}

function changerCle() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Changer la clé ?',
    'Tous les téléphones et ordinateurs connectés devront rouvrir le nouveau lien de connexion.',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().setProperty('API_KEY', newKey_());
  afficherLienConnexion();
}

// ---------------------------------------------------------------------------
// Fonctions internes
// ---------------------------------------------------------------------------

var _api = null;

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
