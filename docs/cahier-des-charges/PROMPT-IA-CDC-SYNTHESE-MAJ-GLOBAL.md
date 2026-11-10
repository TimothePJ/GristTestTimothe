# Mise à jour du cahier des charges — Planning Global et liaisons Synthèse / Structure

Je te joins la version 1 du cahier des charges « Le planning du service Synthèse et son lien avec le planning Structure ». Je te demande la version 2 : le même document, complété sur deux points, et remis sous la forme d'un nouveau fichier Word (.docx) complet, à télécharger.

Les deux ajouts :

1. un chapitre qui montre ce que l'on relie entre le planning de Synthèse et celui de Structure ;
2. le planning Global : le tableau commun aux deux services, dont la version 1 disait que la forme restait à définir. Sa forme est maintenant arrêtée, et une maquette l'illustre.

Je joins aussi quatre nouvelles images, à insérer dans le document.

## 1. Les règles de la version 1 restent valables

- Les lecteurs sont des personnes du bureau d'études, non informaticiennes. Tout se décrit de leur point de vue : ce qu'elles voient, ce qu'elles font, ce que l'outil répond. Aucun terme technique.
- Le document se lit comme écrit avant toute réalisation : une demande, au futur (« l'outil devra… »). Pour ta seule compréhension, ce qui est décrit existe déjà en partie ; cela ne doit apparaître nulle part dans le document, ni en toutes lettres, ni par un détail.
- Le document reste court. La version 2 ajoute environ quatre pages, images comprises ; ne gonfle pas le reste.
- N'invente rien. S'il manque une information, écris « à préciser ».
- Ne touche pas au reste de la version 1, sauf pour ce que liste la section 3.

## 2. Les quatre nouvelles images — ce sont des maquettes

Ces quatre images montrent la cible, pas la plateforme actuelle. Présente-les toutes comme des maquettes : légende commençant par « Maquette — », et dans le texte « la maquette montre… », « comme sur la maquette… ». N'écris jamais « capture », « copie d'écran » ou « écran actuel » à leur sujet. Les données qu'on y lit (projet, numéros, dates) sont des exemples. Tu peux en reprendre pour illustrer une règle, mais n'analyse pas ces données comme si elles étaient réelles.

Les images A (Planning Projet aujourd'hui) et B (planning Microsoft Project) de la version 1 ne changent pas.

Tu reconnaîtras chaque image à son contenu, quel que soit l'ordre dans lequel je les joins :

- **Image C — La Liste de plans, avec sa colonne « 0 Prev ».** Un tableau des plans de coffrage par zone, avec les colonnes « N° document », « Désignation », « 0 Prev », puis « 0 », « A », « B ». La colonne « 0 Prev » porte la date prévue de diffusion de l'indice 0. Légende : « Maquette — La Liste de plans avec la colonne « 0 Prev » ». À placer dans le nouveau chapitre des liaisons.
- **Image D — La fenêtre « Lien Structure ».** Elle montre, zone par zone, les étages de Synthèse à gauche et les plans de coffrage de Structure à droite, avec leur date « 0 Prev » et les liens déjà faits (« lié : RDC », « à jour »). Légende : « Maquette — La fenêtre « Lien Structure » ». À placer dans le nouveau chapitre des liaisons.
- **Image E — Le planning Global.** Le bouton « Global » est enfoncé. On voit un tableau (Nom, N°, Indice, Durée, Début, Fin, État) avec des lignes comme « RDC ⇄ 3032 — PH REZ DE CHAUSSEE - COF », des pastilles rouges et orange dans la colonne « État », un Gantt à droite, et une barre en bas (« 3 étages liés · 0 non lié · 1 retard Synthèse… », « Alertes seulement », « Actualiser »). Légende : « Maquette — Le planning Global ». À placer dans le chapitre du planning Global.
- **Image F — La vue Synthèse.** Le planning d'un étage (« SS1 ») organisé comme le planning Microsoft Project de l'image B, avec le tableau à gauche et le Gantt à droite. Légende : « Maquette — La vue Synthèse dans Planning Projet ». À placer là où la version 1 décrit la vue propre au service Synthèse ; renvoie l'image B à cette maquette (« ce que l'image B montre dans Microsoft Project, la maquette le montre dans Planning Projet »).

Insère les fichiers images eux-mêmes, en pleine largeur, sur une page en paysage si c'est nécessaire pour qu'ils restent lisibles, avec deux ou trois phrases qui disent au lecteur quoi y regarder.

## 3. Ce qui change dans le document

1. **Nouveau chapitre « Ce que l'on relie entre les deux plannings »**, placé après le chapitre de ce qui est demandé, avec les images C et D. Son contenu est en section 4. La version 1 parle déjà du lien et de la fenêtre « Lien Structure » dans ce qui est demandé : réduis ce passage à quelques lignes qui renvoient au nouveau chapitre, pour ne rien dire deux fois.
2. **Le chapitre du tableau commun devient « Le planning Global »**, avec l'image E. Il remplace le texte « forme à définir » et ses questions ouvertes. Son contenu est en section 5.
3. **L'image F** est ajoutée là où la version 1 décrit la vue Synthèse.
4. **Retouches ailleurs, en quelques lignes chacune :**
   - le résumé et le tableau « Aujourd'hui / Avec l'évolution » mentionnent le planning Global et les liaisons ;
   - « Ce qui n'est pas demandé » ajoute : modifier quoi que ce soit depuis le planning Global ;
   - « Comment on vérifiera » ajoute les scénarios de la section 6 ;
   - le glossaire ajoute « niveau », « retard Synthèse », « retard Structure », « cohérent », « non vérifiable » ;
   - les points à préciser retirent les questions du tableau commun, désormais tranchées ;
   - le tableau des versions ajoute « Version 2 : ajout des liaisons entre les deux plannings et du planning Global ».

## 4. Contenu du chapitre « Ce que l'on relie entre les deux plannings »

L'idée à faire passer : tout part d'un seul geste, lier un étage de Synthèse à son plan de coffrage. Une fois ce lien fait, l'outil sait quelles dates de Structure regarder pour cet étage, et peut vérifier que les deux plannings restent d'accord. Présente les liaisons dans un tableau à trois colonnes — côté Synthèse, côté Structure, ce que l'outil en fait — puis un exemple.

| Côté Synthèse | Côté Structure | Ce que l'outil en fait |
|---|---|---|
| Les zones | Les zones | Elles sont communes aux deux services : c'est le même découpage du bâtiment. |
| Un étage (« SS1 », « RDC ») | Le plan de coffrage du même niveau, dans la même zone (« 3022 — PH 1er SOUS-SOL - COF ») | Le lien se fait à la main, dans la fenêtre « Lien Structure » (image D) : on fait glisser le coffrage sur l'étage. Un étage a un seul coffrage ; un coffrage peut servir à plusieurs étages. Toutes les liaisons suivantes découlent de celle-ci. |
| Le début du « FOND DE PLAN DE SYNTHESE » de l'étage (porté par le jalon « RECEPTION ARCH/TOPO/STR ») | La date « 0 Prev » du coffrage dans la Liste de plans (image C) | La date est reprise au moment du lien, puis à la demande par le bouton « Mettre à jour ». Une date tombant un week-end ou un jour férié passe au jour ouvré suivant, et le reste de l'étage suit. Si les deux ne correspondent plus, l'étage est signalé « à mettre à jour ». |
| La tâche contrôlée de l'étage : par défaut le plan de synthèse des réservations du cycle 3, ou une autre tâche choisie par l'utilisateur | Le début du plan de coffrage dans le planning Structure (colonne « Début » de l'image A) | La tâche doit être finie au plus tard ce jour-là, puisque les réservations sont reportées sur le plan de coffrage. Sinon, c'est un retard Synthèse : un trait marque la limite dans le Gantt, et la tâche passe en alerte. |
| Le jalon « DEMARRAGE GO … (date prévisionnelle) » de l'étage | Le démarrage des travaux du coffrage et de ses armatures dans le planning Structure (colonne « Démarrage Travaux » de l'image A ; on retient le plus tôt) | Le démarrage prévu par Synthèse ne doit pas tomber après celui des travaux. Sinon, c'est un retard Synthèse. |

Exemple à dérouler, cohérent avec les maquettes C et D : dans la zone « Zone 2 / BAT B », le coffrage 3032 « PH REZ DE CHAUSSEE - COF » a une date « 0 Prev » au samedi 25/10/2025. Lié à l'étage « RDC », il fait démarrer le fond de plan de synthèse le lundi 27/10/2025, et la fenêtre affiche « à jour ». Prends tes exemples dans la zone 2, où chaque étage est lié au coffrage du même niveau.

Précise aussi :

- Ces vérifications ne bloquent jamais une saisie : ce sont des signalements.
- Si une date manque d'un côté ou de l'autre (pas de « 0 Prev », pas de début de coffrage, pas de jalon de démarrage daté), la vérification est dite « non vérifiable », et l'outil explique pourquoi au survol.
- Si Structure supprime ou renumérote le coffrage, l'étage est signalé « coffrage introuvable ».

## 5. Contenu du chapitre « Le planning Global »

Le besoin, déjà posé dans la version 1 : lire ensemble, pour un même projet, le planning de Synthèse et celui de Structure, pour voir d'un coup d'œil si leurs rendez-vous sont tenus.

Ce que l'outil devra offrir (image E) :

- **Un bouton « Global »** dans le bandeau de Planning Projet, à côté de la liste Zone, quel que soit le service choisi. Un clic affiche le planning Global à la place du planning du service ; un second clic y revient. Le choix est retenu d'une ouverture à l'autre.
- **Consultation seule.** On n'y modifie rien. Tant qu'il est affiché, les boutons de modification — « Editer », « Durées », « Lien Structure » — disparaissent du bandeau, ainsi que l'ajout et la modification de zone dans la liste Zone. Chaque service modifie son planning dans sa propre vue.
- **La même présentation que la vue Synthèse.** Un tableau à gauche — Nom, N°, Indice, Durée, Début, Fin, plus une colonne « État » — et un Gantt à droite. Le bandeau reste le même (Semaine / Mois / Année, filtre Zone).
- **Une organisation par zone.** Dans chaque zone :
  - chaque étage lié forme un « niveau » avec son coffrage, sur une ligne qui les réunit (« RDC ⇄ 3032 — PH REZ DE CHAUSSEE - COF ») ; dessous, l'étage de Synthèse avec tout son contenu, et le plan de coffrage avec ses armatures ;
  - les coffrages sans étage, avec leurs armatures, dans l'ordre du planning Structure ;
  - les étages de Synthèse non liés, à part ;
  - les autres documents de Structure regroupés par type (« COUPES — 2 documents »).

  À l'ouverture, les zones sont dépliées et le reste replié ; un triangle déplie chaque ligne.
- **Les couleurs de chaque service.** Les lignes de Structure gardent celles du planning Structure (coffrage en jaune…), les lignes de Synthèse celles de la vue Synthèse. Dans le Gantt, les documents de Structure ont les mêmes barres que dans le planning Structure, et les tâches de Synthèse leurs barres et leurs losanges.
- **La colonne « État »**, qui dit en couleur ce qui ne va pas, avec l'explication au survol :
  - un document de Structure non terminé dont la fin est passée affiche « retard 187 j » en rouge, ou en orange avec « (justifié) » si un retard a été justifié ; terminé, il affiche « terminé » ; un coffrage indique aussi ses armatures en retard ;
  - une tâche de Synthèse qui ne respecte pas une liaison du chapitre précédent affiche « retard 103 j », et sa Fin passe en rouge ;
  - un étage affiche « à mettre à jour », « coffrage introuvable » ou « non lié à un coffrage » ;
  - un niveau affiche « ✓ cohérent » quand toutes ses liaisons sont respectées, sinon « Synthèse en retard de 103 j », « à mettre à jour » ou « non vérifiable », et le nombre de retards Structure ;
  - une zone ou un cycle résume son contenu (« 1 retard Synthèse · 7 retards Structure »).

  Les retards se comptent en jours calendaires. Dans le Gantt, ce qui est en alerte apparaît en rouge, jusqu'au niveau et à l'étage qui le contiennent.
- **Une barre en bas** qui fait le compte pour le projet (« 3 étages liés · 0 non lié · 1 retard Synthèse · 0 à mettre à jour · 30 retards Structure »), avec deux boutons. « Alertes seulement » ne garde que les lignes en alerte et ce qui les contient, dépliées. « Actualiser » relit le planning.
- **Toujours à jour.** Le planning Global suit le filtre Zone du bandeau et se met à jour quand l'un ou l'autre service modifie son planning.

## 6. Scénarios à ajouter dans « Comment on vérifiera »

1. On lie l'étage « RDC » au coffrage 3032, dont la date « 0 Prev » est le samedi 25/10/2025 : le fond de plan démarre le lundi 27/10/2025, la fenêtre affiche « à jour », et le planning Global montre le niveau « RDC ⇄ 3032 » avec « ✓ cohérent » si rien d'autre ne cloche.
2. On fait finir la tâche contrôlée après le début du plan de coffrage : dans le planning Global, sa Fin passe en rouge avec « retard N j », et l'étage, le niveau et la zone le signalent. « Alertes seulement » ne garde que ce chemin.
3. On place le démarrage du gros œuvre après le démarrage des travaux de Structure : le niveau signale un retard Synthèse.
4. Dans le planning Global, les boutons « Editer », « Durées » et « Lien Structure » ne sont pas proposés, et aucune modification n'est possible. Un second clic sur « Global » ramène au planning du service.

## 7. Livrable

- La version 2 complète, en un seul fichier Word, avec la même mise en page que la version 1 : sommaire mis à jour, titres numérotés, tableau des versions complété, les six images en place (A, B, C, D, E, F).
- Crée réellement le fichier et donne-moi le lien pour le télécharger ; ne colle pas le contenu dans la conversation.
- Avant de me le remettre, rouvre-le pour vérifier que tout y est. Relis ensuite les passages nouveaux avec les yeux d'un lecteur qui ne sait rien de moi : rien ne doit laisser penser que l'évolution existe déjà, et chaque nouvelle image doit être présentée comme une maquette.
- Si tu ne peux pas lire la version 1 jointe, créer un fichier Word ou y insérer les images, dis-le tout de suite, avant de rédiger.
- Dans la conversation, et non dans le document, termine par la liste des changements faits et celle des points marqués « à préciser ».
