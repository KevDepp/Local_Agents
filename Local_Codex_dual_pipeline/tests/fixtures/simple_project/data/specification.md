## Contexte et objectif

Demande utilisateur : **« UI Test Prompt »** (peu détaillée).

Objectif de ce cahier des charges : cadrer le travail d’un·e développeur·e afin de concevoir ou adapter une fonctionnalité liée à l’interface utilisateur (UI) et à ses tests automatisés, malgré la faible précision initiale.

Ce document doit servir :
- de référence pour les décisions fonctionnelles et techniques ;
- de base à la TODO de développement et au plan de tests ;
- de support de clarification avec le demandeur.

## Vision produit (interprétation)

Sur la base du seul intitulé « UI Test Prompt », on fait l’hypothèse suivante :
- Le projet a besoin d’un **flux de test de l’interface utilisateur** (UI) déclenché à partir d’un « prompt » ou scénario décrit en langage naturel.
- L’agent développeur devra mettre en place (ou compléter) :
  - une ou plusieurs **vues UI** cibles à tester (page web, écran applicatif, composant) ;
  - une **infrastructure de tests UI automatisés** (par ex. via un framework de tests end-to-end ou de tests de composants) ;
  - un **point d’entrée** où l’on exprime le « prompt de test UI » qui décrit ce que le test doit vérifier.

Cette interprétation est **à valider avec le demandeur** avant implémentation.

## Périmètre fonctionnel envisagé

### Inclus
- Définir clairement **1 à 3 scénarios de test UI représentatifs** à partir du prompt (ou en proposant des exemples).
- Décrire les **comportements attendus** pour chaque scénario :
  - éléments à afficher ;
  - interactions utilisateur (clic, saisie, navigation) ;
  - messages d’erreur ou de succès ;
  - critères d’accessibilité minimaux (focus, labels, lisibilité).
- Spécifier les **résultats attendus** de chaque scénario (ce qui permet de dire que le test est passé ou échoué).
- Prévoir un **mode d’exécution automatisé** des tests UI (via CI ou commande locale).
- Documenter de manière minimale comment :
  - lancer les tests ;
  - ajouter un nouveau scénario de test UI.

### Hors périmètre
- Refonte complète de l’interface utilisateur existante.
- Mise en production ou déploiement continu (CD) complet.
- Tests de performance ou de charge avancés.
- Analyses UX profondes ou tests utilisateurs réels.

## Exigences fonctionnelles détaillées

1. **Scénarios de tests UI**
   - Au moins **1 scénario de base** décrivant un parcours utilisateur principal.
   - Optionnellement **2 scénarios complémentaires** :
     - 1 scénario d’erreur / cas limite ;
     - 1 scénario d’accessibilité ou de rendu sur petit écran (si pertinent).
   - Chaque scénario doit être décrivable en texte (le « prompt ») et traduisible en étapes techniques pour le framework de test.

2. **Résultats et assertions**
   - Pour chaque étape utilisateur, définir :
     - ce que l’interface affiche ;
     - ce qui doit être interactif (boutons, liens, champs) ;
     - les conditions pour considérer l’étape comme réussie.
   - Les tests doivent produire :
     - un résultat global (succès/échec) ;
     - un résumé des étapes échouées, avec un message lisible par un développeur.

3. **Traçabilité**
   - Les scénarios doivent être **nommés de manière stable** et unique.
   - Les fichiers de tests doivent être **organisés** pour qu’un développeur identifie facilement :
     - la fonctionnalité couverte ;
     - le lien avec le prompt d’origine.

4. **Extensibilité**
   - Il doit être **simple d’ajouter un nouveau scénario** de test UI :
     - en ajoutant un fichier de scénario ou une entrée dans une configuration ;
     - en écrivant le test correspondant de manière guidée (pattern réutilisable).

## Exigences non fonctionnelles

- **Lisibilité du code de test** : respecter les conventions du projet (noms explicites, structure claire, peu de duplication).
- **Stabilité des tests** :
  - éviter les dépendances fragiles au temps (timeouts, `sleep` sans raison) ;
  - privilégier les sélecteurs robustes (data-* ou IDs stables).
- **Performance** :
  - les tests ne doivent pas prendre un temps excessif pour 1–3 scénarios (objectif indicatif : quelques dizaines de secondes maximum).
- **Portabilité** :
  - les tests doivent pouvoir être exécutés sur l’environnement de développement standard du projet (documenter les prérequis).

## Contraintes et hypothèses

- Le langage, les frameworks UI et les frameworks de tests **ne sont pas précisés** dans la demande.
  - Hypothèse : réutiliser la pile technologique déjà présente dans le projet (à confirmer après inspection par l’agent développeur).
- Le projet peut déjà contenir du code existant : l’agent développeur devra :
  - identifier la ou les vues les plus pertinentes à couvrir ;
  - éviter toute régression fonctionnelle sur ces vues.
- La demande est probablement liée à un **pipeline d’agents** (manager / développeur) :
  - ce document doit rester **générique** et focalisé sur les objectifs et critères de succès ;
  - les détails techniques seront complétés par l’agent développeur en fonction du code réel.

## Livrables attendus de l’agent développeur

1. **Implémentation des tests UI**
   - Fichiers de tests pour les scénarios définis.
   - Code éventuellement nécessaire pour rendre l’UI testable (mocks, fixtures, configurations).

2. **Documentation minimale**
   - Section dans la documentation projet (README ou autre) décrivant :
     - comment lancer les tests UI ;
     - comment ajouter un nouveau scénario ;
     - limites connues des tests.

3. **Mise à jour du plan de tests / TODO**
   - Marquer les tâches implémentées comme faites.
   - Documenter les limitations ou améliorations futures recommandées.

## Points à clarifier avec le demandeur

Avant que l’agent développeur ne commence l’implémentation, il est recommandé de poser les questions suivantes :

1. **Portée exacte de « UI Test Prompt »**
   - Sur quelles écrans ou fonctionnalités l’utilisateur veut‑il prioritairement des tests UI ?
   - S’agit‑il de tests de **comportement utilisateur** (parcours complet) ou de tests de **composants isolés** ?

2. **Technologies existantes**
   - Langage et framework UI (par ex. React, Vue, Angular, autre, ou interface non web).
   - Framework de test déjà en place ou préféré (par ex. Playwright, Cypress, Selenium, Testing Library…).

3. **Contraintes de temps d’exécution**
   - Durée maximale acceptable pour la suite de tests UI.
   - Contrainte éventuelle pour l’intégration dans une CI existante.

4. **Critères de succès**
   - Nombre minimal de scénarios couverts pour considérer cette itération comme réussie.
   - Priorités entre robustesse des tests, couverture fonctionnelle et temps d’exécution.

