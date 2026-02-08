# Plan de tests – Jeu d’échecs Web

## 1. Objectifs du plan de tests

- Vérifier que la première version du jeu d’échecs web respecte les exigences définies dans `specification.md`.
- S’assurer que les règles de déplacement de base sont correctement implémentées.
- Garantir que l’interface est utilisable, sans erreurs JavaScript bloquantes.

## 2. Stratégie de test

- Tests manuels centrés sur :
  - La mise en place initiale du plateau.
  - Les déplacements légaux/illégaux de chaque type de pièce.
  - La gestion des captures.
  - L’alternance des tours entre Blanc et Noir.
- Tests techniques de base :
  - Vérification de l’absence d’erreurs dans la console du navigateur.
  - Vérification de la stabilité de l’état du jeu (pas de plateau « cassé » après une série de coups).

Des tests unitaires JS sur le moteur de règles peuvent être ajoutés en bonus (non obligatoires pour cette itération, mais recommandés si le temps le permet).

## 3. Environnement de test

- Navigateur : dernière version stable de Chrome (référence), plus un second navigateur (Firefox ou Edge).
- Résolution minimale : 1366×768.
- Mode de lancement : ouverture du fichier `index.html` en local ou via un simple serveur statique.

## 4. Cas de test fonctionnels

### CHESS-TC-01 – Affichage initial du plateau
- Précondition :
  - L’application est chargée dans le navigateur.
- Étapes :
  1. Ouvrir la page du jeu.
  2. Observer le plateau.
  3. Vérifier la position des pièces.
- Résultat attendu :
  - Le plateau 8x8 est visible avec alternance clair/foncé.
  - Les pièces sont positionnées suivant la disposition standard (pions en 2e/7e rangée, pièces majeures en 1re/8e rangée).

### CHESS-TC-02 – Tour de jeu initial (Blanc)
- Précondition :
  - CHESS-TC-01 réussi.
- Étapes :
  1. Tenter de sélectionner une pièce noire au premier coup.
  2. Tenter de la déplacer.
- Résultat attendu :
  - La pièce noire ne peut pas être déplacée tant que ce n’est pas au tour des Noirs.
  - Une pièce blanche est sélectionnable et déplaçable selon les règles.

### CHESS-TC-03 – Déplacement simple des pions
- Précondition :
  - CHESS-TC-01 réussi.
- Étapes :
  1. Sélectionner un pion blanc sur la 2e rangée.
  2. Le déplacer d’une case en avant.
  3. Répéter l’opération avec un autre pion.
- Résultat attendu :
  - Chaque pion avance d’une case si la case est libre.
  - Les pions ne peuvent pas reculer ni se déplacer latéralement.

### CHESS-TC-04 – Double pas initial des pions (si implémenté)
- Précondition :
  - CHESS-TC-01 réussi.
- Étapes :
  1. Sélectionner un pion sur sa position de départ.
  2. Tenter de le déplacer de deux cases vers l’avant.
- Résultat attendu :
  - Le déplacement de deux cases est accepté uniquement si les deux cases sont libres.
  - Si ce cas n’est pas implémenté, documenter la limitation (le pion ne fait qu’un pas).

### CHESS-TC-05 – Captures de pions
- Précondition :
  - CHESS-TC-03 réussi.
- Étapes :
  1. Positionner (via une séquence de coups légaux) un pion blanc de façon à pouvoir capturer un pion noir en diagonale.
  2. Tenter la capture.
- Résultat attendu :
  - Le pion blanc peut se déplacer en diagonale d’une case pour capturer la pièce adverse.
  - La pièce capturée disparaît du plateau.

### CHESS-TC-06 – Pièces à longue portée (Tour, Fou, Dame)
- Précondition :
  - CHESS-TC-01 réussi.
- Étapes :
  1. Libérer une Tour blanche (en déplaçant les pions devant elle).
  2. Déplacer la Tour en ligne droite sur plusieurs cases.
  3. Répéter avec un Fou sur les diagonales.
  4. Répéter avec la Dame (combinaison ligne/colonne/diagonale).
- Résultat attendu :
  - Les pièces se déplacent uniquement en ligne droite (Tour), diagonale (Fou) ou combinaison (Dame).
  - Aucune des pièces ne peut sauter par-dessus une autre pièce (sauf le Cavalier).

### CHESS-TC-07 – Cavalier
- Précondition :
  - CHESS-TC-01 réussi.
- Étapes :
  1. Sélectionner un Cavalier.
  2. Tenter différents déplacements en « L » (2 cases dans une direction, 1 perpendiculaire).
- Résultat attendu :
  - Seuls les déplacements en « L » sont acceptés.
  - Le Cavalier peut sauter par-dessus d’autres pièces.

### CHESS-TC-08 – Roi
- Précondition :
  - CHESS-TC-01 réussi.
- Étapes :
  1. Libérer le Roi blanc en déplaçant les pièces devant lui.
  2. Tenter de déplacer le Roi d’une case dans les différentes directions.
- Résultat attendu :
  - Le Roi se déplace d’une seule case dans les 8 directions possibles.
  - Le Roi ne peut pas se déplacer sur une case occupée par une pièce alliée.

### CHESS-TC-09 – Gestion des coups illégaux
- Précondition :
  - CHESS-TC-01 réussi.
- Étapes :
  1. Tenter de déplacer une pièce selon un schéma non autorisé (ex. Tour en diagonale, Fou en ligne).
  2. Tenter de déplacer une pièce hors du plateau.
  3. Tenter de déplacer une pièce sur une pièce alliée.
- Résultat attendu :
  - Aucun de ces coups n’est accepté.
  - L’état du plateau reste cohérent.
  - Option : un message d’erreur ou un feedback visuel indique l’invalidité du coup.

### CHESS-TC-10 – Alternance des tours
- Précondition :
  - CHESS-TC-02 réussi.
- Étapes :
  1. Jouer une séquence de coups légaux alternant Blanc et Noir.
  2. Après chaque coup, tenter de rejouer immédiatement avec la même couleur.
- Résultat attendu :
  - Le tour change bien après chaque coup valide.
  - Il est impossible de jouer deux fois de suite avec la même couleur sans que l’adversaire ait joué.

### CHESS-TC-11 – Captures successives
- Précondition :
  - CHESS-TC-05 réussi.
- Étapes :
  1. Produire une situation avec plusieurs captures possibles de part et d’autre.
  2. Enchaîner plusieurs captures consécutives.
- Résultat attendu :
  - Chaque capture met correctement à jour l’état interne et l’affichage.
  - Aucune pièce « fantôme » ou doublon n’apparaît.

### CHESS-TC-12 – Historique des coups (si implémenté)
- Précondition :
  - Historique activé dans l’interface.
- Étapes :
  1. Jouer plusieurs coups.
  2. Observer l’historique.
- Résultat attendu :
  - Chaque coup valide est listé dans l’historique avec une description lisible.
  - L’historique suit l’ordre chronologique.

## 5. Tests techniques

### TECH-TC-01 – Absence d’erreurs JavaScript
- Étapes :
  1. Ouvrir la console de développement du navigateur.
  2. Jouer une partie courte en enchaînant différents types de coups (y compris quelques tentatives illégales).
- Résultat attendu :
  - Aucune erreur JavaScript non gérée ne s’affiche dans la console.

### TECH-TC-02 – Responsivité basique
- Étapes :
  1. Redimensionner la fenêtre du navigateur (largeur réduite).
  2. Tester sur une résolution minimale proche d’un petit écran.
- Résultat attendu :
  - Le plateau reste entièrement visible.
  - Les cases et pièces restent claires et cliquables.

## 6. Critères de réussite globale

Le livrable sera considéré comme conforme si :
- Tous les cas de test fonctionnels CHESS-TC-01 à CHESS-TC-11 sont réussis (CHESS-TC-12 étant optionnel).
- Les tests techniques TECH-TC-01 et TECH-TC-02 sont réussis.
- Les limitations éventuelles (ex. absence de roque, en passant, promotion avancée) sont connues et cohérentes avec `specification.md`.

