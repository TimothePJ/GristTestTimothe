# Vue Synthese — affichage par étage (zones à l'intérieur)

Date : 04/11/2026. Widget : Planning Projet, vue Synthese (tableau de tâches + Gantt). Statut : à
relire par l'utilisateur.

## 1. Objectif

Aujourd'hui, la vue Synthese range tout **par zone** : zone → étages de la zone → cycles et tâches.
Pour certains projets, l'utilisateur veut l'inverse : **par étage**, avec **les zones à
l'intérieur** de chaque étage :

```
SS1                        ← un étage, toutes zones confondues
├─ Zone 1 / BAT BC         ← le SS1 de la zone 1 : ses cycles et ses tâches
└─ Zone 2 / BAT B          ← le SS1 de la zone 2 : ses cycles et ses tâches
R+1
├─ Zone 1 / BAT BC
└─ Zone 2 / BAT B
Sans étage                 ← les tâches posées au niveau d'une zone, hors étage
├─ Zone 1 / BAT BC
└─ Zone 2 / BAT B
```

Le choix se fait **projet par projet**.

## 2. Décisions de l'utilisateur (04/11/2026)

| Sujet | Décision |
|---|---|
| Nature du changement | **Affichage seulement**. Les données ne changent pas : la synthèse reste faite **par zone et par étage** (un étage d'une zone garde ses propres cycles, tâches et son lien Structure). |
| Où se règle le mode | **Nouvelle colonne `Mode` (Texte) dans `Projets2`**, créée par l'utilisateur (document de test, puis production). |
| Périmètre | La **vue Synthese** (tableau + Gantt). |

## 3. Données

- **`Projets2.Mode`** (Texte), une valeur par ligne de projet. Lue sans accents, sans casse, sans
  espaces ni ponctuation :
  - `etage` ou `paretage` (« Étage », « Par étage », « ETAGE »…) → **affichage par étage** ;
  - toute autre valeur, vide, ou colonne absente (production tant qu'elle n'est pas créée) →
    **affichage par zone**, exactement celui d'aujourd'hui.
  *(Mon choix : valeurs reconnues et repli silencieux.)*
- Le projet courant du contexte partagé regroupe les lignes `Projets2` d'un même numéro de projet
  (`currentProject.number`, `currentProject.ids`). Si plusieurs lignes portent ce numéro, la
  première valeur `Mode` non vide, par id croissant, fait foi. *(Mon choix.)*
- `Mode` se règle dans Grist **ou depuis le widget** (bouton « Par étage », § 4 bis — ajouté à la
  demande de l'utilisateur le 04/11/2026).
- **Aucune autre colonne** ; `Planning_Projet` n'est pas touchée. Les lignes Synthese gardent
  `Zone` = zone, `Groupe` = nom d'étage, `Etage = true` sur la ligne-étage.

## 4. Lecture et mise à jour du mode

- `Projets2` est déjà lue au démarrage (`fetchProjectBootstrapData`, lignes entières) : la valeur
  `Mode` y est disponible mais aujourd'hui jetée par les fonctions de mise en forme. Elle doit être
  conservée (avec la distinction « colonne absente »), sans nouvelle lecture.
- `Projets2` est déjà surveillée (`bindPlanningDataRefresh`, main.js) mais un changement de
  `Projets2` ne relit pas aujourd'hui la liste des projets. Il faut qu'un `Mode` modifié dans
  Grist (par soi ou par un collègue) s'applique **sans recharger le widget**, dans le délai
  habituel de la surveillance. Cette relecture ne doit ni changer le projet sélectionné, ni
  déclencher d'autre rechargement que ceux qui existent déjà ; elle doit voir la nouvelle valeur
  malgré les caches de lecture (le constructeur vérifie et force la relecture si besoin).
- Le mode s'applique aussi au changement de projet et à l'ouverture de la vue Synthese.
- Quand le mode change, la vue se redessine et **tous les replis sont remis à zéro** (tout
  déplié), comme au changement de projet. *(Mon choix : les clés de repli n'ont pas le même sens
  d'un mode à l'autre.)*

## 4 bis. Bouton « Par étage » (changer le mode depuis le widget)

Demande de l'utilisateur (04/11/2026) : « si j'ai créé la colonne Mode, je dois pouvoir changer le
mode via l'interface ». Choix présentés et validés (« Vas y go ») :

- **Où** : un bouton **« Par étage »** dans le bandeau, juste après « Lien Structure ». Bouton à
  bascule comme « Global » : **enfoncé** quand le projet courant s'affiche par étage.
- **Quand il est visible** : dans la vue Synthese seulement, et seulement si la colonne `Mode`
  existe dans `Projets2` (au moins une ligne du projet courant la porte). Masqué dans la vue
  Global, dans les modes intégrés (`?embedded=…`), et partout tant que la colonne n'existe pas
  (production).
- **Au clic** : écrit `« Étage »` (passage par étage) ou `« Zone »` (retour par zone) dans `Mode`
  de **toutes les lignes `Projets2` du projet courant** (même règle de rattachement qu'à la
  lecture : ids du projet ou même numéro), en **une seule action Grist**. C'est un réglage du
  projet : tout le monde le voit.
- **Application** : dès que Grist a confirmé l'écriture, l'affichage bascule (replis remis à zéro,
  comme tout changement de mode), sans attendre la surveillance ; la liste des projets est ensuite
  relue hors cache pour rester d'accord avec Grist.
- **Droits** : comme toute modification du tableau Synthese — « Editer » activé et service en
  écriture. Sinon le message habituel du tableau (« Activez « Editer »… » / « lecture seule ») et
  rien n'est écrit. En lecture seule, le contexte partagé grise déjà le bouton.
- **Échec** (droits du document sur `Projets2`, réseau…) : un message dans la barre d'état du
  tableau, l'affichage ne change pas. Un second clic pendant l'enregistrement est ignoré.

## 5. Affichage par étage — les lignes

Le mode par zone reste **strictement identique** à aujourd'hui (tests existants inchangés). Le
mode par étage construit, à partir des **mêmes sections par zone**, une autre liste de lignes.

### 5.1 Ligne « étage » (niveau 0)

- Une par nom d'étage, toutes zones confondues : deux étages de deux zones dont le nom a la même
  clé (`floorKeyOf` : « SS1 » = « ss1 », mais « R+1 » ≠ « R-1 ») ne font qu'une ligne.
- **Nom affiché** : celui de la première zone (dans l'ordre des zones) qui a cet étage. *(Mon
  choix.)*
- **Durée / Début / Fin** : récapitulatif de toutes les tâches de cet étage, toutes zones
  (même règle MS Project que les récapitulatifs actuels).
- **Ordre des étages** : par date (Début, puis Fin, puis nom ; non datés à la fin), comme les
  étages dans une zone aujourd'hui. *(Mon choix.)*
- **Aspect** : celui d'un étage aujourd'hui (fond orange `--stt-floor-bg`), dans le tableau
  comme dans le Gantt (crochet d'étage).
- Repliable : la replier cache ses lignes de zone et tout leur contenu.

### 5.2 Ligne « zone dans l'étage » (niveau 1)

- Une par zone qui possède cet étage, dans l'ordre des zones (par nom, comme les sections). Elle
  est affichée même si l'étage n'existe que dans une zone. *(Mon choix : structure constante.)*
- **C'est exactement le conteneur « étage de cette zone » d'aujourd'hui** : mêmes clés de
  conteneur (`zoneKey`, `floorKey`), même repli (`floorCollapseKey(zone, étage)`), même contenu
  (cycles, sous-cycles, tâches) aux mêmes niveaux qu'aujourd'hui (2, 3…), même récapitulatif
  (celui de l'étage de cette zone), même emblème « lien Structure ».
- **Nom affiché** : le nom de la zone. **Aspect** : celui d'une ligne de zone aujourd'hui, en
  retrait d'un niveau ; dans le Gantt, la barre récapitulative d'une zone. *(Mon choix : l'aspect
  suit le sens — orange = étage, style zone = zone.)*
- Son nom ne se modifie pas (c'est la zone).

### 5.3 Bloc « Sans étage » (en bas)

- Une ligne de niveau 0 nommée **« Sans étage »**, placée **après tous les étages**. *(Mon
  choix : les étages sont le contenu principal ; tout en haut, la liste des zones repousserait
  les étages.)*
- En dessous, **toutes les zones du projet** (même vides, comme aujourd'hui où une zone vide
  s'affiche), chacune avec ses tâches hors étage ; « Sans zone » en dernier s'il y a des tâches
  sans zone. Ces lignes de zone ont **le sens de la ligne de zone d'aujourd'hui** (niveau zone),
  mais leur récapitulatif ne compte que leurs tâches hors étage.
- Ce bloc est le point d'entrée pour créer un étage dans une zone (§ 6).
- La ligne « Sans étage » : pas de nom modifiable, pas de menu, repliable.
- **Aspect** : celui d'une ligne « étage » (§ 5.1) — fond orange dans le tableau, crochet d'étage
  dans le Gantt sur le récapitulatif de toutes ces tâches s'il y en a de datées — comme « Sans
  zone » a l'aspect d'une zone dans l'affichage par zone. Aucun style nouveau. *(Mon choix.)*

### 5.4 Filtre de zone du bandeau

Le filtre garde **une seule zone** (comme aujourd'hui) : on voit les étages qui existent dans
cette zone, chacun avec sa seule ligne de zone, et le bloc « Sans étage » réduit à cette zone.
Les récapitulatifs des lignes « étage » ne comptent alors que cette zone. *(Mon choix.)*

Actions de la ligne « étage » pendant un filtre *(mon choix : ne jamais supprimer ni créer dans
une zone qu'on ne voit pas)* :

- **Renommer** agit sur **toutes** les zones du projet qui ont cet étage, filtre ou non (sinon
  l'étage se couperait en deux lignes une fois le filtre retiré) ; le message de réussite dit
  dans combien de zones l'étage a été renommé.
- **« Supprimer l'étage »** et **« Ajouter une zone »** sont grisés, avec un message « Retirez le
  filtre de zone pour … ». La suppression dans la zone visible reste possible par « Supprimer
  l'étage dans cette zone » sur la ligne de zone.

### 5.5 Numéros de ligne et colonne Lien

- Les numéros (colonne de gauche) suivent **l'ordre affiché du mode courant**, projet entier tout
  déplié, comme aujourd'hui. Ils changent donc quand un projet change de mode ; les liens stockés
  (par id dans `Lien`) ne changent pas, seul leur affichage (« 45FD ») suit les nouveaux numéros.
- Tout calcul de numéros (dessin du tableau, fenêtre « Modifier le lien… ») doit utiliser le
  **même mode** que le tableau, sinon les numéros de la colonne Lien ne correspondraient plus aux
  lignes.
- La fenêtre « Modifier le lien… » garde sa liste actuelle (tâches de la zone de la tâche,
  rangées par étage et cycle), avec les numéros du mode courant. *(Mon choix ; une liste « par
  étage » pourra venir plus tard.)*

## 6. Actions (clic droit, saisie, glisser)

| Ligne | Menu | Nom |
|---|---|---|
| **Étage** (5.1) | « Ajouter une zone » → les zones du projet qui n'ont pas cet étage ; « Supprimer l'étage » (toutes ses zones) — tous deux grisés pendant un filtre de zone (§ 5.4) | modifiable : renomme l'étage dans **toutes** ses zones du projet |
| **Zone dans l'étage** (5.2) | « Ajouter une tâche », « Ajouter un cycle » (comme sur un étage aujourd'hui) ; « Supprimer l'étage dans cette zone » | non modifiable |
| **Sans étage** (5.3) | aucun | non modifiable |
| **Zone du bloc Sans étage** | comme une zone aujourd'hui : « Ajouter une tâche » (hors étage), « Ajouter un étage » (dans cette zone) | non modifiable |
| Cycle, sous-cycle, tâche | inchangés | inchangés |

Détails :

- **Ajouter un étage** (zone du bloc Sans étage) : comme aujourd'hui (modèle de 26 lignes, saisie
  du nom ouverte ensuite), mais le nom proposé (« Nouvel étage », « Nouvel étage 2 »…) est libre
  **dans tout le projet**, pour que le nouvel étage arrive seul sur sa ligne « étage ». La saisie
  du nom s'ouvre sur cette ligne « étage ».
- **Ajouter une zone** (ligne étage) : crée dans la zone choisie un étage **du même nom**, d'après
  le modèle (26 lignes, comme « Ajouter un étage »), puis déplie la ligne étage et la nouvelle
  ligne de zone. Grisé avec un message quand toutes les zones ont déjà cet étage, ou quand les
  colonnes du modèle manquent (même règle qu'« Ajouter un étage »). La présentation du choix de
  la zone (sous-menu, entrées « Ajouter dans « Zone 3 / BAT C » » après un séparateur…) est
  laissée au constructeur, tant que la liste reste lisible avec une dizaine de zones.
- **Renommer un étage** (ligne étage) : le nouveau nom est vérifié **dans chacune de ses zones**
  (pas vide, au moins une lettre ou un chiffre, pas déjà pris par un autre étage de cette zone) ;
  refus avec le nom de la zone en conflit. Accepté : une seule écriture Grist renomme les
  lignes-étages, le `Groupe` des cycles et tâches et les noms « NIV / GO <ancien> » dans toutes
  les zones (règles actuelles de renommage, appliquées zone par zone). Si le nouveau nom existe
  déjà dans **d'autres** zones (où l'étage renommé n'est pas), les deux lignes « étage » se
  rejoignent : c'est voulu. Les replis suivent le nouveau nom.
- **Supprimer l'étage** (ligne étage) : confirmation « Supprimer l'étage « SS1 » dans 2 zones et
  ses 52 tâches ? » (formulation au choix du constructeur, avec le nombre de zones et de
  tâches) ; une seule écriture ; les liens des tâches restantes vers les tâches supprimées sont
  traités comme à la suppression d'un étage aujourd'hui.
- **Supprimer l'étage dans cette zone** (ligne zone dans l'étage) : exactement la suppression
  d'étage d'aujourd'hui, pour cette zone ; la question nomme l'étage et la zone.
- **Glisser-déposer** :
  - sur une **ligne zone dans l'étage** : « Déplacer à la fin de « SS1 » (« Zone 1 / BAT BC ») »,
    pour une tâche comme pour un cycle (cycle : seulement dans son propre étage de sa propre
    zone, règle actuelle) ;
  - sur une **zone du bloc Sans étage** : niveau zone de cette zone (comme aujourd'hui) ;
  - sur une **ligne étage** ou **Sans étage** : pas de dépôt (la légende dit de viser une zone) ;
  - sur une tâche, un cycle : inchangé (avant / après, dans le conteneur de la ligne visée) ;
  - les libellés de dépôt citent l'étage **et** la zone dès qu'il peut y avoir doute.
- Après un ajout ou un déplacement, la ligne étage qui reçoit est dépliée en plus des replis
  actuels.

## 7. Ce qui ne change pas

- Le mode par zone, ligne pour ligne (tests existants verts sans modification).
- Toutes les règles d'écriture : liens et cascade, ordre libre et chaînage, cycles imbriqués,
  escalier / parallèle, tâche contrôlée, saisies de dates et durées. Elles travaillent sur les
  sections par zone ou par id, pas sur l'affichage.
- La fenêtre « Lien Structure » (étages par zone face aux coffrages de la zone).
- La **vue Global** (zone → niveau lié), le planning Structure, les modes intégrés
  (`?embedded=planning-sync`), les autres widgets. *(Mon choix : la Global pourra suivre plus
  tard si besoin.)*

## 8. Non-objectifs

- Une synthèse commune à plusieurs zones (un seul jeu de cycles pour tout un étage).
- Écrire dans `Projets2` autre chose que `Mode` (et seulement via le bouton du § 4 bis).
- Changer le sens de `Groupe`, `Zone` ou `Etage`, ou ajouter une colonne à `Planning_Projet`.

## 9. Contraintes

- Modules purs testables sous Node (`Planning Projet/tests/*.test.mjs`), comme le reste de la vue ;
  le mode par étage est une **option** des constructions de lignes et de numéros, le mode par zone
  restant celui par défaut (la Global et la fenêtre Lien Structure appellent ces fonctions sans
  option et ne doivent rien voir changer).
- Ne pas réutiliser un type de ligne existant avec un autre sens sans le dire partout où il est
  lu (menus, dépôt, repli, Gantt, emblème Structure) : la cartographie du 04/11 a listé ces
  endroits (`resolveDropTarget`, `resolveDropSlot`, `resolveCycleDropSlot`, `applyFloorLinks`,
  géométrie du Gantt, `SUMMARY_KINDS`, CSS, menus).
- Le constructeur ne fait aucun commit (l'utilisateur committe) et garde les fins de ligne des
  fichiers qu'il modifie.
- Tests : les nouveaux comportements (lignes, numéros, menus, dépôts, renommage / suppression /
  ajout de zone sur plusieurs zones, lecture du mode, mise à jour sur signal `Projets2`) sont
  couverts par des tests.

## 10. Laissé au constructeur

- Noms internes (type de la ligne étage, champs d'aspect, options), découpage en fonctions.
- Présentation du choix de zone dans « Ajouter une zone ».
- Formulation exacte des messages et des questions de confirmation (en français, dans le style
  actuel).
- Comment conserver `Mode` lors de la lecture de `Projets2` et le transmettre au contrôleur
  Synthese.

## 11. Compléments du 04/11/2026 (après livraison, validés par l'utilisateur : « Oui go par sous agents »)

### 11.1 Faits directement
- Bouton « Par étage » : il ne rétrécit plus quand le bandeau est plein (son texte passait sur deux
  lignes) — texte sur une ligne, centré.
- En affichage par étage, tailles de texte inversées : la ligne étage prend celle d'une zone de
  l'affichage par zone (14 px), les zones (sous un étage ou dans « Sans étage ») celle d'un étage.

### 11.2 « Ajouter un étage… » avec choix des zones (affichage par étage)
- Entrée **« Ajouter un étage… »** au clic droit sur une ligne étage, sur la ligne « Sans étage » et
  sur les zones du bloc « Sans étage » (elle y remplace l'ajout direct). L'affichage par zone ne
  change pas (« Ajouter un étage » sur une zone, comme aujourd'hui).
- Elle ouvre une fenêtre : **nom de l'étage** (champ vide ; « Nouvel étage », ou « Nouvel étage 2 »… selon
  les noms pris dans le projet, n'y figure qu'en indication grisée, remplacée dès qu'on tape — demande
  de l'utilisateur ; « Créer » attend un nom tapé) et **les zones du projet à cocher** (pas « Sans zone ») ; aucune cochée,
  sauf la zone cliquée quand on vient d'une zone. Une zone qui a déjà un étage de ce nom est grisée
  avec « déjà présent », mise à jour pendant la saisie du nom. Un nom déjà utilisé dans d'autres
  zones est accepté : l'étage les rejoint (même ligne étage).
- **« Créer »** (au moins une zone cochée, nom non vide) : le modèle (26 lignes) dans chaque zone
  cochée, **tout ou rien** (si une partie échoue, rien n'est gardé).
- Mêmes règles que les autres actions d'étage : « Editer » + service en écriture ; refusé avec un
  filtre de zone (« Retirez le filtre de zone pour ajouter un étage. »).

### 11.3 Suppression d'une zone protégée (fenêtre « Modifier Zone », tous services)
- Avant la confirmation, le widget lit les lignes du projet **dans tous les services** des trois
  tables qui portent les zones (`Planning_Projet`, `References2`, `ListePlan_NDC_COF`).
- Si un **autre service** (valeur `Service` reconnue et différente du service courant) y a des
  **données** dans cette zone, la suppression est **refusée** avec un message dans la fenêtre
  (« Impossible de supprimer la zone « Zone 2 » : le service Structure y a des données (12 lignes). »),
  rien n'est écrit. Même règle en Structure, Synthese et Topographie (même fenêtre).
- Ne comptent pas comme données : les lignes vides qui ne font que garder une zone dans un service
  (ligne de `Planning_Projet` sans tâche, sans N° et sans type de document) — sinon deux services
  gardant chacun la zone vide se bloqueraient l'un l'autre. Conséquence acceptée : après la
  suppression, la zone peut rester listée tant qu'un autre service la garde vide.
- Lecture impossible → suppression refusée (message), par prudence.
- Le renommage de zone ne change pas.

### 11.4 Créer des zones depuis la fenêtre « Ajouter un étage… » (demande du 04/11/2026)
- Sous la liste des zones : un champ « Nouvelle zone » et un bouton « Ajouter la zone » (Entrée dans
  le champ = ce bouton, jamais « Créer »). La zone ajoutée apparaît dans la liste, **cochée**, avec la
  mention « nouvelle » ; décochée, elle ne sera pas créée.
- Nom déjà pris par une zone du projet (tous services, mêmes règles de comparaison que les zones de
  la vue) → pas de doublon : cette zone est cochée et la fenêtre le dit. Nom vide, « Sans zone », sans
  lettre ni chiffre ou trop long → refusé avec un message.
- « Créer » (possible avec seulement des nouvelles zones cochées) : dans la même écriture, tout ou
  rien, l'étage modèle dans chaque zone cochée et, pour chaque nouvelle zone, la ligne vide qui garde
  une zone (comme « Ajouter une zone » du bandeau) : la zone reste si l'étage est supprimé plus tard.
  *(Mes choix.)*

### 11.5 « Modifier Zone » liste toutes les zones du projet (demande du 04/11/2026)
- La liste de la fenêtre « Modifier Zone » montre **toutes les zones du projet**, celles créées depuis
  un autre service comprises (même liste que « Zone » du bandeau, sans « Sans zone »).
- **Renommer** suit la règle de la suppression (choix de l'utilisateur, « Bloquer ») : refusé tant
  qu'un autre service a des **données** dans la zone, avec un message qui nomme ce service ; lecture
  impossible → refusé. Un nouveau nom déjà pris par une zone du projet (tous services) est refusé.
- Le widget n'écrit toujours que les lignes du service courant. D'où deux cas expliqués à
  l'utilisateur au lieu d'un faux « fait » *(mes choix)* :
  - la zone n'a **aucune ligne dans ce service** (elle n'existe que par la ligne vide d'un autre
    service) → rien n'est écrit, message : renommez / supprimez-la depuis ce service-là ;
  - réussite, mais un autre service garde la zone **vide** (sa ligne vide) → la fenêtre reste ouverte
    et le dit (l'ancien nom reste listé tant que ce service la garde).
