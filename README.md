# Fichier clients – Dépannages électroménager

Application pour suivre mes dépannages d'électroménager, utilisable sur téléphone et sur ordinateur :

- **fiches clients / interventions** enregistrées dans une feuille **Google Sheets** ;
- **photos** rangées dans **Google Drive** (un dossier par intervention) et affichées dans l'application ;
- **factures des pièces commandées** (PDF ou photo) archivées dans Google Drive, rangées par année.

**Adresse de l'application : https://p69gp84gk7-arch.github.io/26altlasSB31/**

## Comment ça marche

```
Téléphone / ordinateur
  └─ site GitHub Pages (dossier web/)          ← publié automatiquement à chaque fusion dans main
       │  demandes protégées par une clé secrète
       ▼
Google Apps Script : petit « chargeur » (apps-script/Code.gs)   ← collé UNE SEULE FOIS
       │  télécharge et exécute backend/api.js depuis GitHub (branche main, toutes les 5 min)
       ▼
Google Sheets « Fichier clients dépannages »  +  Google Drive (photos, factures)
```

Toutes les modifications passent par des **pull requests GitHub**. Une fois une pull request fusionnée dans `main` :

- l'interface (`web/`) est republiée automatiquement sur GitHub Pages (1 à 2 minutes) ;
- le code serveur (`backend/api.js`) est relu automatiquement par Google (5 minutes au plus).

Plus rien à coller dans Google Apps Script.

## Installation (une seule fois)

### 1. Activer GitHub Pages

Sur GitHub, dans le dépôt : **Settings › Pages › Build and deployment › Source : GitHub Actions**.

Puis fusionner la pull request dans `main`. Le site est publié automatiquement (onglet **Actions**, « Publication du site »). Si la fusion a eu lieu avant l'activation : **Actions › Publication du site (GitHub Pages) › Run workflow**.

### 2. Installer le chargeur dans la feuille (un seul copier-coller)

1. Ouvrir la feuille **Fichier clients dépannages** › menu **Extensions › Apps Script**.
2. Remplacer tout le contenu de `Code.gs` par le fichier [`apps-script/Code.gs`](apps-script/Code.gs) (environ 200 lignes). **Enregistrer** 💾.
3. ⚙️ **Paramètres du projet** › Fuseau horaire : **(GMT+01:00) Paris**.
4. **Déployer › Nouveau déploiement** › type **Application Web** :
   - *Exécuter en tant que* : **Moi** ;
   - *Qui a accès* : **Tout le monde** (indispensable pour que le site GitHub puisse lui parler ; les données restent protégées par la clé secrète) ;
   - **Déployer** › **Autoriser l'accès** › choisir votre compte › « Google n'a pas validé cette application » : **Paramètres avancés › Accéder à … (non sécurisé)** › **Autoriser**.
5. **Copier l'URL de l'application Web** (elle se termine par `/exec`).

### 3. Connecter vos appareils

**Depuis un téléphone ou un ordinateur** (éditeur Apps Script) :
1. Facultatif : coller l'URL `/exec` entre les guillemets de `var ADRESSE_API = '';` en haut de `Code.gs`, puis enregistrer.
2. Dans la liste des fonctions en haut de l'éditeur, choisir **`envoyerLienParEmail`** › **▶ Exécuter** (accepter l'autorisation d'envoi d'e-mail la première fois).
3. Le **lien de connexion** arrive dans votre Gmail (il est aussi affiché dans le journal d'exécution).

**Ou, sur ordinateur uniquement** : recharger la feuille › menu **Dépannages › Lien de connexion** › coller l'URL `/exec` › **Enregistrer l'adresse** › **Copier le lien**. (Les menus personnalisés n'existent pas dans l'application Google Sheets pour téléphone.)

Ouvrir ce lien **une fois** sur chaque téléphone / ordinateur : l'appareil reste connecté.
Sur iPhone : appui long sur le lien › **Ouvrir dans Safari**, puis **Partager › Sur l'écran d'accueil**. Si l'icône de l'écran d'accueil demande la connexion, toucher ⚙︎ et coller le lien.

## Faire évoluer l'application

1. Demander la modification (à Claude ou autre) : elle arrive sous forme de **pull request** sur GitHub.
2. Les **tests automatiques** se lancent sur la pull request (onglet *Checks*).
3. **Fusionner** la pull request : c'est tout. Pour appliquer le code serveur immédiatement plutôt que sous 5 minutes : menu **Dépannages › Appliquer les mises à jour GitHub maintenant**.

À recoller dans Apps Script seulement si `apps-script/Code.gs` lui-même change (rare : par exemple si une nouvelle autorisation Google est nécessaire). La pull request le signalera.

## Sécurité

- Le site GitHub Pages est public mais **ne contient aucune donnée** : sans la clé, il affiche seulement l'écran de connexion.
- La clé secrète est enregistrée dans Apps Script et sur vos appareils ; le lien de connexion la contient, **ne le partagez pas**.
- Téléphone perdu : exécuter la fonction **`changerCle`** dans l'éditeur (ou menu **Dépannages › Changer la clé**) ; le nouveau lien est envoyé par e-mail.
- Le code exécuté par Google vient de la branche `main` du dépôt : seules les personnes autorisées à fusionner sur ce dépôt peuvent le modifier. Le dépôt doit rester **public** (sinon Google ne peut plus lire `backend/api.js`).

## Données enregistrées

**Onglet Interventions** : ID (`INT-0001`…), nom, prénom, téléphone, adresse, type d'appareil, marque, référence de l'appareil, panne / travaux, date de diagnostic, temps de diagnostic (min), date d'intervention, temps de réparation (min), pièce utilisée, montant pièce (€), montant réglé (€), terminé (case à cocher), lien du dossier photos, créé le, modifié le, marge (calculée : réglé − pièce).

**Listes déroulantes** (type d'appareil, marque, fournisseur) : elles proposent les valeurs de l'onglet **Listes** (pré-rempli avec les types et marques courants, modifiable dans la feuille) et toutes les valeurs déjà enregistrées. Le choix **Autre…** permet d'en saisir une nouvelle, qui sera proposée ensuite. Les fournisseurs viennent des factures déjà archivées (et de la colonne « Fournisseurs » de l'onglet Listes).

**Onglet Factures** : ID (`FAC-0001`…), date facture, fournisseur, n° facture, pièce, montant (€), intervention liée (vide = stock), client, lien du fichier, ajoutée le.
Fichiers rangés dans `Factures pièces/<année>/` et nommés `date_fournisseur_numéro_ID` (ex. `2026-11-12_Pieces-Express_FA-1234_FAC-0007.pdf`).

**Onglet Récapitulatif** : interventions terminées / en cours, total pièces, total réglé, marge, total des factures archivées, heures de diagnostic, heures de réparation, marge par heure.

**Documentation technique** : dès que la référence de l'appareil est saisie, la fiche propose des recherches préparées avec la marque et la référence : vue éclatée, manuel de service (PDF), pièces détachées (Spareka, SOS Accessoire), ManualsLib, Elektrotanya, iFixit, codes erreur. Il n'existe pas de base libre de vues éclatées : ces documents appartiennent aux fabricants. Dans l'UE, les réparateurs professionnels peuvent s'inscrire sur l'espace pro de chaque fabricant pour obtenir les vues éclatées officielles (règlements écoconception 2019/2023, 2019/2022, 2019/2019).

**Temps passés** : dans la fiche, deux listes (de 5 en 5 min jusqu'à 1 h, puis de 15 en 15 min jusqu'à 10 h). La fiche affiche le temps total et la marge par heure. Dans la feuille, les temps sont en minutes.

Dans Google Drive, tout est dans le dossier **Dépannages électroménager** :

```
Dépannages électroménager/
├── Fichier clients dépannages        (feuille)
├── Photos interventions/INT-0001 - Nom Prénom/…
└── Factures pièces/2026/…
```

## En cas de problème

| Problème | Solution |
|---|---|
| L'application demande la connexion | Rouvrir le lien de connexion (fonction `envoyerLienParEmail`). |
| « Cannot call SpreadsheetApp.getUi() from this context » | Normal depuis l'éditeur ou un téléphone : utiliser la fonction `envoyerLienParEmail`. |
| « Clé de connexion invalide » | La clé a été changée : rouvrir le nouveau lien. |
| « Pas de connexion au serveur » | Vérifier le réseau ; vérifier que le déploiement Apps Script est bien en accès **Tout le monde**. |
| « Impossible de télécharger le code depuis GitHub » | Le dépôt est privé ou `backend/api.js` n'est pas dans `main`. |
| Le site GitHub affiche une erreur 404 | GitHub Pages n'est pas activé (étape 1) ou la publication n'a pas encore tourné. |

## Structure du dépôt

```
web/                  interface (publiée sur GitHub Pages)
backend/api.js        logique serveur, lue automatiquement par Apps Script
apps-script/Code.gs   chargeur à coller une seule fois dans la feuille
tests/                tests automatiques (services Google simulés)
.github/workflows/    tests sur chaque pull request + publication du site
```

Tests en local : `node --test tests/backend.test.js` et, avec Playwright installé, `node --test tests/web.test.js`.
