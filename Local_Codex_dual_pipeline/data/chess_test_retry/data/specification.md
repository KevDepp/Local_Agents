# Cahier des charges – Jeu d’échecs Web

## 1. Contexte et objectifs

L’objectif est de créer un jeu d’échecs jouable dans un navigateur web, en HTML/CSS/JavaScript pur (sans framework obligatoire), destiné à deux humains jouant sur le même appareil.  
Le livrable de cette itération est une première version fonctionnelle permettant :
- d’afficher un plateau d’échecs 8x8,
- de visualiser toutes les pièces,
- de sélectionner une pièce et de la déplacer,
- de vérifier les règles de déplacement de base des pièces,
- de gérer les captures et l’alternance des tours (blanc/noir).

## 2. Périmètre fonctionnel (V1)

- Jeu d’échecs classique :
  - Plateau 8x8 avec coordonnées (optionnelles) visibles.
  - Deux camps : Blanc et Noir.
  - Position initiale standard des pièces.
- Représentation des pièces :
  - Soit via caractères Unicode, soit via images (au choix du développeur).
  - Les pièces doivent être clairement distinguables visuellement (couleur, icône, contraste).
- Interaction utilisateur :
  - Sélection d’une pièce par clic.
  - Indication visuelle de la pièce sélectionnée.
  - Déplacement par clic sur une case cible.
  - Blocage des déplacements illégaux (voir règles ci-dessous).
  - Alternance automatique des tours (blanc puis noir, etc.).
- Règles de déplacement de base :
  - Roi : une case dans n’importe quelle direction (8 directions).
  - Dame : déplacement de Tour ou de Fou (horizontal, vertical ou diagonal, sans sauter d’autres pièces).
  - Tour : lignes/colonnes, sans sauter d’autres pièces.
  - Fou : diagonales, sans sauter d’autres pièces.
  - Cavalier : déplacement en « L » (2 cases dans une direction + 1 perpendiculaire), peut sauter par-dessus les pièces.
  - Pion :
    - Avance d’une case vers l’avant si la case est libre.
    - Option : double pas initial (deux cases) si libre sur le chemin.
    - Capture en diagonale (une case en avant à gauche/droite).
    - Pas d’implémentation obligatoire d’en passant en V1.
  - Les pièces ne peuvent pas sortir du plateau.
  - Une pièce ne peut pas capturer une pièce de la même couleur.
- Captures :
  - Lorsqu’une pièce se déplace sur une case occupée par une pièce adverse, cette dernière est retirée du plateau.
  - Une liste simple des coups (notation libre) peut être affichée à titre d’historique (optionnel mais recommandé).
- Gestion de la partie :
  - Pas d’IA : les deux joueurs jouent à tour de rôle sur le même écran.
  - Vérification minimale du « tour du joueur » : impossible de déplacer une pièce de la mauvaise couleur.
  - Détection du « roi capturé » (simple) éventuellement comme condition de fin (optionnel).

## 3. Hors périmètre (V1)

Les éléments suivants ne sont pas requis pour cette première version :
- Roque (petit/grand),
- Prise en passant,
- Promotion avancée des pions (une promotion simple en Reine peut être considérée comme un bonus mais pas obligatoire),
- Détection formelle d’échec, d’échec et mat, de pat,
- Gestion du temps (horloge, chronomètre),
- Système de score, sauvegarde/chargement de partie,
- Mode réseau ou jeu contre IA,
- Support mobile très avancé (gestes complexes), même si une mise en page responsive basique est souhaitée.

## 4. Exigences fonctionnelles détaillées

### 4.1 Plateau
- Affichage d’une grille 8x8.
- Cases alternées clair/foncé.
- Option : affichage des lettres (a–h) et chiffres (1–8) sur les bords.
- Le plateau doit être centré ou clairement visible sur la page.

### 4.2 Pièces
- Pour chaque camp : 8 pions, 2 tours, 2 cavaliers, 2 fous, 1 dame, 1 roi.
- Représentation :
  - Unicode recommandé pour aller vite (♔♕♖♗♘♙ / ♚♛♜♝♞♟), ou
  - Images SVG/PNG (un set cohérent).
- Les pièces doivent être correctement positionnées au chargement de la page.

### 4.3 Interaction
- Clic sur une case contenant une pièce de la couleur active :
  - La pièce devient « sélectionnée ».
  - Option : surligner les cases de destination autorisées.
- Clic sur une case de destination :
  - Si la case est autorisée selon les règles de déplacement, la pièce se déplace.
  - Sinon, aucune modification de l’état (et éventuellement affichage d’un message discret d’erreur).
- Après un coup valide :
  - Changement de joueur actif (Blanc → Noir → Blanc…).
  - Option : ajout du coup à un historique.

### 4.4 Validation des coups
- Mécanisme central de validation :
  - Vérifier que la pièce appartient au joueur actif.
  - Calculer les coups autorisés en fonction du type de pièce et de la configuration du plateau.
  - Vérifier les obstacles (sauf pour le Cavalier).
  - Vérifier les déplacements hors du plateau.
  - Vérifier les captures (pièce adverse uniquement).
- Pour V1, il n’est pas requis de vérifier que le roi reste hors d’échec après un coup.

## 5. Exigences techniques

- Technologies :
  - HTML5 pour la structure de la page.
  - CSS3 pour le style (mise en forme du plateau et des pièces).
  - JavaScript (ES6+) pour la logique de jeu et les interactions.
- Compatibilité :
  - Navigateur cible : dernières versions de Chrome/Firefox/Edge.
  - Aucune dépendance serveur obligatoire (fonctionnement en local via un simple fichier HTML).
- Structure des fichiers recommandée :
  - `index.html` : structure de la page, conteneur du plateau, panneaux latéraux éventuels (infos, historique).
  - `styles.css` : style du plateau, des pièces, des messages, gestion simple de la responsivité.
  - `main.js` : point d’entrée JS, initialisation du jeu, gestion des événements.
  - Option de modularisation JS :
    - `board.js` : représentation du plateau (données, helpers).
    - `pieces.js` : définition des types de pièces et de leurs mouvements théoriques.
    - `rules.js` : validation des coups, logique métier.
    - `ui.js` : rendu du plateau dans le DOM, mise à jour suite aux coups.

## 6. Exigences UX/UI

- Interface claire et minimaliste :
  - Plateau bien visible, contrastes suffisants.
  - Les actions principales (sélection/déplacement) doivent être évidentes.
- Feedback visuel :
  - Indiquer la case/ pièce sélectionnée.
  - Option : surligner les cases de déplacement possible.
  - Option : présenter un message textuel en cas de tentative de coup invalide.
- Responsivité :
  - Le plateau doit rester jouable sur un écran d’ordinateur portable.
  - Une adaptation de base pour tablettes/smartphones (plateau redimensionné) est souhaitée mais non critique.

## 7. Architecture et responsabilités (vue développeur)

- Modèle de données :
  - Représentation interne du plateau (par exemple tableau 2D ou liste de pièces avec coordonnées).
  - Chaque pièce a :
    - un type (`king`, `queen`, `rook`, `bishop`, `knight`, `pawn`),
    - une couleur (`white`, `black`),
    - une position (ligne, colonne).
- Logique métier (moteur de règles) :
  - Fonctions pour calculer les coups possibles d’une pièce donnée.
  - Fonctions pour valider un coup (source, destination) au vu de l’état courant.
  - Gestion des captures et des mises à jour d’état.
- Couche UI :
  - Rendu du plateau et des pièces dans le DOM.
  - Gestion des événements de clic.
  - Synchronisation de l’état interne et de l’affichage.

## 8. Critères d’acceptation (V1)

Pour que la V1 soit considérée comme livrée :
- Le chargement de la page affiche un plateau 8x8 avec la position initiale standard des pièces.
- Le joueur blanc commence et ne peut déplacer que des pièces blanches au premier tour.
- Après chaque coup valide, le tour change automatiquement.
- Les pièces se déplacent uniquement selon leurs règles de base :
  - Pas de sortie du plateau.
  - Pas de saut de pièces, sauf pour le Cavalier.
  - Pas de capture d’une pièce alliée.
  - Les pions ne peuvent capturer que en diagonale.
- Les captures fonctionnent (la pièce capturée disparaît du plateau).
- Les tentatives de coups illégaux sont ignorées (ou explicitées) sans casser l’état du jeu.
- Le jeu est utilisable de bout en bout pour jouer une partie « approximative » (sans roque/en passant/mat formel) entre deux humains.

