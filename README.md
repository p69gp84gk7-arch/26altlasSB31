# Fichier clients – Dépannages électroménager

Petite application web pour suivre mes dépannages d'électroménager :

- les fiches clients / interventions sont stockées dans une **feuille Google Sheets** ;
- les **photos** sont rangées dans **Google Drive** (un dossier par intervention) et s'affichent directement dans l'application ;
- les **factures des pièces commandées** (PDF ou photo) sont archivées dans Google Drive, rangées par année, et liées à l'intervention concernée ;
- utilisable sur téléphone (prise de photo directe) comme sur ordinateur.

L'application est un projet **Google Apps Script** : elle tourne sur votre compte Google, sans serveur ni abonnement.

## Ce qui est enregistré pour chaque intervention

| Colonne | Contenu |
|---|---|
| ID | Numéro automatique (`INT-0001`, `INT-0002`…) |
| Nom, Prénom | Client |
| Téléphone, Adresse | Coordonnées (facultatif) |
| Appareil | Ex. « lave-linge Bosch » (facultatif) |
| Panne / travaux | Description (facultatif) |
| Date de l'appel | Jour où le client a appelé |
| Date d'intervention | Jour du dépannage |
| Pièce utilisée | Pièce remplacée |
| Montant pièce (€) | Prix de la pièce |
| Montant réglé (€) | Somme payée par le client |
| Terminé | Case à cocher : intervention terminée ou en cours |
| Dossier photos | Lien vers le dossier Drive de l'intervention |
| Créé le / Modifié le | Dates automatiques |
| Marge (€) | Calculée par la feuille : montant réglé − montant pièce |

## Factures des pièces commandées

Onglet **Factures** de la feuille, une ligne par facture archivée :

| Colonne | Contenu |
|---|---|
| ID | Numéro automatique (`FAC-0001`…) |
| Date facture | Obligatoire, sert au rangement par année |
| Fournisseur, N° facture | Facultatifs, repris dans le nom du fichier |
| Pièce | Pièce(s) commandée(s) |
| Montant (€) | Montant de la facture |
| Intervention | ID de l'intervention liée, vide pour une pièce achetée pour le stock |
| Client | Nom du client de l'intervention liée |
| Fichier | Lien vers le fichier dans Drive |
| Ajoutée le | Date automatique |

Le fichier est rangé dans `Factures pièces/<année>/` et renommé `date_fournisseur_numéro_ID` (ex. `2026-11-12_Pieces-Express_FA-1234_FAC-0007.pdf`) pour être retrouvé facilement dans Drive, même sans l'application. Si la date ou le numéro sont corrigés, le fichier est renommé et déplacé dans la bonne année.

L'onglet **Récapitulatif** totalise le nombre d'interventions (terminées / en cours), le total des pièces, le total réglé, la marge et le total des factures archivées.

## Éléments déjà créés dans Google Drive

Dossier **Dépannages électroménager** :

- `Fichier clients dépannages` (Google Sheets) – onglets *Interventions* et *Récapitulatif* ;
- `Photos interventions` – un sous-dossier `INT-0001 - Nom Prénom` est créé automatiquement au premier ajout de photo ;
- `Factures pièces` – un sous-dossier par année (`2026`, `2027`…) est créé automatiquement.

Les identifiants de ces éléments sont déjà renseignés en haut de `apps-script/Code.gs` (`CONFIG`).

## Installation (une seule fois, environ 5 minutes)

1. Ouvrir la feuille **Fichier clients dépannages** dans Google Sheets.
2. Menu **Extensions › Apps Script**. Un éditeur s'ouvre avec un fichier `Code.gs`.
3. Remplacer tout le contenu de `Code.gs` par celui du fichier [`apps-script/Code.gs`](apps-script/Code.gs).
4. Cliquer sur **+** (à côté de « Fichiers ») › **HTML**, nommer le fichier `Index` (sans `.html`), et y coller le contenu de [`apps-script/Index.html`](apps-script/Index.html).
5. Dans **Paramètres du projet** (roue dentée) : fuseau horaire **(GMT+01:00) Paris**.
   *(Facultatif : cocher « Afficher le fichier manifeste appsscript.json » et y coller [`apps-script/appsscript.json`](apps-script/appsscript.json).)*
6. Cliquer sur **Enregistrer** (icône disquette).
7. **Déployer › Nouveau déploiement** › type **Application Web** :
   - *Exécuter en tant que* : **Moi** ;
   - *Qui a accès* : **Moi uniquement** ;
   - cliquer **Déployer**, puis **Autoriser l'accès** et choisir votre compte Google.
     Google affiche « Google n'a pas validé cette application » : cliquer **Paramètres avancés › Accéder à … (non sécurisé)**. C'est normal : c'est votre propre script.
8. Copier l'**URL de l'application Web** (elle se termine par `/exec`) et l'ouvrir.

Sur téléphone : ouvrir l'URL dans le navigateur (connecté à votre compte Google), puis **Partager › Sur l'écran d'accueil** (iPhone) ou **⋮ › Ajouter à l'écran d'accueil** (Android) pour l'avoir comme une appli.

Une fois le script installé, la feuille affiche aussi un menu **Dépannages › Ouvrir l'application** qui donne le lien.

## Utilisation

- **+ Nouvelle** : créer une fiche (la date de l'appel est pré-remplie avec la date du jour).
- Toucher une fiche dans la liste pour la modifier ; cocher **Intervention terminée** quand c'est fini.
- **+ Ajouter des photos** : prendre une photo ou en choisir dans la galerie. Les photos sont réduites (1600 px) avant l'envoi pour aller vite en 4G, puis enregistrées dans le dossier Drive de l'intervention.
- Toucher une photo pour l'agrandir, passer à la suivante, l'ouvrir dans Drive ou la supprimer (corbeille Drive, récupérable 30 jours).
- Recherche par nom, prénom, téléphone, appareil ou pièce ; filtres *En cours* / *Terminées*.
- Supprimer une fiche retire la ligne de la feuille mais **garde les photos et les factures** dans Drive.
- **Factures** : dans une fiche d'intervention, **+ Ajouter une facture** pré-remplit la pièce, le montant et l'intervention ; il reste à choisir le PDF (ou prendre la facture en photo). L'onglet **Factures pièces** liste toutes les factures, avec filtre par année, recherche et total ; **+ Facture** permet d'archiver une pièce achetée pour le stock. Les photos de factures sont réduites à 2000 px (lisibles), les PDF sont envoyés tels quels (20 Mo maximum).
- Supprimer une facture retire la ligne et met le fichier à la corbeille Drive (récupérable 30 jours).

On peut aussi saisir ou corriger directement dans la feuille Google Sheets : l'application relit la feuille à chaque ouverture. Il faut simplement garder l'ordre des colonnes et un ID dans la colonne A.

## Mettre à jour l'application

Le code évolue par **pull requests** sur GitHub. Une fois une pull request fusionnée dans `main`, recopier `Code.gs` et `Index.html` dans l'éditeur Apps Script (ou `clasp push`), puis publier une nouvelle version.

Après avoir modifié le code dans l'éditeur Apps Script : **Déployer › Gérer les déploiements › ✏️ Modifier › Version : Nouvelle version › Déployer**. L'URL reste la même.

## Option : déployer avec `clasp` (ligne de commande)

```bash
npm install -g @google/clasp
clasp login
clasp clone <ID_DU_SCRIPT> --rootDir apps-script   # ID visible dans Paramètres du projet
clasp push
```

## Structure du dépôt

```
apps-script/
  Code.gs           # serveur : lecture/écriture de la feuille, photos Drive
  Index.html        # interface (liste, fiche, photos)
  appsscript.json   # manifeste (fuseau Paris, application web privée)
```
