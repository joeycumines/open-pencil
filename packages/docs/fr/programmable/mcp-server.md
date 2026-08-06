---
title: MCP Server
description: Connectez les outils de codage IA à OpenPencil pour l'inspection et la modification de designs via le Model Context Protocol.
---

# MCP Server

OpenPencil est livré avec un serveur MCP qui permet aux outils de codage IA — Claude Code, Cursor, Windsurf, etc. — de lire et de modifier les designs dans l'application en cours d'exécution. Deux binaires :

- **`openpencil-mcp`** — transport stdio pour les clients MCP
- **`openpencil-mcp-http`** — serveur HTTP + WebSocket pour les navigateurs, les scripts et le pont interne de l'application

## Prérequis

Avant de connecter un client, assurez-vous :

1. L'application de bureau OpenPencil est en cours d'exécution **avec un document ouvert**. Le serveur MCP est inutile sans connexion à l'application — c'est un pont, pas un moteur de rendu.
2. La version du paquet MCP correspond à la version de l'application. L'endpoint `/health` signale les versions afin que les clients puissent détecter les incompatibilités.

Le serveur MCP démarre automatiquement au lancement de l'application de bureau (les builds Tauri de production lancent `openpencil-mcp-http` ; le mode dev utilise un plugin Vite). Vous pouvez également l'exécuter de manière autonome.

## Architecture

```text
  MCP Client          MCP Server              OpenPencil App
  (Claude Code,       (openpencil-mcp-http)   (desktop / browser)
   Cursor, etc.)
                      ┌──────────────┐
  stdio ◄───────────► │  /rpc (HTTP) │ ◄──── JSON-RPC ─────► Stdio bridge
                      │              │
                      │  /    (WS)   │ ◄──── WebSocket ────► Browser tab
  (openpencil-mcp)    │              │
                      │  /mcp (HTTP) │ ◄── Streamable HTTP ──► External tools
                      │              │
                      │  /health     │
                      └──────┬───────┘
                             │
                    socket or TCP (127.0.0.1)
```

Le pont stdio (`openpencil-mcp`) se connecte au serveur HTTP via une socket de domaine Unix (sur macOS/Linux) ou via le port HTTP indiqué dans le fichier de découverte (`httpPort`, sous Windows ou lorsque les sockets sont désactivées). Il ne parle **pas** MCP directement à l'application — il achemine les appels d'outils MCP via HTTP vers le serveur, qui les relaie à l'application en cours d'exécution par WebSocket.

## Connexion

Le serveur écrit un **fichier de découverte** au démarrage. Le pont stdio lit ce fichier pour trouver le serveur. Aucune configuration manuelle n'est nécessaire.

Deux transports : **stdio** pour les clients MCP, et **Streamable HTTP** pour les extensions de navigateur et les scripts. Sur macOS et Linux, les clients locaux privilégient une socket de domaine Unix privée ; sous Windows et lorsque les sockets sont indisponibles, ils reviennent à TCP localhost.

## Installation

```sh
npm install -g @open-pencil/mcp
```

## Stdio (Claude Code, Cursor, etc.)

Le serveur stdio détecte automatiquement l'application OpenPencil en cours d'exécution. Il privilégie la socket de domaine Unix de l'application sur macOS et Linux et revient à TCP localhost si nécessaire. Assurez-vous que l'application de bureau est ouverte avec un document chargé.

### Claude Code

```sh
npm install -g @open-pencil/mcp
claude mcp add --scope user open-pencil -- openpencil-mcp
```

Vérifiez :

```sh
claude mcp list
```

Claude Code demande une confirmation avant d'utiliser chaque outil MCP. Pour approuver automatiquement les outils OpenPencil, ajoutez à `~/.claude/settings.json` :

```json
{
  "permissions": {
    "allow": ["mcp__open-pencil__*"]
  }
}
```

Exemple de prompt :

```text
Use the open-pencil MCP server to inspect the current page and create a small hero section on the canvas.
```

### Autres clients MCP

Ajoutez à votre configuration MCP (par ex. `.cursor/mcp.json`) :

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

Exécuter depuis le code source sans installation :

::: code-group

```json [Bun]
{
  "mcpServers": {
    "open-pencil": {
      "command": "bun",
      "args": ["/path/to/open-pencil/packages/mcp/src/stdio.ts"]
    }
  }
}
```

```json [Node.js]
{
  "mcpServers": {
    "open-pencil": {
      "command": "npx",
      "args": ["tsx", "/path/to/open-pencil/packages/mcp/src/stdio.ts"]
    }
  }
}
```

:::

## HTTP

Pour les extensions de navigateur, les scripts, la CI ou tout client HTTP :

```sh
openpencil-mcp-http
```

Ou depuis le code source : `bun packages/mcp/src/index.ts` / `npx tsx packages/mcp/src/index.ts`

Paramètres de sécurité par défaut :

- Les sockets Unix et les fichiers de découverte sont créés avec des permissions réservées au propriétaire sur macOS et Linux.
- TCP se lie à `127.0.0.1` et utilise le port 7600 par défaut.
- L'authentification est activée par défaut avec un jeton généré stocké dans le fichier de découverte privé.
- `eval` est désactivé.
- Les opérations sur les fichiers sont limitées à `OPENPENCIL_MCP_ROOT` (par défaut, le répertoire de travail courant) et rejettent les échappatoires par liens symboliques.
- CORS est désactivé par défaut ; définissez `OPENPENCIL_MCP_CORS_ORIGIN` pour autoriser une seule origine.

Définissez `PORT=0` pour désactiver TCP sur macOS et Linux. Windows exige TCP. Définissez `OPENPENCIL_MCP_SOCKET` pour remplacer le chemin de la socket Unix, ou `OPENPENCIL_MCP_DISCOVERY_PATH` pour remplacer l'emplacement du fichier de découverte. Pour fournir un jeton stable, définissez `OPENPENCIL_MCP_AUTH_TOKEN` ; une valeur explicitement vide désactive l'authentification et ne doit être utilisée qu'avec une socket locale de confiance.

Les endpoints sont disponibles sur les deux transports actifs :

- `GET /health` — statut du serveur et de la connexion à l'application ; ne renvoie jamais le jeton d'authentification.
- `POST /rpc` — automatisation authentifiée de l'application en direct.
- `POST /mcp` — MCP Streamable HTTP. Les sessions utilisent l'en-tête `mcp-session-id`.

## Flux de travail

1. **Découvrir les cibles** — appelez `list_documents` en premier lorsqu'il est possible que plusieurs documents ou pages soient ouverts. Il renvoie des `document_id` et des IDs de page stables.
2. **Ouvrir** — `open_file` pour charger un `.fig` existant, ou `new_document` pour une toile vierge. Ces outils renvoient les métadonnées de la cible pour le document ouvert ou créé.
3. **Lire** — `get_page_tree`, `find_nodes`, `get_node`, `list_pages`
4. **Créer** — `create_shape`, `render` (JSX)
5. **Modifier** — `set_fill`, `set_stroke`, `set_layout`, `update_node`, `set_effects`
6. **Structurer** — `reparent_node`, `group_nodes`, `clone_node`, `delete_node`
7. **Enregistrer** — `save_file` pour réécrire dans `.fig`

La plupart des outils acceptent les champs optionnels `document_id` et `page_id`. Passez-les explicitement pour les workflows d'agents plutôt que de vous fier à l'onglet/page active visible. `create_page` ne fait que créer une page ; appelez `switch_page` séparément lorsque le workflow doit changer de page active.

## Compétence d'agent IA

Apprenez à votre agent de codage IA à utiliser les outils OpenPencil :

```sh
npx skills add open-pencil/skills@open-pencil
```

Fonctionne avec Claude Code, Cursor, Windsurf, Codex et tout agent prenant en charge les [compétences](https://skills.sh). La compétence couvre la CLI, les outils MCP, le rendu JSX, eval et le pont d'automatisation de l'application en cours d'exécution.

## Outils (91)

### Document

| Tool             | Description                                                         |
| ---------------- | ------------------------------------------------------------------- |
| `open_file`      | Ouvre un fichier `.fig` pour édition                                |
| `save_file`      | Enregistre le document courant dans un fichier `.fig`               |
| `new_document`   | Crée un nouveau document vide                                       |
| `list_documents` | Liste les documents/onglets ouverts de l'application et leurs pages |

Note : `open_file`, `new_document` et les outils d'export qui écrivent des fichiers sont enregistrés lorsqu'une racine de fichiers est configurée — les binaires `openpencil-mcp` et `openpencil-mcp-http` fournis en définissent toujours une, avec pour défaut le répertoire de travail courant (`cwd()`) lorsque `OPENPENCIL_MCP_ROOT` n'est pas défini. L'appel programmatique `startServer({ mcpRoot: null })` omet `open_file` et `new_document` car aucune racine n'est configurée. `save_file` est toujours enregistré ; son chemin est validé par rapport à la racine lorsqu'elle est définie, sinon le chemin de fichier existant est utilisé.

### Lecture

| Tool               | Description                                                       |
| ------------------ | ----------------------------------------------------------------- |
| `get_selection`    | Obtenir les nœuds actuellement sélectionnés                       |
| `get_page_tree`    | Obtenir l'arborescence complète des nœuds de la page courante     |
| `get_current_page` | Obtenir le nom et l'ID de la page courante                        |
| `get_node`         | Obtenir les propriétés détaillées d'un nœud par son ID            |
| `find_nodes`       | Trouver des nœuds par motif de nom et/ou type                     |
| `get_components`   | Lister tous les composants du document                            |
| `list_pages`       | Lister toutes les pages                                           |
| `list_variables`   | Lister les variables de design                                    |
| `list_collections` | Lister les collections de variables                               |
| `list_fonts`       | Lister les polices utilisées dans la page courante                |
| `page_bounds`      | Obtenir le cadre englobant de tous les objets de la page courante |
| `node_bounds`      | Obtenir le cadre englobant d'un nœud                              |
| `node_ancestors`   | Obtenir la chaîne d'ancêtres d'un nœud                            |
| `node_children`    | Obtenir les enfants directs d'un nœud                             |
| `node_tree`        | Obtenir le sous-arbre enraciné à un nœud                          |
| `node_bindings`    | Obtenir les liaisons de variables d'un nœud                       |

### Création

| Tool                | Description                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `create_shape`      | Créer une forme (`FRAME`, `RECTANGLE`, `ELLIPSE`, `TEXT`, `LINE`, `STAR`, `POLYGON`, `SECTION`)   |
| `create_vector`     | Créer un nœud vectoriel à partir d'une chaîne de chemin                                           |
| `create_slice`      | Créer une zone d'export (slice)                                                                   |
| `create_page`       | Créer une nouvelle page                                                                           |
| `render`            | Rendre du JSX en nœuds de design — crée des arborescences de composants entières en un seul appel |
| `create_component`  | Convertir un frame/groupe en composant                                                            |
| `create_instance`   | Créer une instance d'un composant                                                                 |
| `node_to_component` | Convertir un nœud existant en composant sur place                                                 |

### Modification

| Tool                  | Description                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `set_fill`            | Définir la couleur de remplissage (hex)                                                              |
| `set_stroke`          | Définir la couleur, l'épaisseur et l'alignement du contour                                           |
| `set_effects`         | Ajouter des effets d'ombre ou de flou                                                                |
| `update_node`         | Mettre à jour la position, la taille, l'opacité, le rayon d'arrondi, le texte, la police             |
| `set_layout`          | Définir l'auto-layout (flexbox) — direction, espacement, padding, alignement                         |
| `set_constraints`     | Définir les contraintes de redimensionnement                                                         |
| `set_rotation`        | Définir l'angle de rotation en degrés                                                                |
| `set_opacity`         | Définir l'opacité (0–1)                                                                              |
| `set_radius`          | Définir le rayon d'arrondi (uniforme ou par coin)                                                    |
| `set_minmax`          | Définir les contraintes de largeur/hauteur min et max                                                |
| `set_text`            | Définir le contenu texte d'un nœud `TEXT`                                                            |
| `set_font`            | Définir la famille et le poids de police                                                             |
| `set_font_range`      | Définir les propriétés de police sur une plage de caractères                                         |
| `set_text_resize`     | Définir le mode d'auto-redimensionnement du texte (fixe/largeur-auto/hauteur-auto)                   |
| `set_visible`         | Afficher ou masquer un nœud                                                                          |
| `set_blend`           | Définir le mode de fusion                                                                            |
| `set_locked`          | Verrouiller ou déverrouiller un nœud                                                                 |
| `set_stroke_align`    | Définir l'alignement du contour (intérieur/centre/extérieur)                                         |
| `set_text_properties` | Définir la mise en page du texte : alignement, auto-redimensionnement, casse, décoration, troncature |
| `set_layout_child`    | Configurer un enfant d'auto-layout : dimensionnement, grow, alignement, positionnement absolu        |
| `node_move`           | Déplacer un nœud vers une nouvelle position                                                          |
| `node_resize`         | Redimensionner un nœud                                                                               |
| `node_replace_with`   | Remplacer un nœud par un autre nœud                                                                  |
| `arrange`             | Aligner ou répartir les nœuds sélectionnés                                                           |

### Structure

| Tool                | Description                           |
| ------------------- | ------------------------------------- |
| `delete_node`       | Supprimer un nœud                     |
| `clone_node`        | Dupliquer un nœud                     |
| `rename_node`       | Renommer un nœud                      |
| `reparent_node`     | Déplacer un nœud dans un autre parent |
| `select_nodes`      | Sélectionner des nœuds par ID         |
| `group_nodes`       | Grouper des nœuds                     |
| `ungroup_node`      | Dégrouper un groupe                   |
| `flatten_nodes`     | Aplatir des nœuds en un seul vecteur  |
| `boolean_union`     | Union booléenne de deux nœuds ou plus |
| `boolean_subtract`  | Soustraction booléenne                |
| `boolean_intersect` | Intersection booléenne                |
| `boolean_exclude`   | Exclusion booléenne                   |

### Chemin vectoriel

| Tool         | Description                                                    |
| ------------ | -------------------------------------------------------------- |
| `path_get`   | Obtenir les données de chemin d'un nœud vectoriel              |
| `path_set`   | Définir les données de chemin d'un nœud vectoriel              |
| `path_scale` | Mettre à l'échelle un chemin vectoriel                         |
| `path_flip`  | Retourner un chemin vectoriel horizontalement ou verticalement |
| `path_move`  | Translater un chemin vectoriel                                 |

### Exportation

| Tool           | Description                                                                            |
| -------------- | -------------------------------------------------------------------------------------- |
| `export_image` | Exporter des nœuds en PNG, JPG ou WEBP. Renvoie les données d'image encodées en base64 |
| `export_svg`   | Exporter des nœuds au format SVG                                                       |

### Vue

| Tool                   | Description                                                 |
| ---------------------- | ----------------------------------------------------------- |
| `viewport_get`         | Obtenir la position et le niveau de zoom courants de la vue |
| `viewport_set`         | Définir la position et le zoom de la vue                    |
| `viewport_zoom_to_fit` | Zoomer la vue pour s'adapter aux nœuds spécifiés            |

### Variables

| Tool                | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `get_variable`      | Obtenir une variable par ID ou par nom                |
| `find_variables`    | Trouver des variables par motif de nom ou par type    |
| `create_variable`   | Créer une nouvelle variable dans une collection       |
| `set_variable`      | Définir la valeur d'une variable dans un mode         |
| `delete_variable`   | Supprimer une variable                                |
| `bind_variable`     | Lier une variable à une propriété de nœud             |
| `get_collection`    | Obtenir une collection de variables par ID ou par nom |
| `create_collection` | Créer une nouvelle collection de variables            |
| `delete_collection` | Supprimer une collection de variables                 |

### Analyse

| Tool                 | Description                                                       |
| -------------------- | ----------------------------------------------------------------- |
| `analyze_colors`     | Analyser l'utilisation de la palette de couleurs dans le document |
| `analyze_typography` | Analyser la distribution des polices/tailles/graisses             |
| `analyze_spacing`    | Analyser les valeurs d'espacement et de padding                   |
| `analyze_clusters`   | Détecter les motifs récurrents (composants potentiels)            |

### Diff

| Tool          | Description                                                    |
| ------------- | -------------------------------------------------------------- |
| `diff_create` | Créer un instantané de l'état courant du document              |
| `diff_show`   | Afficher les différences entre l'état courant et un instantané |

### Navigation

| Tool          | Description                         |
| ------------- | ----------------------------------- |
| `switch_page` | Passer à une page par nom ou par ID |

### Échappatoire

| Tool   | Description                                                          |
| ------ | -------------------------------------------------------------------- |
| `eval` | Exécuter du JavaScript avec un accès complet à l'API du plugin Figma |

Note : `eval` est disponible via stdio, mais désactivé en mode HTTP pour des raisons de sécurité.
