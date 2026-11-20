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

## Lancer la démonstration

Node 22.13 ou plus récent, et pnpm. Depuis la racine du dépôt :

```sh
pnpm install
pnpm build
pnpm --filter @kalangu/example-ndiedieng start
```

Puis ouvrez <http://localhost:3000>. Aucun compte, aucune clé.

- **À gauche, le téléphone d'un chef de village.** Choisissez le village,
  composez `*123#` (bouton « Appeler / Envoyer ») et suivez les menus avec le
  clavier. Un code complet comme `*123*1*1*1*1#` fait tout d'un coup : panne,
  eau, forage, urgent. En SMS, envoyez n'importe quel texte pour recevoir le
  menu, puis `5` pour écrire librement : « le forage est en panne depuis
  hier ».
- **À droite, la Mairie.** Les signalements arrivent triés par urgence. « Prendre
  en charge » et « Résolu » envoient un SMS au chef (visible dans le téléphone
  de gauche). Un SMS ambigu arrive « À vérifier » : l'agent corrige la catégorie
  et l'urgence, puis valide.
- **L'assistant territorial.** Posez une question ou cliquez une suggestion ;
  « Données utilisées » montre la requête SQL et les lignes sur lesquelles
  repose la réponse.

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
| [`src/app.ts`](src/app.ts), [`src/page.ts`](src/page.ts) | La page de démonstration et son API |
| [`src/server.ts`](src/server.ts) | Le serveur et la passerelle optionnelle |

`pnpm --filter @kalangu/example-ndiedieng test` lance les tests (37) : les
parcours USSD et SMS, le classement, l'assistant, et le refus de toute requête
qui écrit.
