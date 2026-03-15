## Objectif du plan de tests

Décrire comment valider que le travail de l’agent développeur répond correctement à la demande « UI Test Prompt », en se concentrant sur :
- la pertinence fonctionnelle des scénarios de tests UI mis en place ;
- la robustesse et la maintenabilité des tests ;
- la facilité d’exécution pour les autres membres de l’équipe.

Ce plan sert à la fois :
- de guide pour écrire les tests automatisés ;
- de checklist pour les revues de code et de fonctionnalité.

## Portée des tests

- **Couverte** :
  - Scénarios de tests UI définis dans le cahier des charges (1 à 3 scénarios initiaux).
  - Comportement de l’interface utilisateur pour ces scénarios :
    - affichage des éléments ;
    - réactions aux interactions utilisateur ;
    - messages d’erreur / succès.
- **Non couverte (dans cette itération)** :
  - Tests de performance, charge ou sécurité.
  - Couverture exhaustive de tous les écrans de l’application.

## Types de tests

- **Tests UI end-to-end (ou équivalent)**
  - Simulent les actions d’un utilisateur réel sur l’interface.
  - Vérifient le rendu de la page et les transitions d’état.

- **Tests de composants UI** (si la stack le permet et que le développeur le juge pertinent)
  - Vérifient le comportement de composants isolés pour des cas particuliers.

- **Tests manuels ciblés**
  - Complètent les tests automatisés pour vérifier rapidement que l’implémentation répond au besoin fonctionnel, en suivant les mêmes scénarios que les tests automatiques.

## Scénarios de test à couvrir

Les scénarios exacts seront précisés par l’agent développeur, mais le plan doit au minimum inclure :

1. **Scénario principal (happy path)**
   - Parcours utilisateur nominal (par exemple : ouverture de la page, saisie de données valides, soumission, vérification du résultat attendu).
   - Vérifications :
     - les éléments de base sont visibles ;
     - les interactions fonctionnent (clics, saisies) ;
     - le résultat attendu est affiché sans erreur.

2. **Scénario d’erreur ou de saisie invalide**
   - Simuler une entrée utilisateur incorrecte ou une action non autorisée.
   - Vérifications :
     - message d’erreur affiché ;
     - absence de crash ou de comportement inattendu ;
     - possibilité de corriger et de poursuivre le flux normal si applicable.

3. **Scénario d’accessibilité / robustesse (optionnel)**
   - Par exemple vérifier le focus clavier, la présence de labels sur les champs, ou le comportement sur un viewport plus réduit.
   - Vérifications :
     - éléments accessibles via le clavier ;
     - absence de contenu masqué bloquant l’interaction ;
     - rendu lisible.

## Critères d’acceptation

Pour considérer cette itération comme réussie :

- Les scénarios définis dans la TODO sont implémentés en tests automatisés.
- L’exécution des tests sur l’environnement de développement standard :
  - réussit sans erreur non justifiée ;
  - reste dans des temps acceptables (quelques dizaines de secondes pour le set de tests actuel).
- Les tests sont **stables** :
  - pas de flakiness connue (tests qui échouent aléatoirement) dans des conditions normales.
- Le code de tests est :
  - lisible et structuré ;
  - documenté de façon minimale (noms de tests explicites, commentaires uniquement si nécessaire).

## Stratégie d’exécution

### En local
- Fournir une commande unique ou simple (par exemple `npm test ui`, `pytest -m ui`, ou équivalent) pour exécuter la suite de tests.
- Documenter les prérequis (dépendances, variables d’environnement, services à démarrer).

### En CI (si applicable)
- Intégrer la suite de tests UI dans la CI existante avec :
  - un job dédié ou une étape identifiée ;
  - des règles claires pour l’échec : la CI doit échouer si les tests UI échouent.

## Données de test

- Identifier les données nécessaires pour les scénarios (utilisateurs de test, jeux de données, configurations).
- Privilégier :
  - des données **stables et déterministes** ;
  - des fixtures ou seeds facilement rejouables.

## Revues et validation

- **Revue de code** :
  - Vérifier la clarté des scénarios et la localisation des assertions.
  - Vérifier l’absence de dépendances fragiles (timers arbitraires, sélecteurs CSS trop génériques).

- **Revue fonctionnelle** :
  - Jouer manuellement au moins le scénario principal pour confirmer que l’implémentation correspond bien à l’intention du demandeur.

- **Checklist de sortie**
  - Tous les scénarios prévus sont couverts.
  - La documentation d’exécution des tests est à jour.
  - Les limitations connues sont listées et partagées.

