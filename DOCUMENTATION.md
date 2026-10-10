# OpenFamily — Documentation complète

## Sommaire

1. [Présentation](#présentation)
2. [À quoi sert OpenFamily ?](#à-quoi-sert-openfamily-)
3. [Fonctionnalités détaillées](#fonctionnalités-détaillées)
4. [Architecture technique](#architecture-technique)
5. [Technologies utilisées](#technologies-utilisées)
6. [Structure du projet](#structure-du-projet)
7. [Base de données](#base-de-données)
8. [Sécurité](#sécurité)
9. [Déploiement](#déploiement)

---

## Présentation

**OpenFamily** est une application **open source** de gestion familiale développée par **NexaFlow France**. Elle est conçue pour être **auto-hébergée** (self-hosted), ce qui signifie que chaque famille peut la déployer sur son propre serveur et garder le **contrôle total de ses données personnelles**.

L'application est accessible depuis n'importe quel appareil (ordinateur, tablette, smartphone) grâce à son interface web responsive et sa nature de **Progressive Web App (PWA)**, qui permet de l'installer directement sur l'écran d'accueil d'un téléphone ou d'un ordinateur, comme une application native.

Le projet est distribué sous **licence GNU AGPL v3**.

---

## À quoi sert OpenFamily ?

OpenFamily centralise l'ensemble de l'organisation d'un foyer en un seul outil. Plutôt que de jongler entre plusieurs applications (agenda, liste de courses, budget, recettes…), OpenFamily regroupe tout au même endroit, accessible à tous les membres de la famille.

**Cas d'usage typiques :**

- Un parent prépare la liste de courses depuis son bureau → le conjoint la consulte en temps réel au supermarché
- Les tâches ménagères sont réparties et suivies entre les membres de la famille
- Le calendrier familial regroupe tous les rendez-vous médicaux, scolaires, professionnels
- Le planning des repas de la semaine est organisé à l'avance, lié aux recettes de la bibliothèque familiale
- Le budget du foyer est suivi mois par mois, avec des limites par catégorie et des statistiques visuelles
- Les informations de santé de chaque membre (groupe sanguin, allergies, vaccins, contacts d'urgence) sont centralisées

---

## Fonctionnalités détaillées

### 🛒 Liste de courses
- Ajout d'articles avec nom, quantité, unité et prix estimé
- **Catégorisation automatique** : Alimentation, Bébé, Ménage, Santé, Autre
- Système de **templates** (modèles) pour les courses récurrentes
- Case à cocher pour marquer les articles achetés
- Notes optionnelles par article

### ✅ Gestion des tâches
- Création de tâches avec titre, description et date d'échéance
- **Tâches récurrentes** : quotidiennes, hebdomadaires, mensuelles ou annuelles
- **3 niveaux de priorité** : Basse, Moyenne, Haute
- **Assignation** à un membre de la famille
- Suivi de l'avancement et statistiques de complétion

### 📅 Calendrier / Rendez-vous
- Vue calendrier mensuelle avec code couleur par membre
- Création de rendez-vous avec heure de début/fin, lieu et description
- **Rappels automatiques** configurables (30 min avant, 1h avant)
- Association à un membre de la famille
- Notes complémentaires par événement

### 🗓️ Planning hebdomadaire
- Gestion des emplois du temps de chaque membre de la famille
- Support de deux types : emploi du temps **professionnel** et **scolaire**
- Créneaux horaires par jour de la semaine (lundi → dimanche)
- Indication du lieu pour chaque créneau

<!-- FORK-START: docs -->
#### 🧭 Planificateur de sorties (IA)

Sous le planning, un panneau propose des sorties pour un jour donné :

- **Des lieux réels**, pas inventés : la liste vient d'OpenStreetMap (aires de jeux, parcs,
  zoos, aquariums, musées, parcs d'attractions, piscines, bibliothèques, points de vue) dans
  un rayon de 10 km autour de la ville enregistrée — ou de la position partagée par le
  navigateur. Un lieu sans nom est ignoré, deux fois le même lieu n'apparaît qu'une fois.
- **L'assistant IA classe ces lieux** selon la journée : météo prévue (pluie, vent, froid →
  lieux couverts), **qui participe** (toute la famille, avec les enfants, ou les parents
  seuls), la durée souhaitée, l'âge des enfants et ce qui est écrit sur leur fiche
  (allergies, limitations — contraintes dures). Chaque choix arrive avec sa raison en une
  phrase, une heure de départ et une durée.
- **Des idées sans lieu précis** (1 à 3) pour les journées où l'on ne sort pas.
- **Deux temps** : les lieux s'affichent d'abord, sans modèle, puis sont remplacés par le
  classement de l'assistant — jamais un écran vide pendant que le modèle travaille.
- **Sans modèle IA configuré** (ou s'il ne répond pas), la liste reste : les lieux les plus
  proches, à l'intérieur d'abord s'il pleut, sans commentaire.
- **« Ajouter au planning »** inscrit la sortie choisie dans la semaine, avec les bons
  participants — c'est l'endpoint de planning habituel, donc les conflits d'horaires sont
  signalés comme partout ailleurs.
- OpenStreetMap est un service public mutualisé : les réponses sont mises en cache 12 h côté
  serveur, et une requête en échec est retentée une fois (`CUSTOM_OVERPASS_*` pour pointer
  un miroir).

<!-- FORK-END: docs -->


### 🍳 Bibliothèque de recettes
- Ajout de recettes avec ingrédients, instructions pas à pas et photo
- **Catégories** : Entrée, Plat, Dessert, Snack
- **Niveaux de difficulté** : Facile, Moyen, Difficile
- Temps de préparation et de cuisson, nombre de portions
- Système de **tags** pour le filtrage avancé

### 🍽️ Planning des repas
- Vue **hebdomadaire** des repas (petit-déjeuner, déjeuner, dîner, snack)
- Liaison directe avec les recettes de la bibliothèque
- Possibilité d'ajouter un repas personnalisé (hors recette)
- Notes par repas

<!-- FORK-START: docs -->
### 🍱 Boîtes à lunch
- **Une boîte par enfant et par jour** : plat, fruit ou légume, collation, boisson et notes —
  un enfant = une boîte, là où le planning des repas reste commun au foyer
- **Onglet Suivi** : les aliments les plus fréquents des 60 derniers jours, par catégorie, et
  l'historique récent d'un enfant — utile quand on prépare toujours la même chose
- **Liste de courses** : un clic ajoute les ingrédients de toute la semaine ; un aliment déjà
  sur la liste n'est pas dupliqué (relancer la semaine est sans effet)
- **Suggestions IA** : décrivez ce qu'il y a à la maison et où l'enfant mangera (école,
  crèche, sortie, travail, voyage), l'assistant propose jusqu'à 3 boîtes à lunch ; l'âge et
  les **allergies** de l'enfant sont des contraintes dures, et les textes arrivent dans la
  langue de l'interface
- **Lecture nutritionnelle de la semaine** : les repas planifiés *et* les boîtes à lunch,
  analysés par votre modèle IA (note sur 100, points forts, points à améliorer, groupes
  d'aliments manquants, recommandations concrètes)
- Les deux fonctions IA réutilisent le modèle configuré dans Paramètres → Assistant IA ;
  sans modèle configuré, la page reste pleinement utilisable
<!-- FORK-END: docs -->

### 💰 Gestion du budget
- Suivi des **revenus** et **dépenses** du foyer
- **6 catégories** : Alimentation, Santé, Enfants, Maison, Loisirs, Autre
- Définition de **limites mensuelles** par catégorie
- **Statistiques visuelles** avec graphiques (Recharts)
- Assignation des dépenses à un membre de la famille
- Vue mensuelle avec comparaison budget prévu vs réel
<!-- FORK-START: docs -->
- **Import de reçus et de factures** (photo ou PDF) : l'assistant IA lit le document, chaque
  ligne du ticket devient une dépense dans **sa propre catégorie** (une facture sans détail
  devient une seule dépense), tout est vérifiable avant l'enregistrement
- **Mode « une seule écriture »** à l'import : pour une facture dont le détail ne sert pas,
  une case à cocher n'inscrit que le total dans le budget — les lignes lues restent
  enregistrées dans le détail du reçu
- **Section « Reçus importés »** sous le budget : un reçu = une ligne (commerce, date, total),
  dépliable pour voir article par article ce qui a été acheté ; supprimer un reçu supprime
  aussi les écritures qu'il a créées
- **Anti-doublon** : un même ticket (même commerce, même date, même montant) ne peut pas être
  importé deux fois — l'écran de relecture le signale et l'enregistrement le refuse
- Les lignes de tous les reçus restent en base, pour de futures analyses (par article, par
  magasin, dans le temps)
<!-- FORK-END: docs -->

### 👨‍👩‍👧‍👦 Gestion de la famille
- Profil détaillé pour chaque membre : nom, date de naissance, couleur, avatar
- **Informations de santé** : groupe sanguin, allergies, médicaments, vaccins, notes médicales
- **Contacts d'urgence** par membre
- Rôles familiaux configurables
- **Comptes partagés** : le propriétaire invite les autres membres par e-mail (l'invitation
  part directement depuis le serveur si SMTP est configuré) ou en partageant le lien
  d'invitation. La personne invitée crée son compte via ce lien et rejoint la famille.
  Un compte déjà créé peut aussi coller le lien reçu depuis la page « Rejoindre une famille ».

### ⚙️ Paramètres
- Export / import des données (transfert de données)
- Personnalisation de l'application
- **Mot de passe oublié** : réinitialisation par lien e-mail (valable 60 minutes, à usage
  unique), disponible dès que SMTP est configuré

### 📊 Tableau de bord (Dashboard)
- Vue d'ensemble de l'activité familiale
- **Agenda au jour ou à la semaine**, au choix
- **Plannings de la semaine** (travail, école, activités) directement sur l'accueil
- Résumé des tâches en cours, prochains rendez-vous, budget du mois
- **Personnalisable par membre** : chaque compte choisit les blocs affichés et leur ordre
- Accès rapide à tous les modules
<!-- FORK-START: docs -->
### 🌤️ Météo, tenues et activités
- **Ville de la famille** réglée dans les Paramètres (géocodage automatique) ou position
  ponctuelle « Ma position » depuis la carte, jamais enregistrée
- **Prévisions du jour ciblé** : le lendemain pendant l'année scolaire (pour préparer la
  tenue du matin), le jour même le week-end et pendant les vacances d'été
- **Détail de la semaine** : températures ressenties, lever/coucher du soleil, indice UV
- **Tenue par enfant** : une suggestion adaptée à la météo et à l'âge, générée par votre
  modèle IA (aucun modèle configuré = la carte montre la météo seule)
- **Activités sans écran** les jours à la maison, avec bouton « Planifier » qui crée
  l'entrée dans le planning (les créneaux déjà occupés sont refusés) ; sans IA
  disponible, une banque d'idées hors ligne prend le relais
- **Textes générés dans la langue de l'interface** (tenues et activités, IA comme
  banque hors ligne) ; une langue non prise en charge retombe sur l'anglais
- Prévisions fournies par [Open-Meteo](https://open-meteo.com) : **aucune clé d'API**,
  aucun compte, aucune configuration requise
<!-- FORK-END: docs -->

---

## Architecture technique

OpenFamily suit une architecture **client-serveur classique en 3 tiers** :

```
┌──────────────────┐     HTTP / WS     ┌──────────────────┐     SQL      ┌──────────────────┐
│                  │ ◄───────────────► │                  │ ◄──────────► │                  │
│   Client React   │                   │  Serveur Express │              │   PostgreSQL 16  │
│   (SPA / PWA)    │                   │  (API REST + WS) │              │                  │
│                  │                   │                  │              │                  │
└──────────────────┘                   └──────────────────┘              └──────────────────┘
     Port 3000                              Port 3001                       Port 5432
    (Nginx prod)                                                      
```

### Flux de communication

1. **Client → Serveur** : Requêtes HTTP REST (JSON) pour toutes les opérations CRUD, authentifiées via token JWT dans le header `Authorization: Bearer <token>`
2. **Serveur → Client** : WebSocket (`/ws`) pour les mises à jour en temps réel (notifications, synchronisation)
3. **Serveur → Base de données** : Requêtes SQL via le driver `pg` (node-postgres), avec pooling de connexions

### Monorepo avec workspaces npm

Le projet utilise les **npm workspaces** pour structurer le code en 3 packages :
- `@openfamily/client` — l'application frontend
- `@openfamily/server` — l'API backend
- `shared/` — les types TypeScript et constantes partagés entre client et serveur

---

## Technologies utilisées

### Frontend

| Technologie | Version | Rôle |
|---|---|---|
| **React** | 19 | Bibliothèque UI (composants, état, rendu) |
| **TypeScript** | 5.3+ | Typage statique du code JavaScript |
| **Vite** | 7 | Bundler et serveur de développement ultra-rapide |
| **TailwindCSS** | 3.4 | Framework CSS utility-first pour le styling |
| **Radix UI** | — | Composants UI accessibles et non stylés (Dialog, Select, Switch, Tabs, Toast…) |
| **React Router** | 6 | Routage côté client (SPA) |
| **React Hook Form** | 7 | Gestion des formulaires avec validation |
| **Zod** | 3 | Schémas de validation des données |
| **Recharts** | 2 | Graphiques et visualisations (budget, statistiques) |
| **Framer Motion** | 10 | Animations et transitions fluides |
| **date-fns** | 3 | Manipulation et formatage des dates |
| **Lucide React** | — | Bibliothèque d'icônes SVG |
| **vite-plugin-pwa** | — | Support PWA (Service Worker, manifest, offline) |
| **class-variance-authority** | — | Gestion de variants CSS pour les composants |

### Backend

| Technologie | Version | Rôle |
|---|---|---|
| **Node.js** | 20+ | Runtime JavaScript côté serveur |
| **Express** | 4.18 | Framework HTTP pour l'API REST |
| **TypeScript** | 5.3+ | Typage statique |
| **PostgreSQL** | 16 | Base de données relationnelle |
| **pg (node-postgres)** | 8 | Driver PostgreSQL pour Node.js |
| **JSON Web Token (JWT)** | 9 | Authentification stateless |
| **bcrypt** | 6 | Hachage sécurisé des mots de passe |
| **ws** | 8 | Serveur WebSocket natif |
| **web-push** | 3.6 | Notifications push (protocole Web Push / VAPID) |
| **dotenv** | 16 | Chargement des variables d'environnement |
| **tsx** | 4 | Exécution directe de TypeScript en développement |

### DevOps / Infrastructure

| Technologie | Rôle |
|---|---|
| **Docker** | Conteneurisation de chaque service |
| **Docker Compose** | Orchestration des 3 services (client, server, postgres) |
| **Nginx** | Serveur de fichiers statiques en production (client) |
| **Multi-stage builds** | Images Docker optimisées (build → runtime) |

### Mobile (Capacitor)

Le projet inclut des dossiers `android/` et `ios/`, indiquant un support mobile via **Capacitor** (pont entre l'application web et les APIs natives iOS/Android). Cela permet de publier l'application sur le **Google Play Store** et l'**Apple App Store** en plus de la version web.

---

## Structure du projet

```
OpenFamily/
├── client/                    # Application frontend React
│   ├── Dockerfile             # Image Docker du client (Nginx)
│   ├── nginx.conf             # Configuration Nginx de production
│   ├── package.json
│   ├── vite.config.ts         # Configuration Vite + PWA
│   ├── tailwind.config.js     # Configuration TailwindCSS
│   ├── public/                # Assets statiques (icônes, images)
│   └── src/
│       ├── App.tsx            # Composant racine + routage
│       ├── main.tsx           # Point d'entrée React
│       ├── index.css          # Styles globaux + design tokens
│       ├── components/
│       │   ├── app/           # Composants métier
│       │   ├── layout/        # Layout principal (sidebar, header)
│       │   └── ui/            # Composants UI réutilisables
│       ├── contexts/
│       │   ├── AuthContext.tsx # Contexte d'authentification
│       │   └── ThemeContext.tsx# Contexte du thème (clair/sombre)
│       ├── design/
│       │   ├── colorPresets.ts# Préréglages de couleurs
│       │   └── tokens.css     # Design tokens CSS
│       ├── lib/
│       │   ├── api.ts         # Client HTTP (fetch wrapper)
│       │   └── utils.ts       # Utilitaires divers
│       └── pages/             # Pages de l'application
│           ├── Dashboard.tsx
│           ├── ShoppingList.tsx
│           ├── Tasks.tsx
│           ├── Calendar.tsx
│           ├── Planning.tsx
│           ├── Recipes.tsx
│           ├── MealPlanning.tsx
│           ├── Budget.tsx
│           ├── Family.tsx
│           ├── Settings.tsx
│           └── Login.tsx
│
├── server/                    # API backend Express
│   ├── Dockerfile             # Image Docker du serveur
│   ├── package.json
│   └── src/
│       ├── index.ts           # Point d'entrée (HTTP + WebSocket)
│       ├── app.ts             # Configuration Express + routes
│       ├── db.ts              # Pool de connexions PostgreSQL + schéma/migrations
│       ├── config/
│       │   └── loadEnv.ts     # Chargement des variables d'environnement
│       ├── lib/
│       │   └── normalize.ts   # Utilitaires de normalisation
│       ├── middleware/
│       │   └── auth.ts        # Middleware JWT d'authentification
│       └── routes/            # Routes API REST
│           ├── auth.ts        # Inscription / Connexion
│           ├── shopping.ts    # CRUD liste de courses
│           ├── tasks.ts       # CRUD tâches
│           ├── appointments.ts# CRUD rendez-vous
│           ├── recipes.ts     # CRUD recettes
│           ├── mealPlans.ts   # CRUD planning repas
│           ├── budget.ts      # CRUD budget
│           ├── family.ts      # CRUD membres famille
│           ├── planning.ts    # CRUD planning hebdomadaire
│           ├── dashboard.ts   # Agrégation tableau de bord
│           └── dataTransfer.ts# Export / import de données
│
├── shared/                    # Code partagé client ↔ serveur
│   ├── package.json
│   └── src/
│       ├── types.ts           # Interfaces TypeScript (User, Task, Recipe…)
│       ├── constants.ts       # Constantes (catégories, fréquences, jours…)
│       └── index.ts           # Réexport public
│
├── android/                   # Application Android (Capacitor)
├── ios/                       # Application iOS (Capacitor)
├── scripts/
│   └── smoke-api.sh           # Script de test bout-en-bout de l'API
├── docker-compose.yml         # Orchestration des services
├── package.json               # Package racine (workspaces npm)
├── INSTALLATION.md            # Server installation guide (English)
└── INSTALLATION.fr.md         # Guide d'installation serveur (français)
```

---

## Base de données

OpenFamily utilise **PostgreSQL 16** avec le schéma suivant :

### Tables principales

| Table | Description |
|---|---|
| `users` | Comptes utilisateurs (email, mot de passe hashé, nom) |
| `family_members` | Membres de la famille rattachés à un utilisateur |
| `shopping_items` | Articles de la liste de courses |
| `shopping_list_templates` | Modèles de listes de courses (JSONB) |
| `tasks` | Tâches avec priorité, récurrence et assignation |
| `appointments` | Rendez-vous avec rappels |
| `schedule_entries` | Créneaux du planning hebdomadaire |
| `recipes` | Recettes (ingrédients et instructions en JSONB) |
| `meal_plans` | Planning des repas (lié aux recettes) |
| `budget_entries` | Revenus et dépenses |
| `budget_receipts` | Reçus et factures importés (commerce, date, total, catégorie, empreinte anti-doublon) | <!-- FORK-START: docs -->
| `budget_receipt_items` | Lignes détaillées de chaque reçu, conservées pour l'analyse |
| `custom_lunchboxes` | Boîtes à lunch, une par enfant et par jour (plat, fruit, collation, boisson) | <!-- FORK-END: docs -->
| `budget_limits` | Limites mensuelles par catégorie |
| `notifications` | Notifications internes |
| `push_subscriptions` | Abonnements push (Web Push / VAPID) |
| `family_invites` | Invitations à rejoindre une famille (jeton, rôle, expiration) |
| `family_join_requests` | Demandes d'accès adressées au propriétaire d'une famille |
| `password_resets` | Jetons de réinitialisation de mot de passe (empreinte SHA-256, usage unique) |

### Caractéristiques techniques
- **UUIDs** (v4) comme clés primaires pour toutes les tables
- **Contraintes d'intégrité** : foreign keys avec `ON DELETE CASCADE` ou `ON DELETE SET NULL`
- **Index** optimisés sur les colonnes fréquemment requêtées
- **Triggers** automatiques pour la mise à jour du champ `updated_at`
- **Contraintes de validité** : unicité, vérifications (ex : `end_time > start_time`)
- **JSONB** pour les données flexibles (ingrédients, instructions, items de template)

---

<!-- FORK-START: docs -->
## Stockage des images

Les photos (avatar, recette, publication) arrivent du navigateur en `data:` URL,
après redimensionnement côté client. Deux configurations possibles :

| Configuration | Où vont les octets | Ce qui est stocké en base |
|---|---|---|
| Aucun bucket (`CUSTOM_MINIO_*` vides, défaut) | nulle part | la `data:` URL elle-même |
| Bucket S3 configuré | le bucket (objet `media/<uuid>.<ext>`) | une référence `s3:<clé>` |

Avec un bucket, les octets sont envoyés par le serveur au moment de la requête
(`server/src/custom/lib/media.custom.ts`, appliqué à tout le corps de la requête avant les
routes) et relus par **`GET /api/media/<clé>`**, dont la signature en query
(`?exp=&sig=`) fait office d'authentification : une balise `<img>` ne peut pas
porter l'en-tête `Authorization` du reste de l'API. Le bucket reste donc privé,
aucune URL de stockage n'atteint le navigateur, et un lien expire au bout de
7 jours. Tout service compatible S3 convient (MinIO, Scaleway Object Storage,
AWS S3, OVH) : seul le bloc `CUSTOM_MINIO_*` change.

Sans bucket, le comportement est celui d'origine : les images vivent en base, au
prix d'une base plus grosse et de sauvegardes plus lourdes.
<!-- FORK-END: docs -->

## Sécurité

| Mécanisme | Détail |
|---|---|
| **Authentification** | JWT (JSON Web Token) avec expiration à 7 jours |
| **Hachage des mots de passe** | bcrypt (coût adaptatif) |
| **Réinitialisation de mot de passe** | Lien e-mail à usage unique, valable 60 minutes. Seule l'empreinte SHA-256 du jeton est stockée ; la réponse est identique que l'adresse existe ou non (pas d'énumération de comptes) et l'endpoint est limité en débit |
| **Invitations** | Jeton aléatoire de 32 octets, expiration configurable (7 jours par défaut), révocable ; création limitée en débit et réservée au propriétaire de la famille |
| **CORS** | Origines configurables via variable d'environnement |
| **Isolation des données** | Chaque requête est filtrée par `user_id` — un utilisateur ne voit que ses propres données |
| **Variables d'environnement** | Les secrets (JWT_SECRET, mots de passe DB, clés VAPID) ne sont jamais codés en dur |
| **HTTPS** | Recommandé en production (nécessaire pour les notifications push et le service worker) |

---

## Déploiement

### Avec Docker (recommandé)

L'application se déploie en **3 conteneurs Docker** orchestrés par Docker Compose :

1. **openfamily-db** — PostgreSQL 16 Alpine, avec initialisation automatique du schéma
2. **openfamily-server** — API Node.js/Express, avec health check intégré
3. **openfamily-client** — Fichiers statiques React servis par Nginx

```bash
# Cloner et configurer
git clone https://github.com/NexaFlowFrance/OpenFamily.git
cd OpenFamily
cp .env.example .env  # Configurer les variables

# Démarrer
docker-compose up -d --build

# Vérifier
curl http://localhost:3001/health
npm run smoke:api
```

**Ports par défaut :**
- Frontend : `http://localhost:3000`
- API : `http://localhost:3001`
- PostgreSQL : `localhost:5432`

### Installation manuelle (développement)

Prérequis : Node.js 20+, PostgreSQL 16+, npm 10+.

```bash
npm run install:all     # Installe toutes les dépendances
npm run hooks:install   # Active la vérification exécutée avant chaque push
npm run dev             # Lance client (port 5173) + serveur (port 3001)
```

---

> **Dépôt GitHub** : [https://github.com/NexaFlowFrance/OpenFamily](https://github.com/NexaFlowFrance/OpenFamily)
> **Licence** : GNU AGPL v3
> **Auteur** : NexaFlow France
