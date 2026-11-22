# Whyfull Contrat de licence d’utilisateur final

Version 1.0 · En vigueur le [EFFECTIVE DATE]

> **Ébauche : doit être révisée par un avocat avant le lancement.** Ce contrat
> n’a pas encore été révisé par un avocat. La date d’entrée en vigueur reste
> vide à dessein jusqu’à son approbation. Les points à réviser sont énumérés
> au début de la version anglaise (`EULA.md`).

## Résumé en langage clair (sans valeur juridique)

Ce résumé vous aide à lire le contrat. Il n’en fait pas partie; en cas de
différence, les articles numérotés ci-dessous s’appliquent.

- **La ligne de commande est gratuite.** Utilisez `whyfull` depuis npm,
  `npx whyfull`, les archives autonomes de la CLI ou la CLI fournie avec
  l’application de bureau, pour un usage personnel ou commercial, sans clé.
- **L’application de bureau s’évalue gratuitement pendant 30 jours.** Seuls
  les jours où vous ouvrez l’application sont comptés. Après 30 jours
  d’utilisation, vous continuez à l’utiliser en achetant une licence :
  **19 $ US, une seule fois**, pour vous, sur tous vos ordinateurs, mises à
  jour comprises.
- **Rien n’est bloqué.** L’application continue de fonctionner après la
  période d’évaluation et affiche un rappel au plus une fois par jour. C’est
  voulu, mais ce n’est pas une permission : le contrat vous demande quand même
  d’acheter une licence pour continuer à utiliser l’application.
- **Stripe vend, nous accordons la licence.** Stripe gère le paiement à titre
  de marchand officiel : paiement, taxes de vente, reçus et remboursements. La
  licence elle-même vient de nous.
- **Remboursement dans les 30 jours**, sans justification.
- **Whyfull n’envoie rien à votre sujet, nulle part.** Aucune télémétrie,
  aucune vérification de licence par le réseau.
- **C’est vous qui décidez quoi nettoyer.** Whyfull ne supprime jamais rien de
  lui-même. Lorsque vous choisissez de mettre des fichiers à la corbeille ou
  de lancer la commande de nettoyage d’un outil, c’est votre action. Gardez
  des copies de sauvegarde.
- **Fourni tel quel. Utilisation à vos propres risques.** Whyfull est fourni
  sans aucune garantie. Ses tailles, ses estimations et ses étiquettes
  « sûr » sont données au mieux et peuvent être inexactes. C’est vous qui
  décidez quoi supprimer ou lancer, et il vous revient de vérifier d’abord et
  de garder des sauvegardes.
- **Aucune responsabilité au-delà de ce que vous avez payé.** Dans la mesure
  permise par la loi, nous ne sommes pas responsables des fichiers perdus ni
  de tout autre problème que Whyfull pourrait causer, et le maximum que nous
  pourrions vous devoir est ce que vous avez payé pour votre licence : rien
  pour la CLI gratuite. Les droits que vous accorde le droit de la
  consommation ne peuvent pas vous être retirés et demeurent.

## 1. Les parties au contrat

Le présent contrat de licence d’utilisateur final (le « Contrat ») est conclu
entre vous et Felix Menard, un particulier exerçant ses activités à Montréal
(Québec), Canada (« nous », « le Concédant »). « Vous » désigne la personne
qui utilise Whyfull ou, si vous acceptez au nom d’une entreprise ou d’une
autre organisation, à la fois vous et cette organisation. Si vous acceptez
pour une organisation, vous confirmez avoir le pouvoir de l’engager.

En installant, en copiant, en ouvrant ou en utilisant autrement Whyfull, vous
acceptez le présent Contrat. Si vous ne l’acceptez pas, n’installez pas et
n’utilisez pas Whyfull.

## 2. Définitions

- **« Whyfull »** ou **« le Logiciel »** désigne le logiciel Whyfull sous
  forme de code objet et de code source, y compris la CLI, l’application de
  bureau, le visualiseur dans le navigateur, le catalogue d’emplacements, la
  documentation et toute mise à jour que nous fournissons, à l’exclusion des
  Composants tiers.
- **« CLI »** désigne l’interface en ligne de commande de Whyfull, quelle que
  soit la façon dont elle est obtenue : le paquet npm `whyfull` (y compris
  lorsqu’il est lancé avec `npx`), les archives autonomes de la CLI et l’outil
  en ligne de commande fourni avec l’application de bureau (la commande
  `whyfull --cli` et le lanceur que l’application installe). Elle comprend le
  visualiseur dans le navigateur lancé depuis la CLI (par exemple
  `whyfull --ui`).
- **« Application de bureau »** désigne l’application graphique Whyfull
  distribuée sous forme d’installateur ou de paquet pour ordinateur (par
  exemple un fichier `.dmg`, `.exe`, `.AppImage` ou `.deb`), à l’exclusion de
  la CLI qui l’accompagne.
- **« Jour d’utilisation »** désigne un jour civil, selon l’heure locale de
  votre ordinateur, au cours duquel l’Application de bureau est ouverte au
  moins une fois.
- **« Clé de licence »** désigne une clé que nous vous remettons après l’achat
  et qui identifie votre licence de l’Application de bureau.
- **« Composants tiers »** désigne les logiciels appartenant à d’autres et
  inclus avec Whyfull, comme l’environnement d’exécution Node.js et les
  dépendances npm.

## 3. La CLI : gratuite pour un usage personnel et commercial

Sous réserve du présent Contrat, nous vous accordons une licence non
exclusive, non transférable, sans droit de sous-licence, gratuite et
mondiale vous permettant d’installer et d’utiliser la CLI sur autant
d’ordinateurs que vous utilisez ou administrez, à des fins personnelles ou
commerciales, y compris dans des scripts, en intégration continue et avec des
agents de programmation IA. Aucune Clé de licence n’est nécessaire pour la
CLI.

Cette licence permet d’_utiliser_ la CLI. Elle ne vous permet pas de
redistribuer, de modifier ou de réutiliser son code ou son catalogue; ces
actes sont régis par la Licence Whyfull à code source disponible
(article 6). Vous pouvez toutefois installer la CLI à partir du paquet npm
officiel comme dépendance de vos propres projets ou configurations, de sorte
que vos utilisateurs la téléchargent eux-mêmes depuis npm.

## 4. L’Application de bureau : évaluation, puis licence payante

### 4.1 Évaluation

Vous pouvez utiliser gratuitement l’Application de bureau à des fins
d’évaluation pendant 30 Jours d’utilisation (la « Période d’évaluation »). Les
jours où vous n’ouvrez pas l’Application de bureau ne sont pas comptés. La
Période d’évaluation s’applique une seule fois par personne, et non une fois
par ordinateur ou par réinstallation.

### 4.2 Licence requise après la Période d’évaluation

Après la Période d’évaluation, il vous faut une licence payante pour
continuer à utiliser l’Application de bureau. Si vous ne voulez pas en
acheter une, vous devez cesser d’utiliser l’Application de bureau; vous
pouvez continuer à utiliser gratuitement la CLI.

### 4.3 Ce que comprend une licence

Une licence de l’Application de bureau, une fois payée, est :

- **Unique :** un seul paiement de 19 $ US (plus les taxes applicables), sans
  abonnement.
- **Perpétuelle :** elle n’expire pas, sous réserve de l’article 13
  (Résiliation).
- **Personnelle :** elle est réservée à une personne nommée. Cette personne
  peut utiliser l’Application de bureau sur tous les ordinateurs qu’elle
  utilise personnellement, au travail comme à la maison. Elle ne peut pas être
  partagée avec d’autres personnes ni utilisée par elles.
- **Mises à jour comprises :** elle couvre les mises à jour de l’Application
  de bureau que nous publions pour la version majeure achetée, ainsi que les
  versions ultérieures que nous choisissons d’inclure.

Nous pourrions à l’avenir offrir une nouvelle version majeure à titre de mise
à niveau payante. Le cas échéant, nous l’annoncerons à l’avance, et votre
licence existante continuera de fonctionner avec toutes les versions qu’elle
couvre déjà. Nous ne sommes pas tenus de publier des mises à jour ni de
nouvelles versions.

Les prix peuvent changer pour les achats futurs. Un changement de prix
n’affecte jamais une licence que vous avez déjà achetée.

### 4.4 Entreprises et équipes

Une organisation a besoin d’une licence pour chaque personne qui utilise
l’Application de bureau. Une licence achetée par une organisation peut être
attribuée à une personne à la fois et réattribuée lorsque cette personne
n’utilise plus l’Application de bureau (par exemple lorsqu’elle quitte
l’équipe), mais elle ne peut pas servir à couvrir des personnes à tour de
rôle ou de façon partagée. Pour les achats en volume ou d’autres conditions,
écrivez à support@whyfull.app.

### 4.5 Système d’honneur et rappels

L’Application de bureau ne bloque aucune fonction, ne cesse pas de
fonctionner et ne vérifie pas votre licence par le réseau. Après la Période
d’évaluation, elle affiche un rappel, au plus une fois par jour après une
analyse, jusqu’à ce qu’une Clé de licence soit saisie.

**L’absence de contrôle technique n’est pas une permission.** Continuer à
utiliser l’Application de bureau après la Période d’évaluation sans licence
constitue un manquement au présent Contrat, que le Logiciel le détecte ou non
et qu’il affiche ou non un rappel, et que vous utilisiez une version
officielle ou une version compilée par vous à partir du code source.

### 4.6 Clés de licence

Les Clés de licence sont personnelles et confidentielles pour la personne
titulaire de la licence. Ne les publiez pas, ne les partagez pas, ne les
vendez pas et ne les transférez pas, et ne créez, ne modifiez ni ne
contrefaites aucune Clé de licence. Nous pouvons révoquer une Clé de licence
générée ou obtenue frauduleusement, remboursée ou ayant fait l’objet d’une
rétrofacturation, ou partagée en violation du présent Contrat. Si vous perdez
votre clé, vous pouvez la récupérer à l’adresse https://whyfull.app/recover/.

### 4.7 Aucune vérification

Nous ne vérifierons pas vos ordinateurs et ne vous demanderons pas de
déclarer votre utilisation. Nous comptons sur vous pour acheter les licences
dont vous avez besoin. Cela ne limite pas nos recours si nous apprenons qu’il
y a eu manquement.

## 5. Achat, prix, taxes et remboursements

### 5.1 Qui vend et qui accorde la licence

Les licences de l’Application de bureau sont vendues par l’intermédiaire de
Stripe Managed Payments. Pour l’opération d’achat, Stripe (la société Stripe
nommée lors du paiement et sur votre reçu) agit à titre de revendeur et de
marchand officiel : elle vous vend la licence, perçoit votre paiement,
calcule, perçoit et remet les taxes de vente, la TVA ou la TPS applicables,
émet votre reçu ou votre facture, et traite les remboursements, les
rétrofacturations et les litiges de paiement, selon ses propres conditions
présentées lors du paiement.

Nous sommes le concédant. Le droit d’utiliser l’Application de bureau vous est
accordé par nous en vertu du présent Contrat, et nous demeurons responsables
du Logiciel, des Clés de licence et du soutien. Les conditions de Stripe
régissent l’opération d’achat; le présent Contrat régit votre utilisation de
Whyfull.

### 5.2 Prix et taxes

Une licence de l’Application de bureau coûte 19 $ US. Stripe affiche les taxes
applicables selon votre lieu de résidence, ainsi que le total à payer, lors
du paiement et avant que vous confirmiez l’achat. Vous autorisez le montant
total affiché lors du paiement. Votre banque ou l’émetteur de votre carte
peut exiger ses propres frais de conversion de devises.

### 5.3 Remboursements

Si Whyfull ne vous convient pas, vous pouvez demander un remboursement
complet dans les 30 jours suivant l’achat, pour quelque raison que ce soit,
en écrivant à support@whyfull.app ou en utilisant les coordonnées indiquées
sur votre reçu. Les remboursements sont traités par Stripe et versés sur votre
moyen de paiement initial. Lorsqu’un achat est remboursé, la licence et la
Clé de licence correspondantes prennent fin, et vous devez cesser d’utiliser
l’Application de bureau au-delà de la Période d’évaluation. Cela ne limite
aucun droit que la loi vous accorde en matière de remboursement,
d’annulation ou de rétractation.

## 6. Code source et licence à code source disponible

Le code source de Whyfull est public pour que vous puissiez voir exactement
ce qu’il fait. L’accès au code source est régi par la Licence Whyfull à code
source disponible (le fichier `LICENSE`, en anglais), qui vous permet de le
lire, de l’examiner et d’y contribuer, mais non de le copier, de le modifier,
de le redistribuer ou de le réutiliser. Le fait de consulter ou de compiler le
code source ne vous donne aucun droit supplémentaire d’utiliser l’Application
de bureau : une version que vous compilez vous-même est soumise aux mêmes
conditions d’évaluation et de licence qu’une version officielle.

## 7. Restrictions

Sauf dans la mesure expressément permise par le présent Contrat ou par la
Licence à code source disponible, vous ne pouvez pas :

1. copier, modifier, adapter ou traduire Whyfull, ni en créer des œuvres
   dérivées;
2. distribuer, vendre, louer, prêter, sous-licencier ou héberger Whyfull, ni
   le rendre autrement accessible à d’autres, y compris dans le cadre d’un
   autre produit ou service, ou d’un service hébergé ou géré;
3. distribuer une version de l’Application de bureau dont les rappels
   d’évaluation ou de licence ont été retirés ou désactivés, ni distribuer des
   Clés de licence ou des outils qui en génèrent;
4. réutiliser le catalogue d’emplacements ou la documentation dans un autre
   produit;
5. retirer ou modifier tout avis de droit d’auteur, de marque de commerce ou
   de licence;
6. utiliser Whyfull en contravention d’une loi applicable.

Le présent article ne vous empêche pas de faire ce que la loi applicable
permet expressément malgré une restriction contractuelle (par exemple une
rétro-ingénierie limitée à des fins d’interopérabilité, là où la loi le
permet).

## 8. Comment Whyfull traite vos fichiers

Vous devriez comprendre ce qui suit avant d’utiliser Whyfull :

1. **Whyfull lit votre disque.** Il analyse les dossiers que vous choisissez,
   ou des emplacements par défaut, et rapporte des tailles, des chemins de
   fichiers et des suggestions de nettoyage. Les rapports et les caches sont
   conservés sur votre ordinateur.
2. **Whyfull ne supprime jamais rien automatiquement.** L’analyse et les
   rapports ne modifient pas vos fichiers. Le nettoyage n’a lieu que lorsque
   vous le demandez explicitement.
3. **Le nettoyage est votre action.** Lorsque vous choisissez de mettre des
   éléments à la corbeille, de lancer une commande de nettoyage recommandée
   pour l’outil à qui appartiennent les données (par exemple un gestionnaire
   de paquets, un outil de conteneurs ou un exécuteur de modèles) ou de suivre
   toute autre suggestion, c’est vous qui déclenchez cette action. Des
   étiquettes comme « sûr », « reconstructible » ou « cache » sont des
   indications données au mieux, fondées sur une connaissance générale du
   comportement d’autres logiciels; elles peuvent être inexactes pour votre
   configuration, et ces autres logiciels peuvent changer sans préavis.
4. **La corbeille n’est pas une sauvegarde.** Les éléments mis à la corbeille
   peuvent être supprimés définitivement par votre système d’exploitation, par
   vous ou par d’autres logiciels, et les commandes de nettoyage des outils
   concernés peuvent supprimer des données définitivement. Certaines données
   supprimées (par exemple des modèles d’IA ou des caches téléchargés) peuvent
   être volumineuses ou longues à restaurer, et d’autres (par exemple du
   travail non validé dans un arbre de travail git) peuvent ne pas pouvoir
   être restaurées du tout.
5. **Vous êtes responsable de vos données.** Il vous appartient de vérifier ce
   que vous nettoyez, de conserver des sauvegardes à jour de tout ce qui
   compte pour vous, et d’assumer toute perte de données, de temps, de travail
   ou de configuration découlant d’un nettoyage que vous déclenchez.
6. **Les rapports peuvent contenir des renseignements privés.** Les chemins
   de fichiers et les noms de projets peuvent être sensibles. C’est vous qui
   décidez de communiquer ou non un rapport, par exemple à un agent IA ou à
   une autre personne, et il vous revient de garder les rapports, les caches
   et le visualiseur local hors de la portée des personnes à qui vous ne
   voulez pas les montrer.
7. **C’est à vous de vérifier les commandes et les agents IA.** Whyfull peut
   afficher des commandes de nettoyage, ou produire des rapports que vous
   confiez à un agent de programmation IA, à un script ou à un autre outil.
   La décision de lancer une commande, et ce qu’un agent IA ou un autre
   outil fait d’un rapport de Whyfull, relèvent de vous et de votre
   responsabilité. Lisez chaque commande, et vérifiez chaque fichier ou
   dossier, avant de lancer, de supprimer ou de laisser quoi que ce soit
   d’autre supprimer.
8. **Vous utilisez Whyfull à vos propres risques.** Vous assumez tous les
   risques liés à l’utilisation de Whyfull et aux suites que vous donnez à
   ses résultats, y compris le risque qu’une taille, une estimation, un
   propriétaire ou une étiquette soit inexact, qu’un nettoyage supprime
   quelque chose dont vous aviez besoin, ou qu’un autre programme se
   comporte autrement que ce que prévoit Whyfull.

## 9. Absence de garantie : Whyfull est fourni tel quel

_Consommateurs du Québec : le présent article ne s’applique pas à vous dans
la mesure où la Loi sur la protection du consommateur ou le Code civil du
Québec l’interdit, notamment en ce qui concerne les garanties légales de
qualité et de conformité, que le présent Contrat n’exclut pas._

DANS TOUTE LA MESURE PERMISE PAR LA LOI APPLICABLE, WHYFULL, Y COMPRIS LA
CLI, L’APPLICATION DE BUREAU, LE VISUALISEUR DANS LE NAVIGATEUR, LE
CATALOGUE D’EMPLACEMENTS, SES RAPPORTS ET TOUTE COMMANDE QU’IL AFFICHE OU
SUGGÈRE, EST FOURNI « TEL QUEL » ET « SELON SA DISPONIBILITÉ », AVEC TOUS
SES DÉFAUTS, ET SANS GARANTIE NI CONDITION D’AUCUNE SORTE, QU’ELLE SOIT
EXPRESSE, IMPLICITE, LÉGALE OU DÉCOULANT DES RAPPORTS D’AFFAIRES OU DES
USAGES DU COMMERCE. NOUS DÉCLINONS TOUTE GARANTIE ET TOUTE CONDITION,
NOTAMMENT TOUTE GARANTIE OU CONDITION :

1. DE QUALITÉ MARCHANDE, DE QUALITÉ SATISFAISANTE, D’ADAPTATION À UN USAGE
   PARTICULIER, D’EXACTITUDE, DE JOUISSANCE PAISIBLE, DE TITRE OU D’ABSENCE
   DE CONTREFAÇON;
2. QU’UNE TAILLE, UN NOMBRE DE FICHIERS, UNE ESTIMATION DE L’ESPACE
   RÉCUPÉRABLE, UN PROPRIÉTAIRE, UNE CLASSIFICATION OU UNE ÉTIQUETTE (COMME
   « SÛR », « PEUT ÊTRE SUPPRIMÉ SANS RISQUE », « RECONSTRUCTIBLE » OU
   « CACHE ») EST EXACT, COMPLET OU ADAPTÉ À VOTRE SYSTÈME;
3. QU’UN NETTOYAGE OU UNE COMMANDE SUGGÉRÉS SONT SANS DANGER OU N’AURONT QUE
   L’EFFET DÉCRIT;
4. QUE WHYFULL FONCTIONNERA SANS INTERRUPTION, EN TEMPS VOULU, DE FAÇON
   SÉCURITAIRE OU SANS ERREUR, QUE LES DÉFAUTS SERONT CORRIGÉS OU QU’IL
   RÉPONDRA À VOS BESOINS;
5. QUE WHYFULL SERA COMPATIBLE AVEC TOUT SYSTÈME D’EXPLOITATION, SYSTÈME DE
   FICHIERS, DISQUE, DOSSIER SYNCHRONISÉ OU RÉSEAU, OU OUTIL TIERS, OU QU’IL
   Y FONCTIONNERA CORRECTEMENT, MAINTENANT OU APRÈS UNE MODIFICATION DE
   L’UN D’EUX;
6. VISANT LES COMPOSANTS TIERS (COMME L’ENVIRONNEMENT D’EXÉCUTION NODE.JS
   FOURNI) OU TOUT OUTIL TIERS DONT VOUS LANCEZ LA COMMANDE DE NETTOYAGE.

AUCUN CONSEIL NI AUCUNE INFORMATION, ORAUX OU ÉCRITS, OBTENUS DE NOUS OU AU
MOYEN DE WHYFULL NE CRÉENT UNE GARANTIE QUI N’EST PAS EXPRESSÉMENT PRÉVUE AU
PRÉSENT CONTRAT. VOUS UTILISEZ WHYFULL, ET DONNEZ SUITE À SES RÉSULTATS, À
VOS PROPRES RISQUES, ET VOUS ASSUMEZ L’ENTIER RISQUE QUANT À SA QUALITÉ, À
SES RÉSULTATS ET À SON RENDEMENT. Le présent article est soumis au dernier
paragraphe de l’article 10.

## 10. Limitation de responsabilité

_Consommateurs du Québec : le présent article ne s’applique pas à vous dans
la mesure où la Loi sur la protection du consommateur ou le Code civil du
Québec l’interdit, notamment lorsqu’il aurait pour effet d’exclure ou de
limiter notre responsabilité pour nos propres actes ou ceux de nos
représentants._

DANS TOUTE LA MESURE PERMISE PAR LA LOI APPLICABLE, ET QUEL QUE SOIT LE
FONDEMENT DE LA RESPONSABILITÉ (CONTRACTUELLE OU EXTRACONTRACTUELLE,
NOTAMMENT POUR NÉGLIGENCE, RESPONSABILITÉ SANS FAUTE OU AUTREMENT) :

1. NOUS NE SERONS PAS RESPONSABLES DES DOMMAGES INDIRECTS, ACCESSOIRES,
   SPÉCIAUX, CONSÉCUTIFS, EXEMPLAIRES OU PUNITIFS, QUELLE QU’EN SOIT LA
   CAUSE, MÊME SI NOUS AVONS ÉTÉ AVISÉS DE LA POSSIBILITÉ DE TELS DOMMAGES
   OU S’ILS ÉTAIENT PRÉVISIBLES.
2. NOUS NE SERONS PAS RESPONSABLES DE LA PERTE OU DE L’ENDOMMAGEMENT DE
   DONNÉES, DE FICHIERS, DE DOSSIERS, DE PROJETS, DE DÉPÔTS OU D’ARBRES DE
   TRAVAIL GIT, DE MODÈLES, DE CACHES DE COMPILATION, DE CONFIGURATIONS OU
   DE PARAMÈTRES; DE TOUTE INSTABILITÉ DU SYSTÈME, PANNE, LENTEUR OU
   IMPOSSIBILITÉ DE DÉMARRER; DE TOUTE PERTE DE TRAVAIL, DE TEMPS, DE
   PROFITS, DE REVENUS, D’ACTIVITÉS, D’ACHALANDAGE OU D’USAGE; NI DES COÛTS
   DE RÉCUPÉRATION, DE RESTAURATION, DE NOUVEAU TÉLÉCHARGEMENT, DE
   RECOMPILATION, DE BANDE PASSANTE, DE REMPLACEMENT OU DE LOGICIEL DE
   SUBSTITUTION.
3. NOUS NE SERONS PAS RESPONSABLES DES CONSÉQUENCES D’UN NETTOYAGE OU DE
   TOUTE AUTRE ACTION QUE VOUS, OU UNE PERSONNE, UN SCRIPT OU UN AGENT IA
   AGISSANT POUR VOUS, ENTREPRENEZ EN VOUS FONDANT SUR WHYFULL OU SUR SES
   RÉSULTATS, Y COMPRIS LE FAIT DE METTRE DES ÉLÉMENTS À LA CORBEILLE, DE
   VIDER LA CORBEILLE OU DE LANCER UNE COMMANDE QUE WHYFULL AFFICHE OU
   SUGGÈRE, QUE WHYFULL L’AIT SUGGÉRÉ OU NON ET QU’IL AIT QUALIFIÉ
   L’ÉLÉMENT DE SÛR OU NON.
4. NOUS NE SERONS PAS RESPONSABLES DU COMPORTEMENT DES SYSTÈMES
   D’EXPLOITATION, DES OUTILS TIERS, DES AGENTS IA OU DES COMPOSANTS TIERS,
   NI DE TOUT INCIDENT DE SÉCURITÉ OU DE CONFIDENTIALITÉ DÉCOULANT D’UN
   RAPPORT, D’UN CACHE, D’UNE CAPTURE D’ÉCRAN OU D’UN AUTRE RÉSULTAT DE
   WHYFULL QUE VOUS COMMUNIQUEZ, TÉLÉVERSEZ OU LAISSEZ ACCESSIBLE À
   D’AUTRES.
5. NOTRE RESPONSABILITÉ TOTALE POUR L’ENSEMBLE DES RÉCLAMATIONS LIÉES À
   WHYFULL OU AU PRÉSENT CONTRAT, PRISES ENSEMBLE, NE DÉPASSERA PAS : (A)
   POUR LA CLI, LA PÉRIODE D’ÉVALUATION ET TOUTE AUTRE UTILISATION DE
   WHYFULL POUR LAQUELLE VOUS N’AVEZ RIEN PAYÉ, ZÉRO (0 $ US); (B) POUR UNE
   LICENCE PAYÉE DE L’APPLICATION DE BUREAU, LE MONTANT QUE VOUS AVEZ
   RÉELLEMENT PAYÉ POUR CETTE LICENCE AU COURS DES 12 MOIS PRÉCÉDANT LA
   RÉCLAMATION.

Ces exclusions et limites tiennent compte du fait que la CLI est gratuite et
que l’Application de bureau coûte peu, et elles s’appliquent même si un
recours n’atteint pas son but essentiel.

**Droits que la loi ne nous permet pas d’exclure.** Rien dans le présent
Contrat n’exclut ni ne limite une responsabilité, une garantie ou un droit
que la loi applicable ne permet pas d’exclure ou de limiter. Par exemple,
pour les consommateurs du Québec, il n’exclut ni ne limite notre
responsabilité pour le préjudice matériel causé par notre faute
intentionnelle ou lourde, ni pour le préjudice corporel ou moral
(article 1474 du Code civil du Québec), ni les garanties légales et les
autres protections de la Loi sur la protection du consommateur; les
consommateurs de l’Union européenne, du Royaume-Uni, de l’Australie et
d’ailleurs conservent les droits que leur accorde la loi; et rien ne limite
la responsabilité en cas de décès ou de préjudice corporel causé par une
négligence, ou en cas de fraude. Lorsqu’une telle loi s’applique, les
exclusions et limites des articles 9 et 10 s’appliquent dans toute la mesure
permise par cette loi.

## 11. Votre responsabilité envers nous

Dans la mesure permise par la loi, vous nous indemniserez des réclamations de
tiers découlant d’un manquement de votre part au présent Contrat ou d’une
utilisation de Whyfull contraire à la loi. Le présent article ne s’applique
pas aux consommateurs lorsque la loi l’interdit, y compris aux consommateurs
du Québec.

## 12. Confidentialité

La CLI et l’Application de bureau de Whyfull n’envoient aucune télémétrie,
aucune donnée analytique, aucun rapport de plantage, aucun résultat d’analyse
ni aucun chemin de fichier, ni à nous ni à qui que ce soit, et les Clés de
licence sont vérifiées hors ligne sur votre ordinateur. L’Application de
bureau peut rechercher et télécharger des mises à jour depuis GitHub, comme
lorsqu’on télécharge n’importe quel fichier sur Internet. Notre traitement
des données d’achat est décrit dans l’Avis de confidentialité
(`PRIVACY.fr.md`, aussi à l’adresse
https://whyfull.app/legal/fr/#confidentialite).

## 13. Résiliation

Le présent Contrat demeure en vigueur jusqu’à sa résiliation. Vous pouvez le
résilier à tout moment en désinstallant Whyfull et en supprimant vos copies.
Vos droits en vertu du présent Contrat prennent fin automatiquement, sans
préavis, si vous y manquez de façon importante (notamment en utilisant
l’Application de bureau au-delà de la Période d’évaluation sans licence et
sans en acheter une dans un délai raisonnable après que nous vous en avons
avisé). À la résiliation, vous devez cesser d’utiliser Whyfull et le
supprimer. La résiliation ne donne droit à aucun remboursement, sauf selon
l’article 5.3 ou lorsque la loi l’exige. Les articles 6 à 11 et 13 à 20
survivent à la résiliation.

## 14. Exportation et sanctions

Vous respecterez toutes les lois sur le contrôle des exportations et sur les
sanctions qui s’appliquent à votre utilisation de Whyfull. Vous confirmez que
vous n’êtes pas situé dans un pays ou une région visé par des sanctions
générales, ni résident d’un tel pays ou d’une telle région, et que vous ne
figurez sur aucune liste gouvernementale de personnes interdites ou visées par
des restrictions. Vous n’utiliserez ni n’exporterez Whyfull en contravention
de ces lois.

## 15. Composants tiers

Whyfull comprend des Composants tiers qui sont concédés sous leurs propres
conditions, énumérés dans le fichier `NOTICE` et dans les fichiers d’avis de
tiers fournis avec chaque version. Ces conditions régissent les Composants
tiers, et rien dans le présent Contrat ne limite les droits qu’elles vous
accordent.

## 16. Marques de commerce

« Whyfull », son logo et son icône sont des marques de commerce de Felix
Menard. Le présent Contrat n’accorde aucun droit sur celles-ci. Consultez
`TRADEMARKS.md` (en anglais).

## 17. Modifications du présent Contrat

Nous pouvons mettre à jour le présent Contrat de temps à autre et en
publierons la nouvelle version à l’adresse https://whyfull.app/legal/fr/,
avec une nouvelle date d’entrée en vigueur. Les modifications s’appliquent
aux versions de Whyfull publiées après la modification. La version du présent
Contrat fournie avec une version donnée de Whyfull, ou en vigueur lorsque vous
l’avez obtenue, continue de régir cette version, et une modification ne retire
jamais une licence perpétuelle que vous avez déjà achetée et ne réduit jamais
les versions qu’elle couvre.

## 18. Cession

Vous ne pouvez pas céder ni transférer le présent Contrat ou une licence, sauf
qu’une organisation peut réattribuer une licence entre les membres de son
personnel comme le prévoit l’article 4.4. Nous pouvons céder le présent
Contrat, par exemple dans le cadre d’une fusion, d’une acquisition ou de la
vente de l’entreprise Whyfull, à condition que le cessionnaire respecte les
licences existantes.

## 19. Droit applicable et litiges

Le présent Contrat est régi par les lois de la province de Québec et les lois
fédérales du Canada qui s’y appliquent, sans égard aux règles de conflit de
lois. La Convention des Nations Unies sur les contrats de vente
internationale de marchandises ne s’applique pas. Les tribunaux du district
judiciaire de Montréal (Québec) ont compétence exclusive, sauf que chaque
partie peut demander une injonction devant tout tribunal compétent.

Si vous êtes un consommateur, rien dans le présent article ne vous prive de
la protection des règles impératives de la loi de votre lieu de résidence, ni
du droit que cette loi vous accorde d’intenter une action devant les tribunaux
de votre lieu de résidence. Par exemple, les consommateurs du Québec
conservent les droits que leur accorde l’article 22.1 de la Loi sur la
protection du consommateur, et les consommateurs de l’Union européenne et du
Royaume-Uni conservent les protections de leur droit de la consommation.

## 20. Dispositions générales

- **Intégralité du contrat.** Le présent Contrat, avec la Licence à code
  source disponible et l’Avis de confidentialité, constitue l’entente
  intégrale entre vous et nous au sujet de Whyfull et remplace toute entente
  antérieure à ce sujet. Les conditions d’un bon de commande ou d’un autre
  document que vous nous envoyez ne s’appliquent pas.
- **Divisibilité.** Si une disposition est jugée invalide ou inapplicable,
  elle sera appliquée dans toute la mesure permise, et les autres
  dispositions demeurent en vigueur.
- **Absence de renonciation.** Le fait de ne pas faire respecter une
  disposition, ou de tarder à le faire, ne constitue pas une renonciation à
  celle-ci.
- **Versions antérieures.** Les versions de Whyfull publiées sous la licence
  Apache 2.0 avant l’entrée en vigueur des présentes conditions (npm
  `whyfull` 0.0.1 et 0.0.2 et Application de bureau 0.0.1) demeurent
  disponibles sous cette licence, telles qu’elles ont été publiées. Le présent
  Contrat s’applique aux versions ultérieures.
- **Langue.** Le présent Contrat est offert en français (`EULA.fr.md`, aussi à
  l’adresse https://whyfull.app/legal/fr/) et en anglais (`EULA.md`). La
  version française est mise à la disposition des consommateurs du Québec en
  premier, avant la version anglaise, et vous ne pouvez choisir d’être lié par
  la version anglaise qu’après que la version française vous a été remise.
  Les deux versions ont la même valeur juridique. En cas de divergence, la
  version française prévaut pour les consommateurs du Québec, et la version
  anglaise prévaut pour toutes les autres personnes.
- **Avis.** Nous pouvons vous envoyer des avis à l’adresse courriel associée
  à votre achat. Vous pouvez nous envoyer des avis à support@whyfull.app.

## 21. Nous joindre

Felix Menard, Montréal (Québec), Canada
Courriel : support@whyfull.app (questions juridiques, confidentialité,
soutien, sécurité et achats en volume)
Web : https://whyfull.app/legal/fr/
