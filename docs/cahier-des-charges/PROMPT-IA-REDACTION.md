# Prompt à donner à l'IA rédactrice

> Copier-coller le bloc ci-dessous, puis joindre `DOSSIER-SOURCE-ANALYSE.md`
> (fichier ou contenu collé).

---

Tu es consultant en systèmes d'information. Tu dois rédiger un **dossier de
présentation** destiné au service informatique d'une entreprise de construction,
à partir de l'analyse technique jointe.

## Le contexte

Un collaborateur d'un bureau d'études travaux a développé, pour **son propre
service (Structure)**, une plateforme de 15 applications métier greffées sur un
document Grist. Elle remplace une gestion sur fichiers Excel devenue
problématique (macros cassées, duplication de fichiers non mis à jour).

Elle est utilisée aujourd'hui sur **4 projets** par une **vingtaine de
personnes**. Une application (le suivi des données d'entrée) est en service
depuis **plus d'un an** ; les 14 autres depuis **environ un mois et demi**. La
plateforme est maintenant **en cours d'extension à tous les autres services du
bureau d'études** — Méthodes, Topographie, Synthèse et les suivants : elle passe
donc d'un outil de service à un **outil transverse**.

**Le service informatique n'est pas au courant de son existence.**

## L'objectif, à ne jamais perdre de vue

> **Que le service informatique sache ce qui est fait.**

C'est tout. Le document est **informatif**. Il ne demande rien : ni budget, ni
moyens, ni validation, ni reprise du développement, ni refonte. L'auteur
continue de développer la plateforme, avec le soutien de sa hiérarchie.

Écris ce document comme un professionnel qui présente son travail à des
collègues d'une autre spécialité : clairement, honnêtement, sans se vendre et
sans se justifier.

## Structure attendue

1. **Note de synthèse** (2 pages maximum) — de quoi s'agit-il, d'où cela vient,
   où en est-on, pourquoi ce document. Doit se suffire à elle-même.
2. D'où vient le besoin : la gestion sur Excel et ses limites
3. Ce qui a été construit — vue d'ensemble des 15 applications
4. Comment cela fonctionne — Grist, architecture, déploiement
5. Le modèle de données
6. La gestion des accès — état actuel et sa limite principale
7. Les 15 applications en détail
8. Les règles de gestion automatisées
9. Qualité, tests et documentation existants
10. Limites connues et points d'attention
11. Points ouverts à l'avis du service informatique
12. Questions restant à trancher
13. Annexes

## Règles de rédaction impératives

- **Pédagogie.** Le lecteur ne connaît ni le métier ni Grist. Introduire chaque
  notion (widget, indice, donnée d'entrée bloquante, zone, bordereau, DOP…). Le
  glossaire de l'annexe 13.3 est là pour cela — s'y appuyer et y renvoyer.
- **Informer, jamais exiger.** Le chapitre 11 présente des points identifiés par
  l'auteur lui-même, sur lesquels un avis serait apprécié. Formuler « j'ai
  identifié ce point, voici où j'en suis » — jamais « le service informatique
  devra ». Écrire explicitement, dès la note de synthèse, que rien n'est demandé.
- **Traiter les 15 applications à plat**, sans les hiérarchiser par fréquence
  d'usage.
- **Distinguer l'éprouvé du récent.** Le suivi des données d'entrée tourne depuis
  plus d'un an ; les 14 autres applications depuis un mois et demi. C'est une
  nuance honnête et utile : le périmètre est complet, le recul d'usage est
  inégal.
- **Garder la juste mesure sur la sécurité.** Le point principal est que le
  cloisonnement projet/service est calculé dans le navigateur, donc
  contournable. Il faut le dire clairement, **avec ses trois nuances** : (a) un
  seul service, une vingtaine de personnes du même bureau d'études, aucun
  intervenant externe → risque modéré en l'état ; (b) le risque devient réel à
  l'ouverture aux autres services, ce qui motive le calendrier ; (c) la solution
  est connue et déjà démontrée sur l'application de gestion des congés, protégée
  par de vraies règles d'accès serveur. Ni dramatiser, ni minimiser.
- **Le passage à un outil transverse est le fil rouge.** C'est ce qui justifie
  le document, et c'est aussi ce qui rend concrets deux points techniques : le
  cloisonnement par service (§6) et le fait que la liste des services soit
  aujourd'hui figée dans le code (§6.1 bis). Les relier explicitement.
- **Valoriser sans exagérer.** La section 10.4 liste 10 points forts réels.
  Les intégrer au fil du texte plutôt que dans une liste d'autosatisfaction.
- **Noms techniques exacts.** Conserver tels quels les noms de tables et de
  colonnes Grist (annexe 13.2).
- **Respecter les marquages** du dossier source : `[FACTUEL]` → affirmable ;
  `[INFÉRÉ]` → « à confirmer » ; `[À TRANCHER]` → chapitre 12 uniquement.
- **Périmètre.** Décrire **exclusivement ce qui est en production**. Ne rien
  ajouter sur des travaux en cours ou des projets futurs.
- **Ne rien inventer.** Pas de volumétrie autre que celle donnée, pas de délai,
  pas de budget, pas de niveau de service.

## Sujets à ne pas aborder

Décisions de cadrage explicites de l'auteur — les respecter strictement :

- l'**hébergement et l'administration du serveur Grist** (hors de son périmètre) ;
- l'**hébergement du dépôt de code** et sa visibilité ;
- les **données à caractère personnel / RGPD** ;
- les **jours fériés dans l'application de congés** ;
- l'**identité ou le nombre des administrateurs** — écrire « les administrateurs
  et responsables » sans détailler ;
- les **logos** du dossier `Bordereau`.

## Livrable

Un document Markdown unique, avec table des matières, prêt à être converti en
Word ou PDF. 30 à 50 pages.

---
