# Cahier des charges – À préciser

## 1. Contexte et objectif

La demande utilisateur fournie est tronquée : `Cr`.  
Il est impossible de déduire de manière fiable le besoin fonctionnel précis (ex. création d’un module, d’une fonctionnalité, d’une interface, etc.).

**Objectif de ce document** :  
- Structurer les informations disponibles.  
- Lister clairement les hypothèses possibles.  
- Identifier les questions à poser au demandeur.  
- Préparer le cadre de travail pour l’agent développeur, en attendant la clarification.

## 2. Périmètre fonctionnel (à confirmer)

À ce stade, aucun périmètre fonctionnel fiable ne peut être défini.  
Les éléments ci-dessous sont des pistes **indicatives** uniquement, à ne pas implémenter tant que le demandeur n’a pas confirmé :

- Hypothèse A : « Créer » une nouvelle fonctionnalité liée au projet existant.
- Hypothèse B : « Créer » un nouvel outil ou script autonome.
- Hypothèse C : « Créer » une amélioration d’interface ou un composant spécifique.

Le/La Product Owner doit sélectionner ou préciser l’hypothèse correcte, ou fournir une nouvelle description complète.

## 3. Contraintes et principes généraux

En attendant la clarification, les contraintes suivantes sont fixées pour le futur développement :

- Ne pas implémenter de code tant que le besoin fonctionnel n’est pas clarifié et validé.
- Respecter l’architecture et les conventions existantes du projet (naming, structure des dossiers, style de code).
- Rester minimaliste : limiter l’implémentation au périmètre validé, éviter le sur-développement.
- Documenter les décisions techniques majeures dans la PR ou dans un fichier de documentation adapté.

## 4. Questions à adresser au demandeur

À transmettre au demandeur avant toute implémentation :

1. Quel est l’intitulé complet de la demande initiale (la phrase après `Cr` complète) ?
2. Quel est l’objectif métier concret de cette demande ?  
   - Quels problèmes veut-on résoudre ?  
   - Quels utilisateurs sont concernés ?
3. Quel est le périmètre minimal à livrer (MVP) ?  
   - Quelles fonctionnalités sont indispensables ?  
   - Quelles fonctionnalités sont optionnelles / futures ?
4. Y a-t-il des contraintes techniques spécifiques ?  
   - Langage, framework, bibliothèques imposées ou interdites ?  
   - Contraintes de performance, sécurité, compatibilité ?
5. Y a-t-il des contraintes UX/UI ou CLI particulières (format d’entrée, format de sortie, messages d’erreur, etc.) ?
6. Y a-t-il des délais ou jalons précis (deadlines, démonstration, intégration avec d’autres équipes) ?

## 5. Livrables attendus une fois la demande clarifiée

Après réception des réponses, le périmètre devra être mis à jour, mais on peut d’ores et déjà prévoir les livrables suivants :

- Code source conforme aux conventions du projet.
- Tests automatisés (unitaires et éventuellement d’intégration) couvrant le périmètre défini.
- Documentation minimale :
  - README ou section dédiée décrivant la fonctionnalité, comment l’utiliser et comment la tester.
  - Description des limitations connues et des pistes d’évolution.

## 6. Risques identifiés

- **Risque majeur : incompréhension du besoin**  
  - Impact : implémentation de fonctionnalités inutiles ou non conformes.  
  - Mitigation : ne pas commencer le développement avant clarification explicite.

- **Risque de dérive de périmètre**  
  - Impact : délais allongés, complexité accrue.  
  - Mitigation : acter un périmètre MVP clair, toute extension passe par une nouvelle demande.

## 7. Prochaine étape

- Attendre la clarification du demandeur.  
- Mettre à jour ce cahier des charges avec :
  - Une description fonctionnelle détaillée.  
  - Des cas d’usage concrets / user stories.  
  - Des critères d’acceptation précis.

