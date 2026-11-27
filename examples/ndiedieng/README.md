# Prototype Ndiédieng : alertes sans internet et assistant territorial

*A prototype for the commune of Ndiédieng (Senegal), built with Kalangu: village
chiefs report breakdowns, births and deaths by USSD or SMS; the Mairie sees
them sorted and asks questions of its records. In French, for the commune.*

Les 58 chefs de village signalent une panne d'équipement, une naissance ou un
décès depuis n'importe quel téléphone, par code court USSD ou par SMS, sans
internet. Chaque signalement est classé (village, type d'équipement, urgence)
et apparaît au tableau de bord de la Mairie, qui le prend en charge ; le chef
reçoit un SMS à chaque étape. Le Maire, le BEL et l'ADL interrogent les fiches
et les signalements en français, et voient la requête derrière chaque chiffre.

> **Données fictives.** 58 villages (« Village 01 » …), 200 équipements et 499
> fiches générés pour la démonstration, et des numéros de téléphone qu'aucun
> opérateur n'utilise (+221 00 000 00 xx). Rien ne vient des fiches réelles de
> la commune.

## Essayer la démonstration

**En ligne, sans rien installer :** <https://kalangu.utachi.website/ndiedieng/>.
Tout tourne dans votre navigateur : Kalangu, la base SQLite de la commune
(compilée pour le navigateur, [sql.js](https://sql.js.org)) et l'API. Chaque
visiteur a sa propre démonstration, et rien n'est envoyé nulle part.

**Sur votre machine,** avec Node 22.13 ou plus récent et pnpm, depuis la
racine du dépôt :

```sh
pnpm install
pnpm build
pnpm --filter @kalangu/example-ndiedieng start
```

Puis ouvrez <http://localhost:3000> : la même page, servie par Node, qui
parle à l'API du serveur (et à Gemini ou à une vraie passerelle, ci-dessous).

- **À gauche, le téléphone d'un chef de village,** en trois modèles :
  *téléphone simple* (le plus courant dans les villages : écran, touches
  programmables, clavier ; le clavier de l'ordinateur marche quand il a le
  focus), *Android* et *iPhone* (composeur, fenêtre USSD de chaque système,
  application Messages). Composez `*123#` et suivez les menus. Au premier
  contact, le chef choisit sa langue (1. Français, 2. Wolof), retenue pour
  son numéro et modifiable par l'entrée 6 du menu ; ensuite, un code
  complet comme `*123*1*1*1*1#` fait tout d'un coup (panne, eau, forage,
  urgent). Dans Messages, écrivez directement votre signalement : il est
  classé et enregistré en un seul SMS. Un message court (« bonjour »,
  « menu ») renvoie le menu, puis `5` pour écrire librement.
- **Message vocal** (Android, iPhone) : le micro de Messages dicte un message,
  transcrit par le navigateur puis classé comme un SMS libre. C'est une
  simulation : en vrai, un message vocal passerait par l'opérateur et une
  transcription côté Mairie (phase 2 du projet), et la dictée du navigateur ne
  connaît que le français.
- **À droite, la Mairie.** Les signalements arrivent triés par urgence, avec
  recherche et filtres par statut, par catégorie et « urgents ». Un clic sur
  un signalement l'ouvre : on change sa catégorie, son équipement, son
  urgence, son statut ou sa description, ou on le supprime ; « + Nouveau »
  en crée un (après un appel, par exemple). Passer un signalement « En
  cours » ou « Résolu » envoie un SMS au chef, qui arrive dans le téléphone
  de gauche. Un message ambigu arrive « À vérifier ».
- **L'assistant territorial,** sur sa propre page (bouton « Assistant ») :
  on touche l'orbe et on parle, la réponse est lue (« Voix ») ou seulement
  écrite (« Texte ») ; le clavier permet aussi de l'écrire. Le micro dicte la
  question, et la réponse est lue à voix haute (ou à la demande avec
  « Écouter », ou toujours avec « Réponses à voix haute »). « Données
  utilisées » montre la requête SQL et les lignes derrière chaque chiffre.

La dictée demande un navigateur qui la propose (Chrome, Edge, Safari) et
l'accord du micro ; ailleurs, le bouton est désactivé et le dit.

## Avec l'IA de Gemini

Sans clé, le classement des SMS se fait par mots-clés et l'assistant reconnaît
les questions courantes. Avec une clé [Google AI Studio](https://aistudio.google.com/apikey) :

```sh
read -s GEMINI_API_KEY && export GEMINI_API_KEY   # collez la clé ; rien ne s'affiche
pnpm --filter @kalangu/example-ndiedieng start
```

- les SMS sont classés par Gemini dans un format imposé (catégorie, équipement,
  urgence, confiance), avec retour aux mots-clés en cas d'échec ;
- l'assistant répond aux questions libres : Gemini écrit la requête, qui
  n'est exécutée qu'après vérification (une seule requête `SELECT`) et sur une
  connexion **en lecture seule** ; Gemini rédige ensuite la réponse à partir
  des seules lignes obtenues.

Seuls le texte du SMS et la question partent chez Google, jamais un numéro de
téléphone. Ne collez jamais la clé dans une conversation ni dans un fichier du
dépôt.

## En wolof

Tout ce que voit un chef (menus USSD, réponses, SMS de la Mairie) existe en
français et en wolof, dans [src/strings.ts](src/strings.ts). Le tableau de
bord de la Mairie reste en français. **Le wolof est un brouillon, pas encore
relu par un locuteur** : à relire avant les essais sur le terrain.

Pour relire : ouvrez [wolof-review.csv](wolof-review.csv) dans un tableur
(une ligne par texte : français, brouillon wolof, correction), corrigez, puis
reportez les corrections dans `src/strings.ts` (gardez chaque `{code}`,
`{what}`…) et régénérez la feuille :

```sh
pnpm --filter @kalangu/example-ndiedieng build
pnpm --filter @kalangu/example-ndiedieng wolof:sheet
```

Sur USSD, les accents disparaissent (`ñ` devient `n`, `ë` devient `e`) ; par
SMS, ils restent, mais un `ë` fait passer le message à 70 caractères par SMS
au lieu de 160.

## Avec une vraie passerelle

Avec un compte Africa's Talking (le bac à sable est gratuit, voir le
[guide](../../docs/sandbox-guide.md)), le même serveur reçoit les vrais appels
USSD et SMS sur `/ussd` et `/sms`, et les SMS de la Mairie partent vraiment :

```sh
CALLBACK_SECRET=$(openssl rand -hex 16) AT_USERNAME=sandbox AT_API_KEY=... AT_SANDBOX=1 \
  pnpm --filter @kalangu/example-ndiedieng start
```

Les rappels sont alors sous `/<CALLBACK_SECRET>/ussd` et `/<CALLBACK_SECRET>/sms`.

## Ce que c'est, et ce que ce n'est pas

C'est un **prototype** : le tableau de bord n'a pas de connexion par mot de
passe et le serveur n'écoute que sur la machine locale. Ne l'exposez pas sur
internet avec des données réelles. Une naissance ou un décès signalé ici est
une **pré-déclaration** : l'acte d'état civil suit la procédure légale.

| Fichier | Rôle |
|---|---|
| [`src/agent.ts`](src/agent.ts) | Les menus USSD et SMS des chefs de village (Kalangu) |
| [`src/classify.ts`](src/classify.ts) | Le classement des SMS : mots-clés ou Gemini |
| [`src/assistant.ts`](src/assistant.ts) | L'assistant territorial et la vérification des requêtes |
| [`src/db.ts`](src/db.ts) | La base SQLite (`node:sqlite`) : villages, équipements, fiches, signalements |
| [`src/data.ts`](src/data.ts) | Les données fictives, à remplacer par les fiches réelles |
| [`src/app.ts`](src/app.ts) | L'API de la démonstration, sans dépendance à Node |
| [`web/`](web) | Les pages : `index.html` et `ui.js` (les trois téléphones et le tableau), `assistant/index.html` et `assistant.js` (l'assistant), `common.js` (l'API et la voix), `local.ts` (la démo dans le navigateur, gardée dans IndexedDB) |
| [`web/local.ts`](web/local.ts), [`web/sqljs.ts`](web/sqljs.ts) | Le prototype dans le navigateur, sur SQLite compilé pour le web |
| [`src/server.ts`](src/server.ts) | Le serveur Node : la même page, l'API, et la passerelle optionnelle |
| [`scripts/build-web.mjs`](scripts/build-web.mjs) | Construit `site/ndiedieng` (vérifié en CI) |

`pnpm --filter @kalangu/example-ndiedieng test` lance les tests : les
parcours USSD, SMS et vocal, le classement, l'assistant, et le refus de toute
requête qui écrit. Après une modification de `web/` ou `src/`, reconstruisez la
page du site : `pnpm build && pnpm --filter @kalangu/example-ndiedieng build:web`.
