# Déploiement de cette instance

Instance famille : https://family.bsylla.com, hôte `daroubayre`.

| Élément        | Où                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base           | Neon projet `keurtonux` (`broad-flower-41313951`), base **`openfamily`** (créée le 2026-10-09, même rôle `neondb_owner`, `aws-eu-central-1`) — identifiants dans `.env` |
| Documents      | Bucket S3 Scaleway `openfamily-media` (privé, `fr-par`) : avatars, photos de recettes et de publications ; le serveur sert les octets derrière une URL signée expirante (`GET /api/media/<clé>`) |
| Client         | `127.0.0.1:8200` (loopback), cible du tunnel — rien d'autre n'écoute là                                                                                                 |
| API            | Aucun port d'hôte ; jointe par le client nginx via le réseau Compose (`server:3001`), qui relaie `/api`, `/ws`, `/health` et `/.well-known/assetlinks.json`             |
| Ingress public | Tunnel Cloudflare `navidrome` (id `2c8f5ae9-…`), config **distante** : `family.bsylla.com → http://localhost:8200` (ingress version 12). CNAME `family.bsylla.com` créé le 2026-10-09 avec le cert root (`sudo cloudflared tunnel route dns navidrome family.bsylla.com`) |

## Commandes

```bash
deploy/up.sh up -d --build     # (re)construire et démarrer
deploy/up.sh logs -f server    # journaux (migrations, erreurs)
deploy/up.sh ps
```

Ce dépôt (`/home/bsylla/OpenFamily`, branche `develop`) est le déploiement actif
depuis le 2026-10-10 : l'arbre précédent a été arrêté par `deploy/up.sh down` le
même jour. Les noms de conteneurs sont fixes (`openfamily-server`,
`openfamily-client`) : deux stacks ne peuvent pas tourner en même temps, l'arrêt
de l'ancienne doit précéder le démarrage de la nouvelle.

L'arbre précédent n'existe plus sur le disque (`/home/bsylla/OpenFamily-fork` ne
contient plus de `docker-compose.yml`), seules ses images subsistent
(`openfamily-fork-server`, `openfamily-fork-client`, 2026-10-10 05:14 UTC) : un
« retour arrière » ne peut donc pas relancer un répertoire, il faut faire tourner
ces images à la place des images `openfamily-{server,client}` — et revenir ensuite
sur les migrations déjà appliquées (elles sont additives, jamais annulées).

**Retour arrière** (images de l'arbre précédent) :

```bash
cd /home/bsylla/OpenFamily && deploy/up.sh down
docker tag openfamily-fork-server openfamily-server
docker tag openfamily-fork-client openfamily-client
cd /home/bsylla/OpenFamily && deploy/up.sh up -d          # sans --build
```

**Ce qui a changé au basculement** :

- Les variables propres au fork sont préfixées `CUSTOM_` (`CUSTOM_POSTGRES_SSL`,
  `CUSTOM_POSTGRES_CONNECT_TIMEOUT_MS`, `CUSTOM_MINIO_*`) : `.env` a été renommé,
  `docker-compose.override.yml` et `deploy/up.sh` les lisent sous ces noms.
- Les deux migrations du fork ont été renommées `custom/0001-users-location` et
  `custom/0002-budget-receipts` (elles occupaient `core/0007`/`core/0008`, la
  séquence d'amont). Toutes leurs instructions sont idempotentes : elles se sont
  rejouées une fois sur la base Neon, sans modifier le schéma, et les anciens
  identifiants ont été supprimés de `openfamily_schema_migrations` (l'avertissement
  `db.migrations_unknown` au démarrage venait de là).

`deploy/up.sh` neutralise `COMPOSE_PROJECT_NAME` et les `POSTGRES_*` hérités du
shell avant d'appeler Compose : Compose fait passer l'environnement du shell
avant `.env`, et une session ouverte dans un autre dépôt (le stack maiky exporte
`POSTGRES_PASSWORD`) déploierait sinon l'app avec le mauvais mot de passe.

## Après déploiement

- **Premier compte** : l'instance démarre avec `REGISTRATION_ENABLED=true` pour
  créer le compte propriétaire, puis on referme :
  `sed -i 's/^REGISTRATION_ENABLED=true/REGISTRATION_ENABLED=false/' .env &&
  deploy/up.sh up -d server`. Pas de rebuild : la page de connexion demande au
  serveur si les inscriptions sont ouvertes (`VITE_REGISTRATION_ENABLED` ne sert
  que d'affichage par défaut). Les personnes invitées depuis la page Famille
  gardent leur accès.
- **Vérification** : `curl -fsS https://family.bsylla.com/health` puis
  `API_BASE=https://family.bsylla.com RUN_ID=manual scripts/smoke-api.sh`
  (parcours complet inscription/connexion/CRUD ; l'inscription doit être ouverte).
  Si le nom ne résout pas depuis l'hôte, le résolveur local (Pi-hole) a gardé la
  réponse négative d'avant le CNAME : `sudo pihole restartdns`. En attendant, le
  chemin complet se teste sans passer par lui :
  `curl -fsS --resolve family.bsylla.com:443:104.21.94.118 https://family.bsylla.com/health`,
  ou l'instance seule avec `API_BASE=http://127.0.0.1:8200`.
- **Sauvegarde** : l'export contient les références `s3:` réécrites en URL
  signées, valables 7 jours ; une restauration fonctionne au-delà parce que la
  clé de l'objet est dans le chemin, mais la sauvegarde n'est pas la source de
  vérité des octets : le bucket l'est. Sauvegarder le bucket à part, ou `pg_dump`
  ci-dessous pour la base seule.
  ```bash
  cd /home/bsylla/OpenFamily && set -a; . ./.env; set +a
  # sslrootcert=system: verify-full against the system trust store, otherwise psql
  # looks for ~/.postgresql/root.crt and refuses to connect.
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    "host=$POSTGRES_HOST port=$POSTGRES_PORT dbname=$POSTGRES_DB user=$POSTGRES_USER sslmode=verify-full sslrootcert=system" \
    -Fc -f ~/backup/openfamily-$(date +%F).dump
  ```
  Neon conserve en plus 6 h d'historique (branche `main`).

## Points d'exploitation

- **TLS vers la base** : `CUSTOM_POSTGRES_SSL=verify-full` et
  `CUSTOM_POSTGRES_CONNECT_TIMEOUT_MS=10000` (le compute Neon se suspend quand il est
  inactif ; le délai par défaut de 2 s échouait à la première requête).
- **Images sur S3** : `CUSTOM_MINIO_*` pointent le bucket Scaleway `openfamily-media`
  (`fr-par`), créé au démarrage par le serveur. Les photos sont servies par
  `GET /api/media/<clé>` avec une signature valable 7 jours ; vider `CUSTOM_MINIO_*`
  désactive la fonctionnalité et remet les images en base.
- **Emails désactivés** : `SMTP_HOST`/`MAIL_FROM` vides, le mailer reste inerte.
  Les invitations se transmettent par leur lien ; la réinitialisation de mot de
  passe par email n'est pas disponible tant que le SMTP n'est pas configuré.
- **Push** : clés VAPID reprises de KeurTonux (même paire, origines distinctes).
