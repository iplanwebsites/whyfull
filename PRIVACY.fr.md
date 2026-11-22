# Whyfull Avis de confidentialité

Version 1.0 · En vigueur le [EFFECTIVE DATE]

> **Ébauche : doit être révisée par un avocat avant le lancement.** La date
> d’entrée en vigueur reste vide à dessein jusqu’à l’approbation de cet avis.
> Les points à réviser sont énumérés au début de la version anglaise
> (`PRIVACY.md`).

## En bref

- **La CLI et l’application de bureau Whyfull ne recueillent rien.** Aucune
  télémétrie, aucune donnée analytique, aucun rapport de plantage, aucun
  résultat d’analyse, aucune vérification de licence à distance.
- **L’achat d’une licence** ne conserve que ce dont nous avons besoin pour la
  remettre et la récupérer : votre adresse courriel, votre nom si vous le
  fournissez, l’identifiant et la clé de licence, les identifiants de commande
  Stripe et la date d’émission.
- **Stripe traite votre paiement** à titre de marchand officiel, selon sa
  propre politique de confidentialité. Nous ne voyons jamais les données de
  votre carte.
- **Nous ne vendons jamais vos données** et ne les utilisons jamais à des fins
  publicitaires.

## 1. Responsable

Felix Menard, un particulier exerçant ses activités à Montréal (Québec),
Canada (« nous »), est responsable des renseignements personnels décrits dans
le présent avis.

Felix Menard est aussi la personne responsable de la protection des
renseignements personnels au sens de la Loi sur la protection des
renseignements personnels dans le secteur privé du Québec. Pour le joindre :
support@whyfull.app.

## 2. Le logiciel : CLI et application de bureau

Whyfull fonctionne sur votre ordinateur. Les analyses, les rapports, les
réglages, les règles Conserver/Exclure et les caches sont conservés
localement (par exemple dans `~/.config/whyfull`) et ne nous sont jamais
envoyés.

- **Aucune télémétrie ni donnée analytique.** Le logiciel ne signale ni
  l’utilisation, ni les erreurs, ni les chemins de fichiers, ni quoi que ce
  soit au sujet de votre disque.
- **Vérification de licence hors ligne.** Les clés de licence sont vérifiées
  sur votre ordinateur au moyen d’une clé publique intégrée à l’application.
  La saisie d’une clé n’envoie rien.
- **Recherche de mises à jour.** L’application de bureau recherche les mises
  à jour en téléchargeant un manifeste de version depuis GitHub, et
  télécharge les mises à jour depuis GitHub lorsque vous choisissez de les
  installer. Comme pour tout téléchargement, GitHub reçoit votre adresse IP et
  les renseignements usuels de la requête, selon sa propre politique de
  confidentialité. Ces requêtes ne contiennent aucun identifiant provenant de
  Whyfull.
- **Liens que vous ouvrez.** Si vous ouvrez un lien depuis l’application (par
  exemple pour acheter une licence), votre navigateur visite cette page, et la
  section sur le site Web ci-dessous s’applique.
- **Rapports que vous communiquez.** Si vous remettez un rapport à un agent
  IA ou à une autre personne, ce qu’il en advient relève de votre choix et des
  conditions de ce tiers, et non des nôtres.

## 3. Le site Web et les achats

### Paiements : Stripe, marchand officiel

Les licences sont vendues par l’intermédiaire de Stripe Managed Payments.
Stripe est le marchand officiel de votre achat : elle perçoit votre paiement,
calcule et remet les taxes de vente ou la TVA, émet les reçus et les factures,
et traite les remboursements et les litiges. À cette fin, Stripe recueille et
utilise les données de votre moyen de paiement, votre adresse de facturation,
votre lieu d’imposition et les renseignements connexes à titre de
responsable indépendant, selon sa propre politique de confidentialité
(https://stripe.com/privacy). Les numéros de carte et les autres données de
paiement sont saisis directement auprès de Stripe; nous ne les recevons ni ne
les conservons jamais.

### Ce que nous recevons et conservons

Après un achat, Stripe nous transmet les renseignements suivants, que nous
conservons :

- votre **adresse courriel** (pour vous envoyer et vous permettre de récupérer
  votre clé de licence);
- votre **nom**, si vous le fournissez (il peut figurer dans la clé de
  licence);
- l’**identifiant de licence**, la **clé de licence** et la **date
  d’émission**;
- les **identifiants de commande Stripe** (session de paiement, client et
  paiement), ainsi que le montant et la devise payés, pour faire le lien avec
  les remboursements et répondre aux demandes de soutien;
- si et quand le courriel de licence a été envoyé, et si et quand l’achat a
  été remboursé.

Lorsque vous utilisez la page de récupération de licence, nous utilisons
l’adresse courriel que vous saisissez pour rechercher vos licences et vous
envoyer un courriel de récupération à cette adresse.

Pour limiter les abus des pages de licence et de récupération, nous
conservons des compteurs de courte durée indexés par une empreinte à sens
unique (SHA-256) de votre adresse IP et, pour la page de récupération, de
l’adresse courriel saisie. L’adresse IP et l’adresse courriel elles-mêmes ne
sont pas conservées dans ces compteurs.

Lorsque vous visitez whyfull.app, notre hébergeur traite des données
techniques usuelles (comme l’adresse IP, l’agent utilisateur et l’adresse de
la page demandée) pour diffuser et protéger le site. Nous n’utilisons sur
whyfull.app aucun témoin (cookie) publicitaire ni de suivi intersites.

La page `/activate` lit la clé de licence dans la partie du lien qui suit le
`#`, que les navigateurs n’envoient pas au serveur; la clé n’est donc pas
journalisée par le site Web.

### Pourquoi nous les utilisons

Pour vous fournir ce que vous avez acheté (émission, envoi et récupération
des clés de licence), pour faire le lien avec les remboursements, pour
prévenir la fraude et les abus, et pour répondre aux demandes de soutien. Dans
l’Union européenne et au Royaume-Uni, les fondements juridiques sont
l’exécution de notre contrat avec vous (émission et récupération des
licences), nos intérêts légitimes (prévention des abus, soutien) et le
respect de nos obligations légales.

## 4. Fournisseurs de services

| Fournisseur                        | Rôle                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| **Stripe** (indépendant)           | Marchand officiel : paiement, taxes, reçus, remboursements et litiges                      |
| **Cloudflare** (sous-traitant)     | Hébergement de whyfull.app et stockage des dossiers de licence                             |
| **Resend** (sous-traitant)         | Envoi des courriels de licence et de récupération (reçoit courriel, nom et clé de licence) |
| **GitHub** (indépendant, pas nous) | Hébergement des téléchargements, des versions et des manifestes de mise à jour             |

Les sous-traitants traitent les données uniquement pour notre compte et selon
nos instructions. Ces fournisseurs peuvent conserver ou traiter des données à
l’extérieur du Québec et du Canada, notamment aux États-Unis, selon les
garanties qu’ils offrent (par exemple des clauses contractuelles types). Nous
pouvons aussi communiquer des données lorsque la loi l’exige.

## 5. Durée de conservation

- **Les dossiers de licence** (section 3) sont conservés pour que vous
  puissiez récupérer votre clé en tout temps, jusqu’à ce que vous nous
  demandiez de les supprimer. Les achats remboursés demeurent dans les
  dossiers, marqués comme remboursés.
- **Les compteurs de prévention des abus** expirent après 10 minutes (page de
  licence) ou une heure (page de récupération), et les compteurs expirés sont
  supprimés automatiquement.
- **Les dossiers de paiement, de taxes et de facturation** sont conservés par
  Stripe selon ses propres politiques de conservation.
- **Les courriels** envoyés par Resend et les journaux de serveur de notre
  hébergeur sont conservés selon les règles de conservation de courte durée
  de ces fournisseurs.

## 6. Vos droits

Selon votre lieu de résidence, vous pouvez avoir le droit d’accéder à vos
renseignements personnels, de les faire rectifier, supprimer ou exporter, de
retirer votre consentement, de vous opposer à leur traitement ou d’en
demander la limitation, et de porter plainte auprès d’une autorité de
protection des données. Au Québec, il s’agit de la Commission d’accès à
l’information; au Canada, du Commissariat à la protection de la vie privée du
Canada. Pour exercer ces droits, écrivez à support@whyfull.app. Nous
répondons dans un délai de 30 jours. Si vous nous demandez de supprimer votre
dossier d’achat, nous ne pourrons plus récupérer votre clé de licence pour
vous. Les dossiers détenus par Stripe à titre de marchand officiel sont régis
par la politique de confidentialité de Stripe; nous pouvons vous aider à
joindre Stripe.

## 7. Enfants

Whyfull ne s’adresse pas aux enfants, et nous ne recueillons pas sciemment de
données sur des enfants.

## 8. Modifications

Nous publierons les modifications du présent avis à l’adresse
https://whyfull.app/legal/fr/#confidentialite, avec une nouvelle date
d’entrée en vigueur.

## 9. Langue

Le présent avis est offert en français (`PRIVACY.fr.md`, aussi à l’adresse
https://whyfull.app/legal/fr/#confidentialite) et en anglais (`PRIVACY.md`).
En cas de divergence, la version française prévaut pour les personnes au
Québec, et la version anglaise prévaut pour toutes les autres personnes.

## 10. Nous joindre

Felix Menard, Montréal (Québec), Canada · support@whyfull.app
