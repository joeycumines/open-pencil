---
title: MCP Server
description: Collega gli strumenti di IA per la programmazione a OpenPencil per ispezionare e modificare i design tramite Model Context Protocol.
---

# MCP Server

OpenPencil include un server MCP che consente agli strumenti di IA per la programmazione — Claude Code, Cursor, Windsurf, ecc. — di leggere e modificare i design nell'app in esecuzione. Due binari:

- **`openpencil-mcp`** — trasporto stdio per i client MCP
- **`openpencil-mcp-http`** — server HTTP + WebSocket per browser, script e il bridge interno dell'app

## Prerequisiti

Prima di collegare qualsiasi client, assicurati di:

1. Avere l'app desktop OpenPencil in esecuzione **con un documento aperto**. Il server MCP è inutile senza una connessione all'app — è un bridge, non un renderer.
2. La versione del pacchetto MCP corrisponda a quella dell'app. L'endpoint `/health` riporta le versioni, così i client possono rilevare le discrepanze.

Il server MCP si avvia automaticamente quando lanci l'app desktop (le build di produzione Tauri avviano `openpencil-mcp-http`; in modalità dev viene usato un plugin Vite). Puoi anche eseguirlo in modo autonomo.

## Architettura

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

Il bridge stdio (`openpencil-mcp`) si collega al server HTTP tramite un socket Unix (su macOS/Linux) oppure tramite la porta HTTP del file di discovery (`httpPort`, su Windows o in configurazioni con socket disabilitato). Non parla MCP direttamente con l'app — inoltra le chiamate agli strumenti MCP tramite HTTP al server, che le trasmette all'app in esecuzione via WebSocket.

## Come si connette

Il server scrive un **file di discovery** all'avvio. Il bridge stdio legge questo file per trovare il server. Nessuna configurazione manuale necessaria.

Due trasporti: **stdio** per i client MCP e **Streamable HTTP** per le estensioni del browser e gli script. Su macOS e Linux, i client locali preferiscono un socket Unix privato; su Windows e quando il socket non è disponibile si ripiega su TCP su localhost.

## Installazione

```sh
npm install -g @open-pencil/mcp
```

## Stdio (Claude Code, Cursor, ecc.)

Il server stdio rileva automaticamente l'app OpenPencil in esecuzione. Preferisce il socket Unix dell'app su macOS e Linux e ripiega su TCP su localhost quando necessario. Assicurati che l'app desktop sia aperta con un documento caricato.

### Claude Code

```sh
npm install -g @open-pencil/mcp
claude mcp add --scope user open-pencil -- openpencil-mcp
```

Verifica:

```sh
claude mcp list
```

Claude Code chiede l'autorizzazione prima di usare ogni strumento MCP. Per approvare automaticamente gli strumenti di OpenPencil, aggiungi a `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__open-pencil__*"]
  }
}
```

Esempio di prompt:

```text
Use the open-pencil MCP server to inspect the current page and create a small hero section on the canvas.
```

### Altri client MCP

Aggiungi alla tua configurazione MCP (es. `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

Esegui dal sorgente senza installare:

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

Per le estensioni del browser, gli script, la CI o qualsiasi client HTTP:

```sh
openpencil-mcp-http
```

Oppure dal sorgente: `bun packages/mcp/src/index.ts` / `npx tsx packages/mcp/src/index.ts`

Impostazioni di sicurezza predefinite:

- Socket Unix e file di discovery vengono creati con permessi di solo proprietario su macOS e Linux.
- TCP si collega a `127.0.0.1` e usa la porta 7600 di default.
- L'autenticazione è abilitata di default con un token generato memorizzato nel file di discovery privato.
- `eval` è disabilitato.
- Le operazioni sui file sono limitate a `OPENPENCIL_MCP_ROOT` (per impostazione predefinita la directory di lavoro corrente) e rifiutano i tentativi di escape dei symlink.
- CORS è disabilitato di default; imposta `OPENPENCIL_MCP_CORS_ORIGIN` per consentire un'origine.

Imposta `PORT=0` per disabilitare TCP su macOS e Linux. Windows richiede TCP. Imposta `OPENPENCIL_MCP_SOCKET` per sovrascrivere il percorso del socket Unix, oppure `OPENPENCIL_MCP_DISCOVERY_PATH` per sovrascrivere la posizione del file di discovery. Per fornire un token stabile, imposta `OPENPENCIL_MCP_AUTH_TOKEN`; un valore esplicitamente vuoto disabilita l'autenticazione e dovrebbe essere usato solo con un socket locale di fiducia.

Gli endpoint sono disponibili su entrambi i trasporti attivi:

- `GET /health` — stato del server e della connessione all'app; non restituisce mai il token di autenticazione.
- `POST /rpc` — automazione autenticata dell'app live.
- `POST /mcp` — Streamable HTTP MCP. Le sessioni usano l'header `mcp-session-id`.

## Flusso di lavoro

1. **Scopri i target** — chiama `list_documents` per primo quando potrebbero essere aperti più documenti o pagine. Restituisce `document_id` e gli ID delle pagine stabili.
2. **Apri** — `open_file` per caricare un `.fig` esistente, oppure `new_document` per una tela vuota. Questi restituiscono i metadati del target per il documento aperto o creato.
3. **Leggi** — `get_page_tree`, `find_nodes`, `get_node`, `list_pages`
4. **Crea** — `create_shape`, `render` (JSX)
5. **Modifica** — `set_fill`, `set_stroke`, `set_layout`, `update_node`, `set_effects`
6. **Struttura** — `reparent_node`, `group_nodes`, `clone_node`, `delete_node`
7. **Salva** — `save_file` per scrivere di nuovo su `.fig`

La maggior parte degli strumenti accetta campi opzionali `document_id` e `page_id`. Passali esplicitamente nei flussi di lavoro degli agenti invece di affidarti alla scheda/pagina attiva visibile. `create_page` crea solo una pagina; chiama `switch_page` separatamente quando il flusso di lavoro deve cambiare la pagina attiva.

## Skill per agenti IA

Insegna al tuo agente di IA per la programmazione a usare gli strumenti di OpenPencil:

```sh
npx skills add open-pencil/skills@open-pencil
```

Funziona con Claude Code, Cursor, Windsurf, Codex e qualsiasi agente che supporti le [skills](https://skills.sh). La skill copre la CLI, gli strumenti MCP, il rendering JSX, eval e il bridge di automazione dell'app in esecuzione.

## Strumenti (91)

### Documento

| Tool             | Description                                       |
| ---------------- | ------------------------------------------------- |
| `open_file`      | Apre un file `.fig` per la modifica               |
| `save_file`      | Salva il documento corrente in un file `.fig`     |
| `new_document`   | Crea un nuovo documento vuoto                     |
| `list_documents` | Elenca i documenti/schede aperti e le loro pagine |

Nota: `open_file`, `new_document` e gli strumenti di esportazione che scrivono file vengono registrati quando è configurata una root per i file — i binari forniti `openpencil-mcp` e `openpencil-mcp-http` la impostano sempre, con default alla directory di lavoro corrente (`cwd()`) quando `OPENPENCIL_MCP_ROOT` non è impostata. `startServer({ mcpRoot: null })` programmatico omette `open_file` e `new_document` perché nessuna root è configurata. `save_file` è sempre registrato; il suo percorso viene validato rispetto alla root quando questa è impostata, altrimenti viene usato il percorso del file esistente.

### Lettura

| Tool               | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `get_selection`    | Ottiene i nodi attualmente selezionati                             |
| `get_page_tree`    | Ottiene l'intero albero dei nodi della pagina corrente             |
| `get_current_page` | Ottiene il nome e l'ID della pagina corrente                       |
| `get_node`         | Ottiene le proprietà dettagliate di un nodo tramite ID             |
| `find_nodes`       | Trova i nodi per pattern nel nome e/o tipo                         |
| `get_components`   | Elenca tutti i componenti del documento                            |
| `list_pages`       | Elenca tutte le pagine                                             |
| `list_variables`   | Elenca le variabili di design                                      |
| `list_collections` | Elenca le raccolte di variabili                                    |
| `list_fonts`       | Elenca i font usati nella pagina corrente                          |
| `page_bounds`      | Ottiene il bounding box di tutti gli oggetti nella pagina corrente |
| `node_bounds`      | Ottiene il bounding box di un nodo                                 |
| `node_ancestors`   | Ottiene la catena degli antenati di un nodo                        |
| `node_children`    | Ottiene i figli diretti di un nodo                                 |
| `node_tree`        | Ottiene il sottoalbero radicato in un nodo                         |
| `node_bindings`    | Ottiene i collegamenti alle variabili su un nodo                   |

### Creazione

| Tool                | Description                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `create_shape`      | Crea una forma (`FRAME`, `RECTANGLE`, `ELLIPSE`, `TEXT`, `LINE`, `STAR`, `POLYGON`, `SECTION`) |
| `create_vector`     | Crea un nodo vettoriale da una stringa di path                                                 |
| `create_slice`      | Crea una slice di esportazione                                                                 |
| `create_page`       | Crea una nuova pagina                                                                          |
| `render`            | Rende JSX in nodi di design — crea interi alberi di componenti in un'unica chiamata            |
| `create_component`  | Converte un frame/gruppo in un componente                                                      |
| `create_instance`   | Crea un'istanza di un componente                                                               |
| `node_to_component` | Converte un nodo esistente in un componente sul posto                                          |

### Modifica

| Tool                  | Description                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `set_fill`            | Imposta il colore di riempimento (hex)                                                                |
| `set_stroke`          | Imposta colore, spessore e allineamento del tratto                                                    |
| `set_effects`         | Aggiunge ombre o effetti di sfocatura                                                                 |
| `update_node`         | Aggiorna posizione, dimensione, opacità, raggio dei bordi, testo, font                                |
| `set_layout`          | Imposta l'auto-layout (flexbox) — direzione, spaziatura, padding, allineamento                        |
| `set_constraints`     | Imposta i vincoli di ridimensionamento                                                                |
| `set_rotation`        | Imposta l'angolo di rotazione in gradi                                                                |
| `set_opacity`         | Imposta l'opacità (0–1)                                                                               |
| `set_radius`          | Imposta il raggio dei bordi (uniforme o per angolo)                                                   |
| `set_minmax`          | Imposta i vincoli di larghezza e altezza min/max                                                      |
| `set_text`            | Imposta il contenuto testuale di un nodo `TEXT`                                                       |
| `set_font`            | Imposta famiglia e spessore del font                                                                  |
| `set_font_range`      | Imposta le proprietà del font su un intervallo di caratteri                                           |
| `set_text_resize`     | Imposta la modalità di auto-resize del testo (fisso/larghezza-auto/altezza-auto)                      |
| `set_visible`         | Mostra o nasconde un nodo                                                                             |
| `set_blend`           | Imposta la modalità di fusione                                                                        |
| `set_locked`          | Blocca o sblocca un nodo                                                                              |
| `set_stroke_align`    | Imposta l'allineamento del tratto (interno/centro/esterno)                                            |
| `set_text_properties` | Imposta il layout del testo: allineamento, auto-resize, maiuscole/minuscole, decorazione, troncamento |
| `set_layout_child`    | Configura il figlio dell'auto-layout: dimensionamento, grow, allineamento, posizionamento assoluto    |
| `node_move`           | Sposta un nodo in una nuova posizione                                                                 |
| `node_resize`         | Ridimensiona un nodo                                                                                  |
| `node_replace_with`   | Sostituisce un nodo con un altro nodo                                                                 |
| `arrange`             | Allinea o distribuisce i nodi selezionati                                                             |

### Struttura

| Tool                | Description                              |
| ------------------- | ---------------------------------------- |
| `delete_node`       | Elimina un nodo                          |
| `clone_node`        | Duplica un nodo                          |
| `rename_node`       | Rinomina un nodo                         |
| `reparent_node`     | Sposta un nodo in un genitore diverso    |
| `select_nodes`      | Seleziona i nodi tramite ID              |
| `group_nodes`       | Raggruppa i nodi                         |
| `ungroup_node`      | Separa un gruppo                         |
| `flatten_nodes`     | Appiattisce i nodi in un singolo vettore |
| `boolean_union`     | Unione booleana di due o più nodi        |
| `boolean_subtract`  | Sottrazione booleana                     |
| `boolean_intersect` | Intersezione booleana                    |
| `boolean_exclude`   | Esclusione booleana                      |

### Percorso vettoriale

| Tool         | Description                                                  |
| ------------ | ------------------------------------------------------------ |
| `path_get`   | Ottiene i dati del path di un nodo vettoriale                |
| `path_set`   | Imposta i dati del path di un nodo vettoriale                |
| `path_scale` | Ridimensiona un path vettoriale                              |
| `path_flip`  | Capovolge un path vettoriale orizzontalmente o verticalmente |
| `path_move`  | Trasla un path vettoriale                                    |

### Esportazione

| Tool           | Description                                                                           |
| -------------- | ------------------------------------------------------------------------------------- |
| `export_image` | Esporta i nodi come PNG, JPG o WEBP. Restituisce i dati immagine codificati in base64 |
| `export_svg`   | Esporta i nodi come markup SVG                                                        |

### Viewport

| Tool                   | Description                                         |
| ---------------------- | --------------------------------------------------- |
| `viewport_get`         | Ottiene la posizione e lo zoom attuali del viewport |
| `viewport_set`         | Imposta posizione e zoom del viewport               |
| `viewport_zoom_to_fit` | Adatta lo zoom del viewport ai nodi specificati     |

### Variabili

| Tool                | Description                                         |
| ------------------- | --------------------------------------------------- |
| `get_variable`      | Ottiene una variabile tramite ID o nome             |
| `find_variables`    | Trova le variabili per pattern nel nome o tipo      |
| `create_variable`   | Crea una nuova variabile in una raccolta            |
| `set_variable`      | Imposta il valore di una variabile in una modalità  |
| `delete_variable`   | Elimina una variabile                               |
| `bind_variable`     | Collega una variabile a una proprietà di un nodo    |
| `get_collection`    | Ottiene una raccolta di variabili tramite ID o nome |
| `create_collection` | Crea una nuova raccolta di variabili                |
| `delete_collection` | Elimina una raccolta di variabili                   |

### Analisi

| Tool                 | Description                                           |
| -------------------- | ----------------------------------------------------- |
| `analyze_colors`     | Analizza l'uso della palette colori nel documento     |
| `analyze_typography` | Analizza la distribuzione di font/dimensione/spessore |
| `analyze_spacing`    | Analizza i valori di gap e padding                    |
| `analyze_clusters`   | Rileva pattern ripetuti (potenziali componenti)       |

### Diff

| Tool          | Description                                               |
| ------------- | --------------------------------------------------------- |
| `diff_create` | Crea uno snapshot dello stato corrente del documento      |
| `diff_show`   | Mostra le differenze tra lo stato corrente e uno snapshot |

### Navigazione

| Tool          | Description                          |
| ------------- | ------------------------------------ |
| `switch_page` | Passa a una pagina tramite nome o ID |

### Uscita di sicurezza

| Tool   | Description                                                     |
| ------ | --------------------------------------------------------------- |
| `eval` | Esegue JavaScript con accesso completo all'API del plugin Figma |

Nota: `eval` è disponibile tramite stdio, ma disabilitato in modalità HTTP per motivi di sicurezza.
