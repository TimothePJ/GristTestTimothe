# Cahier des charges — Le planning du service Synthèse

Tu vas rédiger un cahier des charges court et me le remettre sous la forme d'un fichier Word (.docx) à télécharger. Je joins deux images à ce message : elles doivent figurer dans le document. Tout ce dont tu as besoin est ici ; tu n'as rien à chercher ailleurs.

Le sujet : faire entrer le planning du service Synthèse d'un bureau d'études dans la plateforme que ce bureau utilise déjà, et le relier au planning du service Structure.

## 1. Les deux images jointes

**Image A — Planning Projet aujourd'hui.** C'est une capture de la plateforme actuelle, pour le service Structure. On y voit le bandeau (Projet, Zone, « Editer », « Durées », Semaine / Mois / Année, Service), un tableau (Id, Tâches, Ligne planning, Début, Durée, Fin, Démarrage Travaux, Indice, Réalisation, Retard) et, à droite, une frise avec des barres « Coffrage » et « Armature ». Les lignes sont regroupées par zone (« Zone 1 / BAT BC »). Les plans de coffrage sont les lignes jaunes dont le nom finit par « - COF ». C'est le point de départ : ce que les lecteurs utilisent tous les jours.

**Image B — Le planning de synthèse, tenu aujourd'hui dans Microsoft Project.** C'est le planning de référence du service Synthèse, en dehors de la plateforme. À gauche un tableau (Nom de la tâche, N° du plan, Indice, Durée, Début, Fin), à droite un diagramme de Gantt. Le planning est organisé par niveau (« NIVEAU Sous-Sol 1 », en orange clair), puis par cycle (« CYCLE 1 », « CYCLE 2 », « CYCLE 3 », en gris), avec des sous-groupes (« PLAN SYT CYCLE 2 »), des tâches, des jalons de durée 0, des réunions en bleu et le démarrage du gros œuvre en rouge. C'est le modèle de ce que l'on veut retrouver dans la plateforme.

Insère dans le document les fichiers images eux-mêmes, pas une description ni un dessin refait : l'image A dans le chapitre sur la situation actuelle, l'image B dans le chapitre sur le besoin. Chacune en pleine largeur, sur une page en paysage si c'est nécessaire pour qu'elle reste lisible, avec une légende et deux ou trois phrases qui disent au lecteur quoi y regarder. Dans la suite, renvoie à ces images quand cela aide à comprendre (« comme les lignes grises de l'image B »).

## 2. Lecteurs, ton et taille

Les lecteurs sont des personnes du bureau d'études qui ne sont pas informaticiennes. Elles connaissent très bien le métier et utilisent la plateforme tous les jours ; elles ne savent pas comment elle est construite, et n'ont pas à le savoir. En refermant le document, elles doivent pouvoir dire « oui, c'est ce qu'il nous faut » ou « non, il manque ceci ».

- Tout se décrit du point de vue de l'utilisateur : ce qu'il voit, ce qu'il fait, ce que l'outil répond. Si une phrase demande de savoir ce qu'est une base de données, un fichier ou un navigateur pour être comprise, réécris-la.
- Le document est court : 8 à 12 pages, images comprises. Va à l'essentiel, n'ajoute pas de chapitres ni de détails que je ne donne pas. Des phrases simples, un exemple concret plutôt qu'une définition.
- N'invente rien : ni chiffre, ni délai, ni budget, ni fonction que je n'ai pas décrite. S'il manque une information, écris « à préciser ».
- Écris « le bureau d'études », sans nommer l'entreprise. Les exemples visibles sur les images (l'étage Sous-Sol 1, le coffrage 3021…) peuvent être repris.

## 3. Un document qui se lit comme écrit avant toute réalisation

Pour ta seule compréhension : j'ai en réalité déjà développé cette évolution, et c'est ce qui me permet de te la décrire précisément. Cette information reste entre toi et moi. Elle ne doit apparaître nulle part dans le document, ni en toutes lettres, ni par un détail qui la laisserait deviner.

Un cahier des charges précède la réalisation, et celui-ci doit se lire ainsi : une demande, écrite à partir de la plateforme actuelle (image A), pour quelque chose qui reste à construire.

- La situation actuelle se décrit au présent. Tout le reste se formule comme une demande, au futur : « l'utilisateur pourra… », « l'outil devra… ». J'ai écrit la section 6 au présent pour aller vite ; mets-la au futur.
- Aucune tournure ne suppose que quelque chose a déjà été réalisé, essayé ou constaté. Les exemples sont des résultats attendus.
- Le document ne parle pas de l'avancement du travail, dans un sens comme dans l'autre.

## 4. La situation actuelle

Le bureau d'études produit, pour chaque projet, des documents d'études (plans de coffrage, plans d'armature…). Chaque document a des indices, ses versions successives (0, A, B…), et il est rangé dans une zone du projet.

La plateforme réunit plusieurs écrans qui partagent les mêmes données. En haut de chaque écran, on choisit le projet et le service : Structure, Synthèse ou Topographie. Elle est née dans le service Structure et s'ouvre peu à peu aux autres.

L'écran Planning Projet (image A) affiche le planning de production des documents : une ligne par document, regroupées par zone, avec la chaîne propre à Structure — coffrage, puis armature, puis démarrage des travaux. On consulte librement ; pour modifier, il faut activer « Editer ». Un autre écran, la Liste de plans, sert à noter la date de diffusion de chaque indice de chaque plan.

Ce qui manque :

- Si l'on choisit le service Synthèse, on obtient la même frise de documents que pour Structure. Elle ne correspond pas à la façon de travailler de Synthèse.
- Les zones sont séparées par service, alors qu'il s'agit du même bâtiment.
- Rien ne relie le planning de Synthèse à celui de Structure, et aucun écran ne permet de les lire ensemble.

## 5. Le besoin

La synthèse technique coordonne les réseaux des corps d'état techniques avec la structure. Elle avance étage par étage, en trois cycles : fond de plan de synthèse, réception des rendus, plans de synthèse (réseaux, réservations, terminaux), réunions, visas, jusqu'à la signature et au démarrage du gros œuvre de l'étage. C'est exactement ce que montre l'image B.

Le service Synthèse tient ce planning dans Microsoft Project, à part. Le besoin est de le tenir dans Planning Projet, sur les mêmes projets et les mêmes zones que les autres services, en gardant la façon de travailler de l'image B.

Synthèse et Structure dépendent l'un de l'autre, et le planning doit le montrer :

- le fond de plan de synthèse d'un étage démarre à la date à laquelle Structure prévoit de diffuser l'indice 0 du plan de coffrage correspondant ;
- le plan de synthèse des réservations doit être terminé avant que Structure ne commence ce plan de coffrage, puisque les réservations y sont reportées.

## 6. Ce qui est demandé

### 6.1 Une vue propre au service Synthèse dans Planning Projet

Quand on choisit le service Synthèse, Planning Projet affiche, à la place de la frise de l'image A, un planning à la manière de l'image B : à gauche un tableau (Nom de la tâche, N°, Indice, Durée, Début, Fin), à droite un diagramme de Gantt, ligne pour ligne — des barres pour les tâches, des losanges pour les jalons, des flèches entre les tâches qui s'enchaînent, les week-ends et jours fériés en gris, un trait rouge pour aujourd'hui. Le bandeau reste le même. Pour Structure et Topographie, rien ne change.

- On modifie directement dans le tableau, « Editer » activé : le nom, le N°, l'indice, la durée, le début, la fin. Changer la durée recalcule la fin ; changer une date recalcule la durée.
- Les durées se comptent en jours ouvrés (du lundi au vendredi, hors jours fériés). Une tâche de durée 0 est un jalon.
- Un clic droit sur une ligne permet d'ajouter ou de supprimer une tâche.
- Le Gantt sert à lire le planning : on s'y déplace dans le temps et on zoome, mais on ne déplace pas les barres. Les dates se changent dans le tableau.
- Une saisie incohérente est refusée avec un message clair. Ce que l'on modifie s'affiche tout de suite ; si l'enregistrement échoue, l'écran revient à l'état réel et le dit.

### 6.2 La même organisation que dans Microsoft Project

Le planning s'organise comme sur l'image B : la zone, puis les étages (les « niveaux » de l'image B), puis les cycles, parfois un sous-groupe, puis les tâches. Chaque zone, étage, cycle et sous-groupe a sa ligne, que l'on peut replier, avec sa durée, son début et sa fin calculés à partir de ses tâches (comme « NIVEAU Sous-Sol 1 — 47 jours » ou « CYCLE 1 — 22 jours » sur l'image B). Les couleurs sont celles de l'image B.

- « Ajouter un étage », par un clic droit sur une zone, crée d'un coup un étage complet d'après un modèle : celui que montre l'image B pour le Sous-Sol 1 — la réception, les trois cycles, leurs sous-groupes et toutes leurs tâches, jusqu'au démarrage du gros œuvre. Le nom de l'étage est repris dans le nom des tâches. Les tâches arrivent sans dates ni durées : on les saisit.
- On peut renommer un étage (le nouveau nom se reporte dans ses tâches), le supprimer avec tout son contenu après confirmation, et déplacer une tâche d'un groupe à un autre en la faisant glisser.

### 6.3 Des dates qui s'enchaînent toutes seules

Les tâches du modèle sont enchaînées entre elles comme dans Microsoft Project — ce sont les flèches de l'image B. Quand on change la date ou la durée d'une tâche, celles qui en dépendent se recalent toutes seules, jusqu'au bout de l'étage. Le recalage ne va que vers la suite : ce qui précède ne bouge pas. Les enchaînements viennent du modèle ; on ne les modifie pas à l'écran, et une tâche ajoutée à la main n'est enchaînée à aucune autre.

### 6.4 Des zones communes à tous les services

Une zone appartient au projet, pas à un service : une zone créée par Structure apparaît pour Synthèse, et inversement. On ne peut pas créer deux fois la même zone. Chaque service ne peut renommer ou supprimer que ses propres zones.

### 6.5 Une date prévue dans la Liste de plans

La Liste de plans gagne une colonne « 0 Prev » : la date à laquelle la diffusion de l'indice 0 d'un plan est prévue. Ce n'est pas une diffusion : elle ne compte ni dans l'avancement, ni à l'impression, ni sur les bordereaux.

### 6.6 Le lien entre Synthèse et Structure

Un bouton « Lien Structure », visible seulement dans la vue Synthèse, ouvre une fenêtre qui met face à face, zone par zone, les étages de Synthèse et les plans de coffrage de Structure (les lignes jaunes de l'image A).

- On fait glisser un coffrage sur un étage de la même zone : l'étage est lié à ce coffrage. Exemple : l'étage « Sous-Sol 1 » avec le coffrage 3021 « PH 1er SOUS-SOL - COF ».
- La date « 0 Prev » du coffrage devient alors le début du fond de plan de synthèse de l'étage, et les tâches suivantes se recalent (6.3).
- Rien ne bouge tout seul ensuite : si la date « 0 Prev » change, la fenêtre signale l'étage « à mettre à jour » et un bouton applique la nouvelle date. On peut aussi délier un étage.
- Dans le tableau, un petit emblème à côté du nom de chaque étage montre s'il est lié (vert) ou non (rouge).
- Une alerte : dans un étage lié, le plan de synthèse des réservations du cycle 3 doit finir au plus tard le jour où Structure commence son plan de coffrage (la colonne « Début » de l'image A). Le Gantt marque cette limite d'un trait ; si la tâche la dépasse, elle passe en alerte. C'est un signalement, pas un blocage. L'utilisateur peut désigner une autre tâche à contrôler à la place.

### 6.7 Ce qui vaut partout

- Pour modifier, il faut avoir activé « Editer » et avoir le droit de modifier le service ; sinon on consulte.
- Les tâches de Synthèse restent dans la vue Synthèse : elles n'apparaissent pas dans les autres écrans et ne comptent pas dans l'avancement des documents.

## 7. Un tableau commun à Synthèse et à Structure — forme à définir

Il faudra aussi construire un tableau qui réunit, pour un même projet, le planning de Synthèse et celui de Structure, pour qu'on les lise ensemble : autrement dit, voir sur un même écran ce que montrent aujourd'hui séparément l'image A et l'image B. Le besoin est certain ; la façon d'y répondre n'est pas encore arrêtée, et le document ne doit pas faire semblant de la connaître.

Dans ce chapitre, court :

- dis pourquoi ce tableau est utile : les deux plannings dépendent l'un de l'autre (section 5), et tant qu'on les regarde séparément, leurs rendez-vous ne se voient pas d'un coup d'œil ;
- dis sur quoi il pourra s'appuyer : les zones communes (6.4) et le lien entre un étage et son coffrage (6.6) ;
- pose les questions qui restent à trancher avec les lecteurs : à qui il sert d'abord ; s'il se trouve dans Planning Projet ou dans un écran à part ; quelles lignes il montre (tout, ou seulement les étapes clés de chaque étage en face de son coffrage) ; des dates, un Gantt, ou les deux ; simple consultation ou modification ;
- termine en disant que ce tableau fera l'objet d'un complément une fois ces questions tranchées.

Ne propose pas de solution. Présente simplement ce point comme celui dont la forme reste à définir, sans l'opposer aux autres.

## 8. Ce qui n'est pas demandé

À dire en quelques lignes : déplacer les barres dans le Gantt ; modifier les enchaînements ou le modèle d'étage depuis l'écran ; affecter des personnes aux tâches ; mettre à jour toute seule la date du fond de plan quand la date « 0 Prev » change.

## 9. Comment on vérifiera

Quelques scénarios que les lecteurs pourront dérouler à l'écran :

1. Retrouver l'image B. On crée un étage « Sous-Sol 1 », on saisit les durées de l'image B et la réception au vendredi 02/01/26. L'outil devra donner les mêmes dates que l'image B : cycle 1 du 02/01 au 02/02 (22 jours), cycle 2 du 27/01 au 09/02 (10 jours), cycle 3 du 10/02 au 09/03 (20 jours), étage de 47 jours, démarrage du gros œuvre le 09/03/26.
2. On décale la réception : tout l'étage suit.
3. On lie l'étage au coffrage 3021 : le fond de plan démarre à la date « 0 Prev » du coffrage, l'emblème passe au vert.
4. On fait finir le plan des réservations après le début du coffrage : l'alerte apparaît.
5. On repasse sur Structure : la frise est celle de l'image A, inchangée, sans aucune tâche de Synthèse.

## 10. Plan du document

1. En bref — une demi-page, avec un petit tableau « Aujourd'hui / Avec l'évolution »
2. La situation actuelle — avec l'image A
3. Le besoin — avec l'image B
4. Ce qui est demandé — les points 6.1 à 6.7
5. Le tableau commun à Synthèse et à Structure — forme à définir
6. Ce qui ne change pas, ce qui n'est pas demandé
7. Comment on vérifiera
8. Points à préciser, et un court glossaire (jalon, jour ouvré, cycle, « 0 Prev », et les abréviations visibles sur l'image B : CET corps d'état techniques, GO gros œuvre, FDS fond de plan de synthèse, SYT synthèse, RSX réseaux, RESA réservations, TER terminaux)

Garde entre guillemets les noms de boutons et de menus tels que je les ai écrits : ce sont eux que les lecteurs retrouveront à l'écran.

## 11. Livrable

Un fichier Word (.docx) au format A4, prêt à être diffusé sans retouche : page de garde (titre « Cahier des charges — Le planning du service Synthèse et son lien avec le planning Structure », et des champs à compléter pour l'auteur, la date et la version), sommaire automatique, titres numérotés avec les styles de Word, numéro de page en pied de page, mise en page sobre et aérée, les deux images insérées.

Crée réellement le fichier et donne-moi le lien pour le télécharger ; ne colle pas le contenu dans la conversation à la place. Avant de me le remettre, rouvre-le pour vérifier que tout y est, les deux images comprises, puis relis-le avec les yeux d'un lecteur qui ne sait rien de moi : rien ne doit lui laisser penser que l'évolution existe déjà.

Si tu ne peux pas créer de fichier Word ici, ou pas y insérer les images jointes, dis-le tout de suite, avant de rédiger. Dans la conversation, et non dans le document, termine par la liste des points que tu as marqués « à préciser ».
