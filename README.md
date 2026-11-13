# Allégeance — serveur (Allegiance_game)

Service Node sans dépendance (Node ≥ 18) qui fait tourner le moteur du Sandbox 2 sur la carte v6 (190×190 d, 52 sièges).
Le moteur est celui du Sandbox, **non modifié sur disque** (`vendor/sandbox2.html`); `lib/engine.js` l'adapte à la volée
(taille du plateau, 52 clés, point d'entrée `apply/turn/dump`) et l'exécute dans un contexte `vm` avec un faux DOM.

## Lancer en local (gratuit, stockage fichier dans `var/`)
    ADMIN_KEY=secret node server.js
    curl -X POST -H "X-Admin-Key: secret" -d '{"realms":52}' localhost:8080/api/admin/new   # affiche les 52 jetons UNE fois
    # joueur A: http://localhost:8080/?seat=A&token=<jeton>
    curl -X POST -H "X-Admin-Key: secret" localhost:8080/api/admin/resolve                    # clôture le tour (~10-15 s)

## Avec Supabase (persistance)
1. Crée un projet Supabase gratuit, colle `sql/schema.sql` dans SQL Editor.
2. Variables d'environnement du service: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (clé *service_role*, jamais côté client), `ADMIN_KEY`, `GAME_ID`.
3. Héberge `server.js` sur un service Node (Render, Fly, Railway…). Un service gratuit qui s'endort convient: l'état est en base et se recharge au réveil.
4. Optionnel: `TURN_HOURS=24` clôture automatiquement le tour à l'échéance.

## Déploiement sur Vercel (gratuit, plan Hobby)
Le dossier `api/` + `vercel.json` font tourner la même logique (`lib/router.js`) en fonction serverless; `public/` est servi en statique.
1. Sur vercel.com: *Add New → Project*, importe ce dépôt GitHub (aucune commande de build).
2. *Settings → Environment Variables*: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_KEY` (+ `CRON_SECRET` et `TURN_HOURS=24` si tu veux la clôture automatique).
3. Déploie, puis crée la partie avec `POST https://<ton-projet>.vercel.app/api/admin/new` (mêmes commandes `curl` qu'en local, en changeant l'adresse).
Notes: la résolution (~20 s) tient dans les 300 s du plan Hobby (Fluid compute). Le cron Hobby ne tourne qu'une fois par jour (`vercel.json`, 10 h UTC). Le drapeau `resolving` est par instance: la mise à jour conditionnelle `updateGameIfTurn` empêche qu'un tour soit résolu deux fois. Plan Hobby = usage personnel non commercial.

## API
| | |
|---|---|
| `GET /api/meta` | tour, échéance, résolution en cours |
| `GET /api/state` | état public complet (phase 1: pas d'information cachée) |
| `GET /api/orders?seat&token` / `POST /api/orders` | lire / remplacer les ordres du siège pour le tour courant |
| `POST /api/admin/token {seat}` | nouveau jeton pour un siège (l'ancien cesse de marcher) |
| `POST /api/admin/new`, `/api/admin/resolve` | création de partie, clôture du tour (en-tête `X-Admin-Key`) |

Ordres: `move{army,x,y}` (d), `claim{army,r}`, `build{army,kind}`, `raise{building}`, `flag{army,color}`, `disband{army,on}`. Chaque ordre est vérifié contre le propriétaire du siège à la résolution.

## Limites connues (phase 1)
- La résolution bloque le processus ~10-15 s (pas de worker); les ordres reçus pendant ce temps reçoivent un 503.
- Montagnes et rivières: les rivières sont des obstacles de grille (gués ouverts); les montagnes ne sont **pas** dans le moteur (dessin seulement).
- Terres de départ synthétiques (disque de 5,9 d); pas de brouillard de guerre, pas de Realtime (le client interroge `/api/meta` toutes les 10 s).
- Résolution SQL des ordres, RLS par joueur et auth anonyme Supabase: phase 2 (doc 15).
