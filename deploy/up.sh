#!/usr/bin/env bash
# Wrapper Compose d'OpenFamily.
#
# Pourquoi ce script : Compose fait passer l'environnement du shell AVANT le
# fichier .env pour l'interpolation ${...}. Une session ouverte dans un autre
# dépôt (le stack maiky exporte POSTGRES_PASSWORD, COMPOSE_PROJECT_NAME=maiky)
# déploierait donc OpenFamily avec le mauvais mot de passe de base, et dans le
# mauvais projet Compose. Ce wrapper neutralise ces variables avant d'appeler
# Compose ; tout le reste de la configuration reste dans .env.
#
# Usage : deploy/up.sh up -d [--build] | deploy/up.sh logs -f server | ...
set -euo pipefail
cd "$(dirname "$0")/.."

exec env \
    -u COMPOSE_PROJECT_NAME \
    -u POSTGRES_HOST -u POSTGRES_PORT -u POSTGRES_DB \
    -u POSTGRES_USER -u POSTGRES_PASSWORD \
    -u CUSTOM_POSTGRES_SSL -u CUSTOM_POSTGRES_CONNECT_TIMEOUT_MS \
    docker compose "$@"
