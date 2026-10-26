# Spec — Lissage des tâches dans la vue « Graphique » de `planning-synchro`

Date : 2026-10-23
Branche : `feature/LissageStructure`
Statut : validée par l'utilisateur le 2026-10-23 (relue par trois relecteurs indépendants).
Mise à jour 2026-10-26 (demande de l'utilisateur : « décaler dans les mois d'avant même s'il
n'y a rien » et « un maximum par mois et par type ») : **mois de départ** (§4.8) et
**maximums d'un mois précis** (§4.1, §5.1, §6.2).

## 1. Objectif

La vue **Graphique** de `planning-synchro` (sélecteur « Planning / Graphique » au-dessus du
pane haut, `top/planningChart.js`) trace, mois par mois, le **nombre de tâches à réaliser**
(une tâche = un document du planning, compté à sa date de diffusion) avec une courbe par type
de document (Coffrage, Armature, NDC, Coupes, Démolition, Autres) et une courbe Total.

Elle montre des **pics** : 8 tâches en avril, 0 en mars. L'équipe est alors débordée un mois
et désœuvrée le précédent.

On ajoute un **lissage** : l'utilisateur fixe un **nombre maximum de tâches par mois**, en
général et/ou par type de document, et le widget calcule un **planning lissé** dans lequel
les tâches en trop sont **réalisées plus tôt**, jamais plus tard. On ne crée donc **aucun
retard** : une tâche lissée est toujours en avance ou à l'heure par rapport à sa date réelle.

Le graphique affiche au choix les données **non lissées**, **lissées**, ou **les deux**
superposées. Un clic sur un mois du graphique ouvre la **liste des tâches de ce mois**.

Le lissage est un **planning cible** : il ne modifie **aucune date** du planning réel
(`Planning_Projet`). Seuls les maximums sont enregistrés (dans `Projets2.Lissage`) ; le lissé
est recalculé à chaque affichage.

## 2. Décisions

| Sujet | Décision | Origine |
|---|---|---|
| Où | Vue **Graphique** de `planning-synchro` uniquement. | utilisateur |
| Maximums | Un **maximum général** (tous types) et/ou un **maximum par type** de document présent dans le projet. Champ vide = pas de maximum. | utilisateur |
| Sens | Les tâches ne font qu'**avancer** (plus tôt). Jamais plus tard. | utilisateur |
| Cascade | Exemple de référence (max 4) : mars 2, avril 8 → février 2 (les deux de mars), mars 4 (les 4 premières d'avril), avril 4 (les 4 dernières). | utilisateur |
| Tâches réalisées | Ne bougent pas, mais comptent dans leur mois. | utilisateur (supposition confirmée) |
| Mois passés | Rien n'entre dans un mois passé, rien n'en sort. | utilisateur (supposition confirmée) |
| Armature / coffrage | Une armature ne passe **jamais avant la diffusion de son coffrage**. | utilisateur (supposition confirmée) |
| Armature qui doit avancer avant son coffrage | On **avance aussi le coffrage** (§4.6). | utilisateur |
| Plus de place | La tâche reste où elle est ; la fenêtre le signale. | utilisateur (supposition confirmée) |
| Planning réel | **Jamais modifié.** Le lissé est une version à côté. | utilisateur (supposition confirmée) |
| Stockage | Nouvelle colonne **texte `Lissage`** de `Projets2`, créée par l'utilisateur (document de test, puis prod). Partagée par toute l'équipe. | utilisateur |
| Clic sur un mois | Fenêtre listant les tâches du mois, limitée aux types cochés, **groupées par type** quand plusieurs types sont cochés. | utilisateur |
| Affichage | **Non lissé / Lissé / Les deux.** | utilisateur |
| Recalcul | Le lissé n'est **jamais stocké** : il est recalculé à chaque affichage à partir des maximums enregistrés et du planning courant. | mon choix (annoncé, non contesté) |
| Date d'une tâche avancée | Même jour du mois, N mois plus tôt (12 avril → 12 mars), voir §4.5. | mon choix (annoncé, non contesté) |
| Liste en « Les deux » | Montre aussi les tâches arrivées dans le mois et celles parties plus tôt. | mon choix (annoncé, non contesté) |
| Où va un dépassement impossible | Il **reste dans le mois d'origine** de la tâche : une tâche n'est avancée que vers un mois où elle tient sous les maximums. | mon choix |
| Datation des tâches dans le graphique | Le graphique (et le lissage) datent une tâche **comme la barre dessinée** dans le planning (dates recalculées, comme Planning Projet), et non plus sur les colonnes brutes. Voir §3.2. | mon choix |
| Choix d'affichage | Mémorisé par navigateur (localStorage), pas dans Grist. | mon choix |
| Git | **Aucun commit, aucun push.** L'utilisateur commite lui-même. | règle permanente |

## 3. Vocabulaire et données d'entrée

### 3.1 Tâche

Une **tâche** est une ligne `Planning_Projet` du projet sélectionné et du service courant
(la couche partagée filtre déjà les lignes par projet et par service, politique
`REST_PROJECT_SERVICE` de `shared/service-context-core.js`) qui porte une **échéance**.

Chaque tâche a :

- un **type** : `COFFRAGE`, `ARMATURES`, `NDC`, `COUPES`, `DEMOLITION` ou `AUTRES` (tout type
  personnalisé). Ce sont exactement les six séries du graphique actuel ;
- une **échéance** : la date de fin de sa phase principale (date de diffusion) ;
- un **mois** : le mois de son échéance ;
- un état **réalisé** (oui / non) ;
- pour une armature, son **coffrage** : la ou les lignes `COFFRAGE` de même Zone et même
  Groupe (comparaison en minuscules, comme `groupCompositeKey` du constructeur de planning).

### 3.2 Échéance et réalisé : comme la barre dessinée (correction du graphique)

Aujourd'hui, le graphique date une tâche avec `buildRowPhases` (`top/phases.js`), qui lit les
**colonnes brutes** `Date_limite` / `Diff_coffrage` / `Diff_armature`. Les barres du planning,
elles, viennent du constructeur vendorisé (`top/vendor/planningProjetBuilder.js`), qui
**recalcule** les dates comme Planning Projet :

- coffrage lié à MS Project : fin = `Demarrages_travaux` − `Duree_3` semaines ;
- coffrage de groupe non lié : fin = plus petite `Diff_coffrage` des armatures du groupe ;
- début des coffrages, NDC, coupes, démolitions, types personnalisés :
  fin − `Duree_1` semaines.

Résultat : une même tâche peut être comptée dans le graphique un autre mois que celui où sa
barre se termine. Le graphique compte aussi le réalisé d'après la colonne `Realise` stockée,
alors que la barre le recalcule (indice, indice cible de `Projets2.Avancement`,
`Date_Cloture`).

**Décision :** le graphique et le lissage prennent leurs tâches **dans la sortie du
constructeur vendorisé**, c'est-à-dire exactement ce que dessine le planning :

- échéance = date de fin de la barre principale (dates recalculées) ;
- type = celui de la barre (classe `phase-coffrage`, `phase-armature`, `phase-ndc`,
  `phase-coupes`, `phase-demolition`, `phase-generic` → `AUTRES`) ;
- réalisé = état réalisé de la barre (≥ 100 %).

Une ligne que le planning ne dessine pas (pas de type, dates manquantes) n'est pas une tâche,
comme aujourd'hui.

Effet visible : pour les lignes dont les colonnes brutes ne suivent pas les dates recalculées,
les courbes **non lissées** changent légèrement par rapport à aujourd'hui ; elles collent
désormais au planning.

### 3.3 Mois courant, tâches figées, tâches mobiles

- **Mois courant** : le mois de la date du jour (horloge du navigateur).
- **Mois de départ** : le premier mois où une tâche peut être placée ; le mois courant par
  défaut, ou un mois passé choisi par l'utilisateur (§4.8).
- Une tâche est **figée** si elle est réalisée, ou si son échéance tombe dans un **mois passé**
  (tâche en retard). Une tâche figée garde son mois et compte dans ce mois, quel que soit le
  mois de départ.
- Les autres tâches, **à venir**, sont **mobiles**.

## 4. La règle de lissage

### 4.1 Les maximums

- **Maximum général** : nombre maximum de tâches (tous types confondus) par mois.
- **Maximum par type** : un champ par type présent dans le projet (les types qui ont au moins
  une tâche, comme les cases à cocher du graphique).
- Valeurs : entiers ≥ 1. Champ vide = pas de maximum pour ce type (ou pas de maximum général).
- Quand les deux sont remplis, chaque mois doit respecter **les deux** : au plus N tâches du
  type, et au plus M tâches en tout.
- Les maximums valent **par mois**, quel que soit le regroupement choisi dans le graphique
  (mois ou semaine).
- **Maximums d'un mois précis** (mise à jour du 2026-10-26) : pour un mois donné, un maximum
  général et/ou des maximums par type qui **remplacent**, valeur par valeur, ceux de tous les
  mois (ex. 6 armatures en mars 2027, 2 en août 2027, 4 les autres mois). Une valeur laissée
  vide pour ce mois reprend celle de tous les mois. Un mois plus bas que les autres en fait
  partir des tâches ; un mois plus haut en garde davantage et en reçoit davantage.

### 4.2 Règles strictes (jamais enfreintes)

1. **Jamais plus tard** : le mois lissé d'une tâche est son mois d'origine ou un mois
   antérieur.
2. **Jamais avant le mois de départ** : une tâche n'est jamais placée avant le mois de départ.
   Quand le départ est le mois courant (par défaut), elle n'est pas non plus placée à une date
   antérieure à aujourd'hui (§4.5). Avec un départ passé, les mois passés à partir de lui sont
   des cibles, même vides (§4.8).
3. **Les tâches figées ne bougent pas** (réalisées, ou échéance dans un mois passé).
4. **Armature après son coffrage** : l'échéance lissée d'une armature n'est jamais antérieure
   à l'échéance lissée de son coffrage non réalisé (§4.6 : le coffrage est avancé avec elle).
5. **Une tâche n'est avancée que là où elle tient** : après lissage, un mois qui reçoit une
   tâche respecte le maximum de **son type** et le **maximum général** (les seules séries que
   cette tâche fait monter), tels qu'ils valent pour **ce mois** (§4.1). Un mois en dépassement sur une autre série peut donc la recevoir
   (exemple : un mois en cours à 3 armatures pour un maximum Armature de 2 peut recevoir des
   NDC). Une tâche qui ne trouve aucune place reste dans son mois d'origine.
6. **Déterministe** : mêmes tâches, mêmes maximums, même mois courant → même résultat.

### 4.3 Préférences (par ordre de priorité)

1. Laisser **le moins de tâches possible au-dessus des maximums** (on compte les tâches en
   trop, pas les mois : un pic qu'on ne peut pas résorber entièrement est quand même soulagé).
2. Quand c'est impossible, le dépassement reste dans le mois **le plus tardif** possible (son
   mois d'origine), plutôt que d'être repoussé vers le mois en cours ; à place libre égale, elle
   va au **premier** mois débordant (exemple C).
3. Avancer **le moins possible** : chaque tâche va dans le mois le plus tardif où elle tient.
4. **L'ordre chronologique est conservé** dans la file des tâches soumises au maximum qui
   déborde : tous types confondus pour le maximum général (c'est l'exemple de l'utilisateur :
   les deux tâches de mars descendent en février pour laisser mars aux quatre premières
   d'avril), à l'intérieur du type pour un maximum par type. Ce sont donc les tâches les plus
   tôt d'un mois trop chargé qui avancent, et une tâche n'en double jamais une autre de sa file.
   Seule la règle 4 (armature / coffrage) peut y faire exception.
5. À échéance égale, ordre par N° (`ID2`, numérique), puis par identifiant de ligne.

Note de mise en œuvre (2026-10-23) : la préférence 1 est **visée, pas garantie**. Le calcul se
fait en une passe, sans recherche exhaustive. Dans de rares cas (environ 4 pour 1 000 sur de
petits jeux tirés au hasard), il laisse un dépassement qu'un déplacement en chaîne aurait
résolu : par exemple, avancer une tâche d'un autre type pour libérer de la place sous le
maximum général. Ce dépassement est signalé dans l'aperçu, et aucune règle stricte n'est
jamais enfreinte.

### 4.4 Exemples (tests de référence)

Mois courant : janvier, sauf mention.

**A. L'exemple de l'utilisateur.** Maximum général 4. Mars : M1, M2. Avril : A1 … A8 (par
date).
Résultat : février = M1, M2 ; mars = A1, A2, A3, A4 ; avril = A5, A6, A7, A8.

**B. Pas de place avant.** Mois courant : octobre. Maximum 4. Octobre 4, novembre 4,
décembre 8.
Résultat : rien ne bouge ; décembre reste à 8 et le dépassement est signalé (règle 5,
préférence 2). En particulier, on **n'avance pas** les tâches de novembre en octobre pour faire
de la place à décembre : cela déplacerait le dépassement vers le mois en cours sans rien
résoudre.

**C. Place partielle.** Mois courant : octobre. Maximum 4. Octobre 2, novembre 6,
décembre 6.
Résultat : octobre = 2 d'octobre + les 2 premières de novembre ; novembre = les 4 dernières
de novembre ; décembre = 6 (dépassement de 2 signalé). La place libre d'octobre va au premier
mois débordant (novembre), pas au dernier.

**D. Maximum par type.** Maximum Armature 2, pas de maximum Coffrage. Avril : 4 armatures
(leurs coffrages sont diffusés en février) et 3 coffrages d'autres groupes ; mars : rien.
Résultat : les 2 armatures les plus tôt d'avril passent en mars ; les coffrages ne bougent
pas.

**E. Maximum général et par type ensemble.** Maximum général 4, maximum Coffrage 2. Avril :
3 coffrages, et 3 armatures d'autres groupes dont les coffrages sont diffusés en février ;
mars : rien. Le coffrage le plus tôt avance (règle du type) ; il reste 5 tâches en avril pour
un maximum général de 4 : la tâche la plus tôt restante avance aussi, quel que soit son type.
Avril finit à 4 tâches dont 2 coffrages au plus ; mars en reçoit 2.

**F. Tâches réalisées.** Maximum 4. Avril : 3 tâches réalisées + 3 non réalisées. Les
réalisées restent en avril et comptent : 2 tâches non réalisées (les plus tôt) avancent.

**G. Mois en cours.** Mois courant : avril. Maximum 4. Avril : 6 tâches. Aucune ne peut
avancer (mars est passé) : dépassement de 2 signalé en avril.

**H. Ordre conservé.** Maximum général 2 (types quelconques, armatures sans coffrage à
entraîner). Février : F1 ; mars : M1, M2 ; avril : A1, A2, A3. A1 doit avancer. La place libre
la plus tardive est en février. M1 descend en février et A1 prend sa place en mars : février =
F1, M1 ; mars = M2, A1 ; avril = A2, A3. Aucune tâche ne double une tâche plus tôt de la file.
Si un maximum **par type** est aussi défini (par exemple maximum général 2 et maximum
Armature 5, M1 et M2 étant des NDC et A1 … A3 des armatures), les files sont par type : A1 va
directement en février et les NDC ne bougent pas. Règle de mise en œuvre : file unique quand
seul le maximum général est défini, file par type dès qu'un maximum par type existe.

**I. Coffrage entraîné.** Maximum Armature 2, pas de maximum Coffrage. Avril : coffrage C
(02/04) et armatures A1 … A4 (du 10 au 25/04) du même groupe ; mars : rien. A1 et A2 doivent
avancer en mars, avant C : C avance aussi.
Résultat : mars = C (02/03), A1, A2 ; avril = A3, A4. C est marqué « avancé pour libérer
l'armature N° A1 ».

**J. Coffrage sans place.** Mois courant : mars. Maximum Armature 2, maximum Coffrage 1. Mars :
un coffrage d'un autre groupe ; avril : coffrage C et armatures A1 … A4 de son groupe. A1 et A2
devraient passer en mars, mais C ne tient pas en mars (maximum Coffrage atteint) et ne peut
pas aller plus tôt (février est passé). Résultat : rien ne bouge ; avril = 4 armatures,
dépassement de 2 signalé avec la raison « coffrage sans place ».

### 4.5 Date lissée d'une tâche avancée

- Avancée de N mois, la tâche garde **son jour du mois** : 12 avril → 12 mars. Un jour qui
  n'existe pas dans le mois d'arrivée prend le dernier jour du mois (31 mai → 30 avril).
- Si le mois d'arrivée est le mois courant, que le lissage part du mois courant (par défaut)
  et que cette date est déjà passée, la date lissée est **aujourd'hui**. Avec un départ passé
  (§4.8), les dates passées sont permises et le jour est gardé.
- Une armature avancée dans le même mois que son coffrage ne prend jamais une date antérieure
  à l'échéance lissée de ce coffrage (elle prend alors cette date).
- Une tâche qui n'est pas avancée garde sa date d'origine.

La date lissée sert au regroupement par semaine du graphique et à la liste des tâches ; les
maximums, eux, ne raisonnent qu'en mois.

### 4.6 Armature qui doit avancer avant son coffrage : le coffrage avance aussi

Décision de l'utilisateur : quand une armature doit avancer à une date antérieure à
l'échéance (lissée) de son coffrage, **le coffrage est avancé avec elle**. C'est le cas
courant : la diffusion du coffrage d'un groupe est la plus tôt des dates de début de ses
armatures, donc souvent le même mois qu'elles.

- Le coffrage avancé va dans le mois **le plus tardif** qui est au plus celui de l'armature et
  où il tient sous ses propres maximums (maximum Coffrage et maximum général), dans le respect
  des règles strictes (pas de mois passé, pas avant aujourd'hui). Sa date lissée n'est jamais
  postérieure à celle de l'armature.
- La règle compare les **échéances** : l'armature peut être due dès le jour de diffusion de
  son coffrage (lecture littérale de « une armature ne passe jamais avant la diffusion de son
  coffrage »). Son temps de production propre peut donc se trouver réduit dans le lissé ; on ne
  raisonne qu'en échéances, comme le graphique. Mon choix.
- Elle s'applique quel que soit le mois du coffrage (même mois, ou mois intermédiaire : une
  armature d'avril qui doit aller en février entraîne un coffrage de mars).
- Si le groupe compte plusieurs armatures, le coffrage doit précéder **la plus tôt** des
  armatures lissées du groupe ; s'il y a plusieurs coffrages dans le groupe, la règle vaut pour
  chacun.
- Si le coffrage ne peut pas avancer assez (aucune place jusqu'au mois courant), l'armature
  n'avance que jusqu'où son coffrage peut aller ; au-delà, elle reste et le dépassement est
  signalé avec la raison « coffrage sans place ».
- Un coffrage **réalisé** ne contraint plus ses armatures (il est déjà diffusé) et ne bouge
  jamais.
- Un coffrage **en retard** (non réalisé, échéance dans un mois passé) est figé : il ne bouge
  pas mais contraint toujours ses armatures. Avec un départ passé (§4.8), une armature ne
  passe donc jamais avant lui ; si c'est la seule place, elle reste (« coffrage sans place »).
- Une armature dont le groupe n'a aucun coffrage n'a pas de contrainte de ce type.
- Un coffrage avancé pour cette raison est marqué « avancé pour libérer l'armature N° … » dans
  l'aperçu et dans la liste des tâches du mois. Il compte comme une tâche avancée.

### 4.7 Ce que le lissage rapporte

Pour chaque tâche : mois et date d'origine, mois et date lissés, nombre de mois d'avance,
indicateurs « avancée » et « figée », et pour un coffrage entraîné le N° de l'armature qui
l'a entraîné. Le dépassement n'est **pas** porté par une tâche (marquer toutes les tâches d'un
« Total 6 / 4 » ne dirait rien, et choisir lesquelles serait arbitraire) : il est rapporté au
niveau **mois × série**.

Pour l'ensemble : nombre de tâches avancées, et la liste des **dépassements restants** par
mois et par série (type ou général) : « avril 2027 — Armature : 3 / 2 », avec la raison
dominante :

- `mois en cours` : impossible d'avancer avant le mois courant (lissage parti du mois
  courant) ;
- `tâches réalisées` : les tâches figées dépassent déjà le maximum ;
- `tâches réalisées ou en retard` : un mois passé (départ passé, §4.8) dont les tâches figées
  dépassent déjà le maximum ; il ne reçoit rien ;
- `plus de place avant` : tous les mois antérieurs, jusqu'au mois de départ, sont pleins ;
- `coffrage sans place` : armatures retenues parce que leur coffrage ne peut pas avancer assez
  (§4.6).

Les mois d'avant le mois de départ ne sont ni lissés ni signalés. Chaque dépassement est
compté avec le maximum de **son** mois (§4.1).

### 4.8 Mois de départ (« Lisser à partir de »)

Mise à jour du 2026-10-26. Demande de l'utilisateur : « ça doit pouvoir effectuer des
décalages dans les mois d'avant même s'il n'y a rien ».

- Par défaut, le lissage part du **mois courant** : comportement d'origine (§4.2, règle 2).
- L'utilisateur peut choisir un **mois passé**. Les mois passés à partir de lui deviennent des
  **cibles**, vides ou non : les tâches **à venir** en trop peuvent y être avancées. Ils ne sont
  jamais sources : leurs tâches (réalisées ou en retard) restent figées et comptent.
- Choix tranché à l'essai sur les données réelles d'ERA QUAI D'ORSAY (export du 2026-10-26) :
  si les tâches en retard devenaient mobiles, elles prendraient d'abord les places libres des
  mois passés (le placement va du plus tôt au plus tard) et rien ne se libérerait pour les
  mois à venir. Les garder figées fait passer les tâches en trop à partir d'octobre 2026 de
  39 à 30 avec un départ en janvier 2026, et à 3 avec un départ en juin 2025.
- La liste propose le mois courant puis chaque mois passé jusqu'à **5 ans avant la première
  échéance** du projet (des mois vides, donc ; 12 mois au départ, élargi à la demande de
  l'utilisateur le 2026-10-26, 5 ans comme la fenêtre la plus large de la frise). Un départ
  après le mois courant vaut le mois courant.
- Le mois de départ est enregistré avec les maximums (§5.1). C'est un mois fixe ; le choix
  « Mois en cours », lui, suit le calendrier.
- **Frise** : les mois des tâches lissées s'ajoutent aux bornes de la frise (union avec le
  prévisionnel du pane bas et les barres du planning), au chargement comme après un
  enregistrement, pour qu'on puisse naviguer jusqu'aux tâches avancées. Elles s'élargissent
  sans jamais rétrécir avant le prochain chargement.

## 5. Stockage : colonne `Projets2.Lissage`

### 5.1 Format

Colonne **texte**, créée par l'utilisateur. Contenu JSON, une entrée par service (comme
`Projets2.Avancement`, tenue par service) :

```json
{
  "version": 1,
  "services": {
    "Structure": {
      "maxTotal": 4,
      "maxParType": { "COFFRAGE": 2, "ARMATURES": 2 },
      "debut": "2026-06",
      "parMois": {
        "2027-03": { "maxTotal": 6, "maxParType": { "ARMATURES": 6 } },
        "2027-08": { "maxParType": { "ARMATURES": 2 } }
      }
    }
  }
}
```

- Clés de type : celles des séries du graphique (`COFFRAGE`, `ARMATURES`, `NDC`, `COUPES`,
  `DEMOLITION`, `AUTRES`). Une clé absente ou vide = pas de maximum.
- `maxTotal` absent = pas de maximum général.
- `debut` (facultatif, AAAA-MM) : mois de départ (§4.8) ; absent = le mois courant.
- `parMois` (facultatif) : maximums d'un mois précis (§4.1), même forme que ceux de tous les
  mois ; une valeur absente reprend celle de tous les mois ; un mois sans aucune valeur n'est
  pas écrit. Ces deux clés sont ignorées par une version du widget qui ne les connaît pas
  (`version` reste 1) : elle lisse alors avec les seuls maximums de tous les mois.
- Un service sans aucune valeur n'a pas d'entrée : **pas de lissage** pour ce service.
- Lecture tolérante : cellule vide, JSON illisible, valeur non entière ou < 1 → ignorée (pas de
  lissage, ou maximum ignoré), avec un `console.warn`. Jamais de plantage du graphique.

### 5.2 Lecture

- `Projets2` est déjà lu au démarrage (`bootstrap()` de `main.js`), mais cet instantané n'est
  jamais reconstruit pendant la session (constat de l'analyse : `state.registry` et
  `realisationConfigs` restent ceux du démarrage). La valeur `Lissage` est donc **relue à
  chaque chargement de projet** (et sur signal, §5.4), jamais prise dans l'instantané du
  démarrage. On en garde l'entrée du **service courant**.
- Colonne absente (le cas en prod tant qu'elle n'est pas créée) : le bouton « Lisser… » est
  grisé, avec l'explication « Ajoutez une colonne texte « Lissage » dans Projets2 pour activer
  le lissage. » Le reste du graphique fonctionne comme aujourd'hui.
- Changement de service : on relit l'entrée du nouveau service.

### 5.3 Écriture

- « Enregistrer » écrit **une seule** action `UpdateRecord` sur la ligne `Projets2` du projet,
  colonne `Lissage` uniquement.
- On ne réécrit que l'entrée du **service courant** ; les entrées des autres services sont
  conservées telles quelles. On repart de la dernière valeur connue de la cellule.
- « Supprimer le lissage » retire l'entrée du service courant (cellule vidée si plus aucune
  entrée).
- Après une écriture réussie, le graphique est mis à jour **localement** tout de suite (pas de
  rechargement visible), comme les autres écritures du widget.
- Échec (droits, réseau) : message dans la fenêtre, rien n'est perdu de la saisie.
- **Lecture seule** (`GristServiceContext` : service affiché ≠ service de rattachement) : la
  fenêtre s'ouvre en consultation, champs et boutons d'écriture désactivés, avec la raison.

### 5.4 Changements venus d'ailleurs

**Pas de mise à jour en direct chez les autres utilisateurs** (décision du 2026-10-23 : option
recommandée, retenue sans colonne supplémentaire). Constat vérifié dans le code : le relais de
planning-synchro (`window.ProjectMutationSyncConfig` de `index.html`) ne signale pas les
écritures dans `Projets2`, et le filtre natif ignore les colonnes de `Projets2` qui ne sont pas
des colonnes de signal. Un lissage enregistré par un collègue apparaît donc quand on rouvre ou
resélectionne le projet (la valeur est relue à chaque chargement de projet, §5.2) ; l'écran de
celui qui enregistre se met à jour tout de suite (§5.3). Aucune colonne `Lissage_Sync`, aucun
changement de `ProjectMutationSyncConfig`.

Si un signal `Projets2` arrive malgré tout (par exemple quand une autre écriture du projet
déclenche une relecture du catalogue), la valeur `Lissage` relue est comparée à celle en
mémoire et, si elle a changé, le graphique est redessiné sans recharger le projet.

Un changement de `Planning_Projet` (dates, nouvelles lignes) passe déjà par le rechargement du
projet : le lissé est recalculé avec.

## 6. Interface

Toute l'interface nouvelle reprend les styles existants du widget (`ps-modal`,
`ps-modal-header`, boutons du sélecteur Mois / Semaine, pastilles de couleur des types).

### 6.1 En-tête de la vue Graphique

```
[x] Rassembler…   [Planning | Graphique]   Regrouper par : [Mois | Semaine]
                  Afficher : [Non lissé | Lissé | Les deux]   [Lisser…]   ☐Coffrage ☐Armature … ☐Total
```

- **« Lisser… »** : visible en vue Graphique seulement. Ouvre la fenêtre de lissage. Quand un
  lissage est défini pour ce projet et ce service, le bouton porte une marque « actif ».
- **« Afficher »** : visible seulement quand un lissage est défini. « Non lissé » montre le
  graphique d'aujourd'hui ; « Lissé » le même graphique calculé sur les dates lissées ; « Les
  deux » superpose les deux. Le choix est mémorisé dans le navigateur. Juste après un
  enregistrement, le graphique passe en « Les deux » pour montrer l'effet.
- Le filtre par type (cases à cocher) s'applique aux trois modes.

### 6.2 Fenêtre « Lissage des tâches »

```
┌ Lissage des tâches — <Projet> · <Service> ─────────────────── [Fermer] ┐
│ Fixez un nombre maximum de tâches à réaliser par mois. Les tâches en    │
│ trop sont avancées dans les mois précédents, jamais retardées.          │
│                                                                         │
│ Lisser à partir de                  [ juin 2025          ▾ ]            │
│  Les tâches à venir peuvent être avancées jusqu'à ce mois, même s'il    │
│  est passé ou vide. Les tâches réalisées ou en retard restent.          │
│ Maximum général (tous types)        [ 4 ] tâches / mois                 │
│                                                                         │
│ Par type de document                                pic actuel          │
│  ■ Coffrage                         [ 2 ]           5 (avril 2027)      │
│  ■ Armature                         [ 2 ]           6 (avril 2027)      │
│  ■ NDC                              [   ]           1 (mars 2027)       │
│                                                                         │
│ Mois particuliers                                                       │
│  Pour un mois précis, remplacez un maximum ci-dessus. Une case vide     │
│  reprend la valeur de tous les mois.                                    │
│  Mois              Total  Coffrage  Armature  NDC                       │
│  mars 2027          [10]    [ 2 ]     [ 6 ]   [ — ]   ✕                 │
│   11 tâches prévues                                                     │
│  [ avril 2027 ▾ ]  [Ajouter ce mois]                                    │
│                                                                         │
│ Aperçu                                                                  │
│  12 tâches avancées · aucune tâche retardée                             │
│  ⚠ 2 dépassements restent                                               │
│    avril 2027 — Armature 3 / 2 : coffrage du même mois                  │
│    octobre 2026 — Total 6 / 4 : mois en cours                           │
│  Mois         Avant  Après                                              │
│  février 27     0      2                                                │
│  mars 27        2      4                                                │
│  avril 27       8      4                                                │
│                                                                         │
│ [Supprimer le lissage]                      [Annuler]  [Enregistrer]    │
└─────────────────────────────────────────────────────────────────────────┘
```

- Une ligne par type **présent dans le projet**, dans l'ordre et les couleurs du graphique.
- « pic actuel » : plus grand nombre de tâches non lissées de ce type sur un mois à venir (mois
  courant inclus), et le mois correspondant. Aide à choisir un maximum.
- **« Lisser à partir de »** (§4.8) : « Mois en cours (octobre 2026) » puis les mois passés,
  du plus récent au plus ancien, jusqu'à 5 ans avant la première échéance.
- **« Mois particuliers »** (§4.1) : une ligne par mois ajouté, une colonne « Total » puis une
  par type présent ; une case vide montre en grisé la valeur de tous les mois qu'elle reprend
  (« — » s'il n'y en a pas) ; « N tâches prévues » rappelle la charge du mois avant lissage ;
  ✕ retire le mois. La liste d'ajout propose les mois du mois de départ à la dernière
  échéance, sauf ceux déjà ajoutés, et s'ouvre sur le premier mois à venir. Un mois ajouté
  mais laissé vide n'est pas enregistré.
- **Aperçu** recalculé à chaque saisie (léger délai pour la frappe) : nombre de tâches
  avancées, dépassements restants avec leur raison, et tableau « Avant / Après » limité aux
  mois qui changent ou qui restent en dépassement, du mois de départ au dernier mois concerné.
- Validation : entier ≥ 1 ou vide ; une saisie invalide est signalée sur le champ et bloque
  « Enregistrer ».
- « Supprimer le lissage » : visible seulement si un lissage est enregistré ; demande
  confirmation.
- Échap ou « Fermer » / « Annuler » : ferme sans enregistrer.

### 6.3 Courbes

- **Non lissé** : comme aujourd'hui (trait plein = toutes les tâches, pointillé = réalisées),
  avec la datation corrigée (§3.2).
- **Lissé** : même codage, calculé sur les dates lissées.
- **Les deux** : pour chaque série cochée, trait plein = **lissé**, trait **pâle et fin** de la
  même couleur = **avant lissage**. Les tâches réalisées ne bougeant jamais, la courbe en
  pointillé « réalisé » est la même dans les deux versions : une seule est tracée.
- La légende de gauche rappelle la convention du mode affiché.
- Le maximum fixé peut être rappelé par une ligne horizontale discrète (au choix du builder,
  sans surcharger le graphique).

### 6.4 Fenêtre « Tâches du mois »

Un **clic** (sans glisser : le graphique se déplace déjà au glisser) sur le graphique ouvre la
liste des tâches du **seau** situé sous le pointeur : le mois, ou la semaine si le graphique
est regroupé par semaine.

```
┌ Tâches à réaliser — avril 2027 · lissé ───────────────────── [Fermer] ┐
│ Coffrage (2)                                                           │
│   02/04/2027  N° 131  Voile R+1          Zone A · Groupe 3             │
│   12/04/2027  N° 135  Dalle R+2          Zone A · Groupe 4   réalisée  │
│ Armature (4)                                                           │
│   …                                                                    │
│   12/04/2027  N° 145  Poteaux R+2        Zone B · Groupe 1             │
│               avancée de mai 2027 (12/05/2027)                         │
│ Parties plus tôt (2)                         ← mode « Les deux »       │
│   N° 120  Voile R+1 → mars 2027                                        │
└────────────────────────────────────────────────────────────────────────┘
```

- Ne liste que les tâches des **types cochés** dans le filtre du graphique. Si seule la case
  « Total » est cochée, tous les types sont listés.
- Plusieurs types cochés : une section par type (ordre et couleur du graphique, avec le
  nombre de tâches). Un seul type : une liste simple.
- Tri dans une section : par date, puis par N°.
- Contenu d'une ligne : date (lissée en mode lissé), N° (`ID2`), nom de la tâche, zone et
  groupe, marque « réalisée », pour une tâche avancée « avancée de <mois> (<date
  d'origine>) », et pour un coffrage entraîné « avancé pour libérer l'armature N° … ».
- Quand un lissage est défini, l'en-tête de chaque section rappelle le compte face au maximum
  (« Armature — 3 / 2 ») ; un mois qui reste en dépassement l'affiche en avertissement, avec
  sa raison (§4.7), dans tous les modes.
- Mode « Non lissé » : tâches dont l'échéance d'origine tombe dans le seau.
- Mode « Lissé » : tâches dont l'échéance lissée tombe dans le seau.
- Mode « Les deux » : comme « Lissé », plus une section « Parties plus tôt » (tâches dont
  l'échéance d'origine tombe dans le seau mais qui ont été avancées, avec leur mois
  d'arrivée).
- Seau vide : « Aucune tâche à réaliser sur cette période. »
- Lecture seule dans tous les cas (consultation).

### 6.5 États particuliers

- Projet sans tâche datée : pas de bouton « Lisser… » utile (grisé, « Aucune tâche à
  lisser »).
- Colonne `Lissage` absente : §5.2.
- Lecture seule : §5.3.
- Changement de projet ou de service fenêtre ouverte : la fenêtre se ferme.
- **Rechargement du même projet** (une date ou un avancement modifié ailleurs, par un collègue
  ou dans Planning Projet) : aujourd'hui `loadProject` remet toujours la vue sur « Planning »
  et le filtre du graphique repart tout coché. Pour le **même** projet et le **même** service,
  on reste désormais sur la vue en cours, avec le même mode d'affichage, le même regroupement
  et le même filtre ; la fenêtre « Lissage » garde la saisie en cours et recalcule son aperçu ;
  la fenêtre « Tâches du mois » se rafraîchit. Mon choix : renvoyer l'utilisateur sur le
  Planning à chaque modification d'un collègue lui ferait perdre sa saisie.

## 7. Ancrage dans le code

Tout se passe dans `planning-synchro/`. Planning Projet, gestion-depenses2 et `shared/` ne sont
pas modifiés.

- **Nouveau module pur `top/taskLoadModel.js`** : construit la liste des tâches (§3) à partir de
  la sortie de `buildTimelineDataFromPlanningRows` (constructeur vendorisé) : id de ligne, N°,
  nom, zone, groupe, type, échéance, réalisé, clé de groupe. Utilisé par le graphique, le
  lissage et la liste du mois.
- **Nouveau module pur `top/taskSmoothing.js`** : la règle de §4. Entrée : tâches, maximums,
  date du jour. Sortie : §4.7.
- **Nouveau module pur `top/smoothingSettings.js`** : lecture / écriture du JSON de §5.1
  (fusion par service, tolérance aux valeurs invalides).
- **Nouveau module DOM `top/smoothingModal.js`** : fenêtre §6.2 (même discipline que
  `bottom/chargeAssignModal.js` : la fenêtre n'écrit rien elle-même, elle remet les maximums à
  `main.js` qui écrit).
- **Nouveau module DOM `top/monthTasksModal.js`** : fenêtre §6.4.
- **`top/planningChart.js`** : séries calculées à partir de `taskLoadModel` (datation
  corrigée), modes Non lissé / Lissé / Les deux, clic sur un seau, sélecteur « Afficher ».
  `buildTaskLoadSeries` reste pur et testé.
- **`services/gristService.js`** : `updateProjectSmoothing(projectId, json)` (une
  `UpdateRecord` sur `Projets2`).
- **`main.js`** : lecture de `Lissage` au démarrage et sur signal `Projets2` (§5.4), passage
  des maximums au graphique, branchement des deux fenêtres, mise à jour locale après écriture.
- **`config.js`** : colonne `projects.lissage: "Lissage"`.
- **`index.html`**, **`assets/css/styles.css`** : boutons, sélecteur, deux fenêtres.
- **`README.md`** : section « Lissage » ; corriger au passage les points périmés de la section
  Graphique (le Graphique ne dépend plus de « Rassembler »).

## 8. Tests

Avec `node --test` (dossier `planning-synchro/tests/`), comme le reste du widget.

- `taskSmoothing` : les exemples A à H de §4.4 à l'identique ; tâches figées ; mois courant ;
  dates lissées (§4.5, dont fin de mois et « aujourd'hui ») ; armature / coffrage (§4.6, selon
  le comportement retenu) ; maximums vides ; déterminisme.
- **Fuzz** (générateur pseudo-aléatoire à graine fixe, des milliers de cas) vérifiant les
  règles strictes de §4.2 : jamais plus tard, jamais dans le passé, figées immobiles, armature
  après coffrage, tout mois qui reçoit une tâche respecte les maximums, même résultat deux fois.
- `taskLoadModel` : datation identique à la barre (coffrage lié MS Project, coffrage de groupe,
  NDC sans `Date_limite`), réalisé de la barre, lignes non dessinées exclues.
- `smoothingSettings` : lecture tolérante, fusion par service, suppression.
- Graphique : séries non lissées / lissées, mode « Les deux », filtre appliqué, seau sous le
  pointeur.
- Fenêtres : rendu (types présents, aperçu, validation, lecture seule, colonne absente),
  liste du mois (filtre, groupes, tri, sections du mode « Les deux »).
- Les tests existants du widget restent verts (368 aujourd'hui), ainsi que ceux de `shared/`.

Vérification visuelle : rendu réel des modules et du CSS en Chrome sans fenêtre (les serveurs
navigateur MCP ne se connectent pas dans cet environnement), puis test de l'utilisateur sur
localhost.

## 9. Hors périmètre

- Écrire des dates lissées dans `Planning_Projet`, ou modifier les vraies dates.
- Le widget Planning Projet, gestion-depenses2, Gestion-globale.
- Afficher le lissé dans la vue Planning (barres) ou dans la ligne « Charge » du pane bas.
- Des maximums par semaine.
- Un lissage fondé sur la capacité des personnes (`TimeSegment`, absences) : on raisonne en
  nombre de tâches, comme le graphique.
- Recaler les échéances des données d'entrée (`References2`) d'une tâche avancée.

## 10. Risques et points d'attention

- **Datation corrigée** (§3.2) : les courbes non lissées bougent pour certaines lignes ; c'est
  voulu, mais à annoncer à l'utilisateur.
- **Copie vendorisée du constructeur** : elle dérive déjà de Planning Projet (sans effet sur
  les dates). Le lissage en dépend désormais aussi ; ne pas la modifier dans ce chantier.
- **Signal `Projets2`** : le relais de synchronisation écrit une colonne de signal sur
  `Projets2` après chaque écriture ; il ne faut pas que la comparaison de `Lissage` provoque
  un rechargement complet à chaque écriture du widget.
- **Écriture dans `Projets2` à travers la couche partagée** : toute écriture du widget passe
  par `shared/grist-service-context.js`, qui vérifie l'appartenance de la ligne au contexte et
  l'accès « editable », et par le relais qui ajoute ses colonnes de signal au même lot. Le
  précédent existe (gestion-depenses2 écrit `Projets2.Avancement`) ; le plan doit vérifier
  qu'une `UpdateRecord` sur `Projets2` depuis planning-synchro passe ces contrôles, et le
  couvrir par un test.
- **Saisie manuelle dans Grist** : une modification de `Lissage` faite à la main dans la grille
  Grist (hors relais) peut ne pas déclencher de signal ; elle sera prise au prochain chargement
  du projet. Accepté.
- **Écriture concurrente** du JSON (deux services enregistrent en même temps) : on relit la
  cellule juste avant d'écrire et on ne remplace que l'entrée du service courant ; le risque
  résiduel est accepté.
- **Fins de ligne** : `planning-synchro` mélange des fichiers CRLF et LF ; conserver les fins
  de ligne de chaque fichier modifié.
- **Clic et glisser** sur le graphique : un glisser (déplacement de la frise) ne doit jamais
  ouvrir la liste.

## 11. Laissé au builder

- L'algorithme exact, pourvu qu'il respecte §4.2, l'ordre des préférences de §4.3 et les
  exemples de §4.4. Piste : passe chronologique des mois (du mois courant au dernier) qui
  envoie le dépassement d'un mois vers la place libre la plus proche avant lui, puis
  réattribution chronologique des tâches de chaque type aux places obtenues (la plus tôt
  d'abord, en tenant compte de la contrainte armature / coffrage).
- La forme exacte de la ligne de maximum (§6.3), le délai de recalcul de l'aperçu, les
  libellés secondaires et la mise en page fine des fenêtres, dans le style existant.
- Le nom exact des fonctions et la répartition interne des modules de §7.
