---
title: MCP Server
description: Verbinden Sie KI-Codierungstools über das Model Context Protocol mit OpenPencil, um Designs zu inspizieren und zu bearbeiten.
---

# MCP Server

OpenPencil wird mit einem MCP-Server ausgeliefert, der KI-Codierungstools — Claude Code, Cursor, Windsurf usw. — das Lesen und Bearbeiten von Designs in der laufenden App ermöglicht. Zwei Binärdateien:

- **`openpencil-mcp`** — Stdio-Transport für MCP-Clients
- **`openpencil-mcp-http`** — HTTP- und WebSocket-Server für Browser, Skripte und die interne Brücke der App

## Voraussetzungen

Bevor Sie einen Client verbinden, stellen Sie sicher:

1. Die OpenPencil-Desktop-App läuft **mit geöffnetem Dokument**. Ohne eine App-Verbindung ist der MCP-Server nutzlos — er ist eine Brücke, kein Renderer.
2. Die MCP-Paketversion stimmt mit der App-Version überein. Der `/health`-Endpunkt meldet die Versionen, damit Clients Abweichungen erkennen können.

Der MCP-Server startet automatisch, wenn Sie die Desktop-App starten (Tauri-Produktionsbuilds starten `openpencil-mcp-http`; im Entwicklungsmodus wird ein Vite-Plugin verwendet). Sie können ihn auch eigenständig ausführen.

## Architektur

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

Die Stdio-Brücke (`openpencil-mcp`) verbindet sich über einen Unix-Domain-Socket (auf macOS/Linux) oder über den HTTP-Port aus der Discovery-Datei (`httpPort`, unter Windows oder bei deaktivierten Sockets) mit dem HTTP-Server. Sie spricht **nicht** direkt MCP mit der App — sie tunnelt MCP-Werkzeugaufrufe über HTTP an den Server, der sie über WebSocket an die laufende App weiterleitet.

## Verbindungsaufbau

Der Server schreibt beim Start eine **Discovery-Datei**. Die Stdio-Brücke liest diese Datei, um den Server zu finden. Keine manuelle Konfiguration erforderlich.

Zwei Transporte: **Stdio** für MCP-Clients und **Streamable HTTP** für Browsererweiterungen und Skripte. Auf macOS und Linux bevorzugen lokale Clients einen privaten Unix-Domain-Socket; unter Windows und bei nicht verfügbaren Sockets wird auf localhost-TCP zurückgegriffen.

## Installation

```sh
npm install -g @open-pencil/mcp
```

## Stdio (Claude Code, Cursor, etc.)

Der Stdio-Server findet die laufende OpenPencil-App automatisch. Auf macOS und Linux bevorzugt er den Unix-Domain-Socket der App und greift bei Bedarf auf localhost-TCP zurück. Stellen Sie sicher, dass die Desktop-App mit geladenem Dokument geöffnet ist.

### Claude Code

```sh
npm install -g @open-pencil/mcp
claude mcp add --scope user open-pencil -- openpencil-mcp
```

Überprüfen:

```sh
claude mcp list
```

Claude Code fragt vor der Verwendung jedes MCP-Werkzeugs nach. Um OpenPencil-Werkzeuge automatisch zu genehmigen, fügen Sie `~/.claude/settings.json` Folgendes hinzu:

```json
{
  "permissions": {
    "allow": ["mcp__open-pencil__*"]
  }
}
```

Beispiel-Prompt:

```text
Use the open-pencil MCP server to inspect the current page and create a small hero section on the canvas.
```

### Andere MCP-Clients

Fügen Sie Ihrer MCP-Konfiguration hinzu (z. B. `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

Aus dem Quellcode ausführen, ohne zu installieren:

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

Für Browsererweiterungen, Skripte, CI oder beliebige HTTP-Clients:

```sh
openpencil-mcp-http
```

Oder aus dem Quellcode: `bun packages/mcp/src/index.ts` / `npx tsx packages/mcp/src/index.ts`

Sicherheitsstandardwerte:

- Unix-Sockets und Discovery-Dateien werden unter macOS und Linux mit Berechtigungen erstellt, die nur dem Eigentümer zugänglich sind.
- TCP bindet standardmäßig an `127.0.0.1` und verwendet Port 7600.
- Die Authentifizierung ist standardmäßig aktiviert, mit einem generierten Token, das in der privaten Discovery-Datei gespeichert ist.
- `eval` ist deaktiviert.
- Dateioperationen sind auf `OPENPENCIL_MCP_ROOT` beschränkt (standardmäßig das aktuelle Arbeitsverzeichnis) und lehnen Symlink-Eskapierungen ab.
- CORS ist standardmäßig deaktiviert; setzen Sie `OPENPENCIL_MCP_CORS_ORIGIN`, um einen Origin zu erlauben.

Setzen Sie `PORT=0`, um TCP unter macOS und Linux zu deaktivieren. Windows erfordert TCP. Setzen Sie `OPENPENCIL_MCP_SOCKET`, um den Unix-Socket-Pfad zu überschreiben, oder `OPENPENCIL_MCP_DISCOVERY_PATH`, um den Speicherort der Discovery-Datei zu überschreiben. Für ein stabiles Token setzen Sie `OPENPENCIL_MCP_AUTH_TOKEN`; ein ausdrücklich leerer Wert deaktiviert die Authentifizierung und sollte nur mit einem vertrauenswürdigen lokalen Socket verwendet werden.

Endpunkte sind über beide aktiven Transporte verfügbar:

- `GET /health` — Server- und App-Verbindungsstatus; gibt niemals das Authentifizierungs-Token zurück.
- `POST /rpc` — authentifizierte Automatisierung der laufenden App.
- `POST /mcp` — MCP Streamable HTTP. Sitzungen verwenden den `mcp-session-id`-Header.

## Arbeitsablauf

1. **Ziele ermitteln** — Rufen Sie `list_documents` zuerst auf, wenn mehr als ein Dokument oder eine Seite geöffnet sein könnte. Es gibt stabile `document_id`- und Seiten-IDs zurück.
2. **Öffnen** — `open_file` zum Laden einer bestehenden `.fig`-Datei oder `new_document` für eine leere Zeichenfläche. Diese geben Ziel-Metadaten für das geöffnete oder erstellte Dokument zurück.
3. **Lesen** — `get_page_tree`, `find_nodes`, `get_node`, `list_pages`
4. **Erstellen** — `create_shape`, `render` (JSX)
5. **Ändern** — `set_fill`, `set_stroke`, `set_layout`, `update_node`, `set_effects`
6. **Struktur** — `reparent_node`, `group_nodes`, `clone_node`, `delete_node`
7. **Speichern** — `save_file`, um Änderungen in eine `.fig`-Datei zurückzuschreiben.

Die meisten Werkzeuge akzeptieren optionale `document_id`- und `page_id`-Felder. Übergeben Sie diese für Agenten-Arbeitsabläufe explizit, statt sich auf den sichtbaren aktiven Tab bzw. die sichtbare aktive Seite zu verlassen. `create_page` erstellt nur eine Seite; rufen Sie `switch_page` separat auf, wenn der Arbeitsablauf die aktive Seite wechseln soll.

## KI-Agent-Skill

Bringen Sie Ihrem KI-Codierungsagenten bei, OpenPencil-Werkzeuge zu verwenden:

```sh
npx skills add open-pencil/skills@open-pencil
```

Funktioniert mit Claude Code, Cursor, Windsurf, Codex und jedem Agenten, der [Skills](https://skills.sh) unterstützt. Das Skill umfasst die CLI, MCP-Werkzeuge, JSX-Rendering, eval und die Automatisierungs-Brücke der laufenden App.

## Tools (91)

### Dokument

| Tool             | Beschreibung                                              |
| ---------------- | --------------------------------------------------------- |
| `open_file`      | Öffnet eine `.fig`-Datei zum Bearbeiten                   |
| `save_file`      | Speichert das aktuelle Dokument in einer `.fig`-Datei     |
| `new_document`   | Erstellt ein neues leeres Dokument                        |
| `list_documents` | Listet geöffnete App-Dokumente/-Tabs und deren Seiten auf |

Hinweis: `open_file`, `new_document` und dateischreibende Export-Werkzeuge werden registriert, wenn ein Datei-Root konfiguriert ist — die mitgelieferten Binärdateien `openpencil-mcp` und `openpencil-mcp-http` setzen immer einen, der standardmäßig dem aktuellen Arbeitsverzeichnis (`cwd()`) entspricht, wenn `OPENPENCIL_MCP_ROOT` nicht gesetzt ist. Bei programmatischem `startServer({ mcpRoot: null })` werden `open_file` und `new_document` weggelassen, weil kein Root konfiguriert ist. `save_file` ist immer registriert; dessen Pfad wird gegen den Root validiert, sofern einer gesetzt ist, andernfalls wird der bestehende Dateipfad verwendet.

### Lesen

| Tool               | Beschreibung                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `get_selection`    | Ruft die aktuell ausgewählten Knoten ab                             |
| `get_page_tree`    | Ruft den vollständigen Knotenbaum der aktuellen Seite ab            |
| `get_current_page` | Ruft Name und ID der aktuellen Seite ab                             |
| `get_node`         | Ruft detaillierte Eigenschaften eines Knotens anhand der ID ab      |
| `find_nodes`       | Findet Knoten anhand von Namensmuster und/oder Typ                  |
| `get_components`   | Listet alle Komponenten im Dokument auf                             |
| `list_pages`       | Listet alle Seiten auf                                              |
| `list_variables`   | Listet Design-Variablen auf                                         |
| `list_collections` | Listet Variablen-Sammlungen auf                                     |
| `list_fonts`       | Listet Schriften auf, die auf der aktuellen Seite verwendet werden  |
| `page_bounds`      | Ruft den Begrenzungsrahmen aller Objekte auf der aktuellen Seite ab |
| `node_bounds`      | Ruft den Begrenzungsrahmen eines Knotens ab                         |
| `node_ancestors`   | Ruft die Vorfahren-Kette eines Knotens ab                           |
| `node_children`    | Ruft direkte Kinder eines Knotens ab                                |
| `node_tree`        | Ruft den Unterbaum mit einem Knoten als Wurzel ab                   |
| `node_bindings`    | Ruft Variablen-Bindungen eines Knotens ab                           |

### Erstellen

| Tool                | Beschreibung                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `create_shape`      | Erstellt eine Form (`FRAME`, `RECTANGLE`, `ELLIPSE`, `TEXT`, `LINE`, `STAR`, `POLYGON`, `SECTION`) |
| `create_vector`     | Erstellt einen Vektorknoten aus einem Pfadstring                                                   |
| `create_slice`      | Erstellt einen Export-Slice                                                                        |
| `create_page`       | Erstellt eine neue Seite                                                                           |
| `render`            | Rendert JSX zu Design-Knoten — erstellt ganze Komponentenbäume in einem Aufruf                     |
| `create_component`  | Wandelt einen Frame/eine Gruppe in eine Komponente um                                              |
| `create_instance`   | Erstellt eine Instanz einer Komponente                                                             |
| `node_to_component` | Wandelt einen bestehenden Knoten direkt in eine Komponente um                                      |

### Ändern

| Tool                  | Beschreibung                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `set_fill`            | Setzt die Füllfarbe (hex)                                                                       |
| `set_stroke`          | Setzt Konturfarbe, -stärke und -ausrichtung                                                     |
| `set_effects`         | Fügt Schatten- oder Weichzeichnungseffekte hinzu                                                |
| `update_node`         | Aktualisiert Position, Größe, Deckkraft, Eckenradius, Text und Schriftart                       |
| `set_layout`          | Setzt Auto-Layout (Flexbox) — Richtung, Abstand, Innenabstand, Ausrichtung                      |
| `set_constraints`     | Setzt Größenänderungs-Einschränkungen                                                           |
| `set_rotation`        | Setzt den Drehwinkel in Grad                                                                    |
| `set_opacity`         | Setzt die Deckkraft (0–1)                                                                       |
| `set_radius`          | Setzt den Eckenradius (gleichmäßig oder pro Ecke)                                               |
| `set_minmax`          | Setzt Mindest-/Höchstbreiten- und -höheneinschränkungen                                         |
| `set_text`            | Setzt den Textinhalt eines `TEXT`-Knotens                                                       |
| `set_font`            | Setzt Schriftfamilie und -stärke                                                                |
| `set_font_range`      | Setzt Schrifteigenschaften für einen Zeichenbereich                                             |
| `set_text_resize`     | Setzt den Auto-Resize-Modus des Textes (fest/auto-Breite/auto-Höhe)                             |
| `set_visible`         | Blendet einen Knoten ein oder aus                                                               |
| `set_blend`           | Setzt den Mischmodus                                                                            |
| `set_locked`          | Sperrt oder entsperrt einen Knoten                                                              |
| `set_stroke_align`    | Setzt die Konturausrichtung (innen/mittig/außen)                                                |
| `set_text_properties` | Setzt das Textlayout: Ausrichtung, Auto-Resize, Groß-/Kleinschreibung, Dekoration, Abschneidung |
| `set_layout_child`    | Konfiguriert ein Auto-Layout-Kind: Größenbestimmung, Grow, Ausrichtung, absolute Positionierung |
| `node_move`           | Verschiebt einen Knoten an eine neue Position                                                   |
| `node_resize`         | Ändert die Größe eines Knotens                                                                  |
| `node_replace_with`   | Ersetzt einen Knoten durch einen anderen Knoten                                                 |
| `arrange`             | Richtet ausgewählte Knoten aus oder verteilt sie                                                |

### Struktur

| Tool                | Beschreibung                                                   |
| ------------------- | -------------------------------------------------------------- |
| `delete_node`       | Löscht einen Knoten                                            |
| `clone_node`        | Dupliziert einen Knoten                                        |
| `rename_node`       | Benennt einen Knoten um                                        |
| `reparent_node`     | Verschiebt einen Knoten in einen anderen übergeordneten Knoten |
| `select_nodes`      | Wählt Knoten anhand der ID aus                                 |
| `group_nodes`       | Gruppiert Knoten                                               |
| `ungroup_node`      | Hebt die Gruppierung auf                                       |
| `flatten_nodes`     | Vereinigt Knoten zu einem einzelnen Vektor                     |
| `boolean_union`     | Boolesche Vereinigung von zwei oder mehr Knoten                |
| `boolean_subtract`  | Boolesche Subtraktion                                          |
| `boolean_intersect` | Boolescher Schnitt                                             |
| `boolean_exclude`   | Boolesche Exklusion                                            |

### Vektor-Pfad

| Tool         | Beschreibung                                       |
| ------------ | -------------------------------------------------- |
| `path_get`   | Ruft die Pfaddaten eines Vektorknotens ab          |
| `path_set`   | Setzt die Pfaddaten eines Vektorknotens            |
| `path_scale` | Skaliert einen Vektorpfad                          |
| `path_flip`  | Spiegelt einen Vektorpfad horizontal oder vertikal |
| `path_move`  | Verschiebt einen Vektorpfad                        |

### Export

| Tool           | Beschreibung                                                                    |
| -------------- | ------------------------------------------------------------------------------- |
| `export_image` | Exportiert Knoten als PNG, JPG oder WEBP. Gibt base64-kodierte Bilddaten zurück |
| `export_svg`   | Exportiert Knoten als SVG-Markup                                                |

### Ansichtsfenster

| Tool                   | Beschreibung                                                     |
| ---------------------- | ---------------------------------------------------------------- |
| `viewport_get`         | Ruft die aktuelle Ansichtsfenster-Position und den Zoomfaktor ab |
| `viewport_set`         | Setzt Ansichtsfenster-Position und Zoom                          |
| `viewport_zoom_to_fit` | Zoomt das Ansichtsfenster, um angegebene Knoten einzupassen      |

### Variablen

| Tool                | Beschreibung                                            |
| ------------------- | ------------------------------------------------------- |
| `get_variable`      | Ruft eine Variable anhand von ID oder Name ab           |
| `find_variables`    | Findet Variablen anhand von Namensmuster oder Typ       |
| `create_variable`   | Erstellt eine neue Variable in einer Sammlung           |
| `set_variable`      | Setzt einen Variablenwert in einem Modus                |
| `delete_variable`   | Löscht eine Variable                                    |
| `bind_variable`     | Bindet eine Variable an eine Knoteneigenschaft          |
| `get_collection`    | Ruft eine Variablen-Sammlung anhand von ID oder Name ab |
| `create_collection` | Erstellt eine neue Variablen-Sammlung                   |
| `delete_collection` | Löscht eine Variablen-Sammlung                          |

### Analysieren

| Tool                 | Beschreibung                                                 |
| -------------------- | ------------------------------------------------------------ |
| `analyze_colors`     | Analysiert die Nutzung der Farbpalette im Dokument           |
| `analyze_typography` | Analysiert die Verteilung von Schriftart/Größe/Schriftstärke |
| `analyze_spacing`    | Analysiert Abstands- und Innenabstandswerte                  |
| `analyze_clusters`   | Erkennt wiederholte Muster (potenzielle Komponenten)         |

### Diff

| Tool          | Beschreibung                                                               |
| ------------- | -------------------------------------------------------------------------- |
| `diff_create` | Erstellt eine Momentaufnahme des aktuellen Dokumentzustands                |
| `diff_show`   | Zeigt Unterschiede zwischen dem aktuellen Zustand und einer Momentaufnahme |

### Navigation

| Tool          | Beschreibung                                    |
| ------------- | ----------------------------------------------- |
| `switch_page` | Wechselt zu einer Seite anhand von Name oder ID |

### Notausstieg

| Tool   | Beschreibung                                             |
| ------ | -------------------------------------------------------- |
| `eval` | Führt JavaScript mit vollem Figma-Plugin-API-Zugriff aus |

Hinweis: `eval` ist über Stdio verfügbar, aber im HTTP-Modus aus Sicherheitsgründen deaktiviert.
