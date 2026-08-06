---
title: MCP Server
description: Połącz narzędzia AI do kodowania z OpenPencil, aby przeglądać i edytować projekty przez Model Context Protocol.
---

# MCP Server

OpenPencil zawiera serwer MCP, który pozwala narzędziom AI do kodowania — Claude Code, Cursor, Windsurf itd. — odczytywać i modyfikować projekty w działającej aplikacji. Dwa pliki binarne:

- **`openpencil-mcp`** — transport stdio dla klientów MCP
- **`openpencil-mcp-http`** — serwer HTTP + WebSocket dla przeglądarek, skryptów i wewnętrznego mostu aplikacji

## Wymagania wstępne

Przed podłączeniem dowolnego klienta upewnij się, że:

1. Aplikacja desktopowa OpenPencil działa **z otwartym dokumentem**. Serwer MCP jest bezużyteczny bez połączenia z aplikacją — to most, a nie renderer.
2. Wersja pakietu MCP odpowiada wersji aplikacji. Endpoint `/health` raportuje wersje, dzięki czemu klienci mogą wykryć niezgodności.

Serwer MCP uruchamia się automatycznie przy starcie aplikacji desktopowej (buildy produkcyjne Tauri uruchamiają `openpencil-mcp-http`; tryb dev używa pluginu Vite). Można też uruchomić go samodzielnie.

## Architektura

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

Most stdio (`openpencil-mcp`) łączy się z serwerem HTTP przez gniazdo domeny Unix (na macOS/Linux) lub przez port HTTP z pliku discovery (`httpPort`, na Windows lub w konfiguracjach bez gniazda). Nie mówi MCP bezpośrednio do aplikacji — tuneluje wywołania narzędzi MCP przez HTTP do serwera, który przekazuje je do działającej aplikacji przez WebSocket.

## Jak się łączy

Serwer zapisuje **plik discovery** przy starcie. Most stdio czyta ten plik, aby znaleźć serwer. Nie jest wymagana żadna ręczna konfiguracja.

Dwa transporty: **stdio** dla klientów MCP oraz **Streamable HTTP** dla rozszerzeń przeglądarki i skryptów. Na macOS i Linux lokalni klienci preferują prywatne gniazdo domeny Unix; Windows i niedostępne gniazda korzystają z zapasowego TCP na localhost.

## Instalacja

```sh
npm install -g @open-pencil/mcp
```

## Stdio (Claude Code, Cursor itd.)

Serwer stdio automatycznie wykrywa działającą aplikację OpenPencil. Na macOS i Linux preferuje gniazdo domeny Unix aplikacji, a w razie potrzeby korzysta z zapasowego TCP na localhost. Upewnij się, że aplikacja desktopowa jest otwarta z załadowanym dokumentem.

### Claude Code

```sh
npm install -g @open-pencil/mcp
claude mcp add --scope user open-pencil -- openpencil-mcp
```

Weryfikacja:

```sh
claude mcp list
```

Claude Code pyta przed użyciem każdego narzędzia MCP. Aby automatycznie zatwierdzać narzędzia OpenPencil, dodaj do `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__open-pencil__*"]
  }
}
```

Przykładowy prompt:

```text
Use the open-pencil MCP server to inspect the current page and create a small hero section on the canvas.
```

### Inni klienci MCP

Dodaj do konfiguracji MCP (np. `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

Uruchomienie ze źródeł bez instalacji:

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

Dla rozszerzeń przeglądarki, skryptów, CI lub dowolnego klienta HTTP:

```sh
openpencil-mcp-http
```

Albo ze źródeł: `bun packages/mcp/src/index.ts` / `npx tsx packages/mcp/src/index.ts`

Domyślne ustawienia bezpieczeństwa:

- Gniazdo Unix i pliki discovery są tworzone z uprawnieniami tylko dla właściciela na macOS i Linux.
- TCP wiąże się z `127.0.0.1` i domyślnie używa portu 7600.
- Uwierzytelnianie jest domyślnie włączone z wygenerowanym tokenem przechowywanym w prywatnym pliku discovery.
- `eval` jest wyłączony.
- Operacje na plikach są ograniczone do `OPENPENCIL_MCP_ROOT` (domyślnie bieżący katalog roboczy) i odrzucają wyjście poza ścieżką przez symlinki.
- CORS jest domyślnie wyłączony; ustaw `OPENPENCIL_MCP_CORS_ORIGIN`, aby zezwolić na jeden origin.

Ustaw `PORT=0`, aby wyłączyć TCP na macOS i Linux. Windows wymaga TCP. Ustaw `OPENPENCIL_MCP_SOCKET`, aby nadpisać ścieżkę gniazda Unix, lub `OPENPENCIL_MCP_DISCOVERY_PATH`, aby nadpisać lokalizację pliku discovery. Aby zapewnić stabilny token, ustaw `OPENPENCIL_MCP_AUTH_TOKEN`; jawnie pusta wartość wyłącza uwierzytelnianie i powinna być używana tylko z zaufanym lokalnym gniazdem.

Endpointy są dostępne na obu aktywnych transportach:

- `GET /health` — status połączenia serwera i aplikacji; nigdy nie zwraca tokenu uwierzytelniającego.
- `POST /rpc` — uwierzytelniona automatyzacja działającej aplikacji.
- `POST /mcp` — MCP Streamable HTTP. Sesje używają nagłówka `mcp-session-id`.

## Przepływ pracy

1. **Wykryj cele** — najpierw wywołaj `list_documents`, gdy może być otwartych więcej niż jeden dokument lub strona. Zwraca stabilne `document_id` i ID stron.
2. **Otwórz** — `open_file`, aby wczytać istniejący `.fig`, lub `new_document` dla pustego płótna. Zwracają one metadane celu dla otwartego lub utworzonego dokumentu.
3. **Odczyt** — `get_page_tree`, `find_nodes`, `get_node`, `list_pages`
4. **Tworzenie** — `create_shape`, `render` (JSX)
5. **Modyfikacja** — `set_fill`, `set_stroke`, `set_layout`, `update_node`, `set_effects`
6. **Struktura** — `reparent_node`, `group_nodes`, `clone_node`, `delete_node`
7. **Zapis** — `save_file`, aby zapisać z powrotem do `.fig`

Większość narzędzi przyjmuje opcjonalne pola `document_id` i `page_id`. Przekazuj je jawnie w przepływach agentów zamiast polegać na widocznej aktywnej karcie/stronie. `create_page` tworzy tylko stronę; wywołaj osobno `switch_page`, gdy przepływ pracy powinien zmienić aktywną stronę.

## Umiejętność agenta AI

Naucz swojego agenta AI do kodowania korzystania z narzędzi OpenPencil:

```sh
npx skills add open-pencil/skills@open-pencil
```

Działa z Claude Code, Cursor, Windsurf, Codex i dowolnym agentem obsługującym [skills](https://skills.sh). Umiejętność obejmuje CLI, narzędzia MCP, renderowanie JSX, eval i most automatyzacji działającej aplikacji.

## Narzędzia (91)

### Dokument

| Tool             | Description                                 |
| ---------------- | ------------------------------------------- |
| `open_file`      | Otwórz plik `.fig` do edycji                |
| `save_file`      | Zapisz bieżący dokument do pliku `.fig`     |
| `new_document`   | Utwórz nowy pusty dokument                  |
| `list_documents` | Lista otwartych dokumentów/kart i ich stron |

Uwaga: `open_file`, `new_document` oraz narzędzia eksportu zapisujące pliki są rejestrowane, gdy skonfigurowany jest katalog główny plików — dołączane binaria `openpencil-mcp` i `openpencil-mcp-http` zawsze go ustawiają, domyślnie na bieżący katalog roboczy (`cwd()`), gdy `OPENPENCIL_MCP_ROOT` nie jest ustawiony. Programowe `startServer({ mcpRoot: null })` pomija `open_file` i `new_document`, ponieważ nie skonfigurowano katalogu głównego. `save_file` jest zawsze rejestrowany; jego ścieżka jest weryfikowana względem katalogu głównego, gdy ten jest ustawiony, w przeciwnym razie używana jest istniejąca ścieżka pliku.

### Odczyt

| Tool               | Description                                              |
| ------------------ | -------------------------------------------------------- |
| `get_selection`    | Pobierz aktualnie zaznaczone węzły                       |
| `get_page_tree`    | Pobierz pełne drzewo węzłów bieżącej strony              |
| `get_current_page` | Pobierz nazwę i ID bieżącej strony                       |
| `get_node`         | Pobierz szczegółowe właściwości węzła po ID              |
| `find_nodes`       | Znajdź węzły według wzorca nazwy i/lub typu              |
| `get_components`   | Lista wszystkich komponentów w dokumencie                |
| `list_pages`       | Lista wszystkich stron                                   |
| `list_variables`   | Lista zmiennych projektu                                 |
| `list_collections` | Lista kolekcji zmiennych                                 |
| `list_fonts`       | Lista czcionek używanych na bieżącej stronie             |
| `page_bounds`      | Pobierz ramkę ograniczającą obiektów na bieżącej stronie |
| `node_bounds`      | Pobierz ramkę ograniczającą węzła                        |
| `node_ancestors`   | Pobierz łańcuch przodków węzła                           |
| `node_children`    | Pobierz bezpośrednie dzieci węzła                        |
| `node_tree`        | Pobierz poddrzewo z węzłem jako korzeniem                |
| `node_bindings`    | Pobierz powiązania zmiennych na węźle                    |

### Tworzenie

| Tool                | Description                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `create_shape`      | Utwórz kształt (`FRAME`, `RECTANGLE`, `ELLIPSE`, `TEXT`, `LINE`, `STAR`, `POLYGON`, `SECTION`) |
| `create_vector`     | Utwórz węzeł wektorowy z ciągu ścieżki                                                         |
| `create_slice`      | Utwórz wycinek eksportu                                                                        |
| `create_page`       | Utwórz nową stronę                                                                             |
| `render`            | Renderuj JSX do węzłów projektu — utwórz całe drzewa komponentów w jednym wywołaniu            |
| `create_component`  | Przekształć ramkę/grupę w komponent                                                            |
| `create_instance`   | Utwórz instancję komponentu                                                                    |
| `node_to_component` | Przekształć istniejący węzeł w komponent w miejscu                                             |

### Modyfikacja

| Tool                  | Description                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `set_fill`            | Ustaw kolor wypełnienia (hex)                                                              |
| `set_stroke`          | Ustaw kolor, grubość i wyrównanie obrysu                                                   |
| `set_effects`         | Dodaj efekty cienia lub rozmycia                                                           |
| `update_node`         | Aktualizuj pozycję, rozmiar, przezroczystość, promień narożników, tekst, czcionkę          |
| `set_layout`          | Ustaw auto-layout (flexbox) — kierunek, odstępy, padding, wyrównanie                       |
| `set_constraints`     | Ustaw ograniczenia zmiany rozmiaru                                                         |
| `set_rotation`        | Ustaw kąt obrotu w stopniach                                                               |
| `set_opacity`         | Ustaw przezroczystość (0–1)                                                                |
| `set_radius`          | Ustaw promień narożników (jednolity lub per narożnik)                                      |
| `set_minmax`          | Ustaw ograniczenia min/maks szerokości i wysokości                                         |
| `set_text`            | Ustaw treść tekstową węzła `TEXT`                                                          |
| `set_font`            | Ustaw rodzinę czcionki i grubość                                                           |
| `set_font_range`      | Ustaw właściwości czcionki na zakresie znaków                                              |
| `set_text_resize`     | Ustaw tryb automatycznego rozmiaru tekstu (stały/szerokość/wysokość automatyczna)          |
| `set_visible`         | Pokaż lub ukryj węzeł                                                                      |
| `set_blend`           | Ustaw tryb mieszania                                                                       |
| `set_locked`          | Zablokuj lub odblokuj węzeł                                                                |
| `set_stroke_align`    | Ustaw wyrównanie obrysu (wewnątrz/środek/na zewnątrz)                                      |
| `set_text_properties` | Ustaw układ tekstu: wyrównanie, auto-resize, wielkość liter, dekoracja, przycięcie         |
| `set_layout_child`    | Skonfiguruj dziecko auto-layoutu: wymiarowanie, grow, wyrównanie, pozycjonowanie absolutne |
| `node_move`           | Przesuń węzeł na nową pozycję                                                              |
| `node_resize`         | Zmień rozmiar węzła                                                                        |
| `node_replace_with`   | Zastąp węzeł innym węzłem                                                                  |
| `arrange`             | Wyrównaj lub rozłóż zaznaczone węzły                                                       |

### Struktura

| Tool                | Description                            |
| ------------------- | -------------------------------------- |
| `delete_node`       | Usuń węzeł                             |
| `clone_node`        | Zduplikuj węzeł                        |
| `rename_node`       | Zmień nazwę węzła                      |
| `reparent_node`     | Przenieś węzeł do innego rodzica       |
| `select_nodes`      | Zaznacz węzły po ID                    |
| `group_nodes`       | Grupuj węzły                           |
| `ungroup_node`      | Rozgrupuj grupę                        |
| `flatten_nodes`     | Spłaszcz węzły do pojedynczego wektora |
| `boolean_union`     | Suma boolowska dwóch lub więcej węzłów |
| `boolean_subtract`  | Odejmowanie boolowskie                 |
| `boolean_intersect` | Przecięcie boolowskie                  |
| `boolean_exclude`   | Wykluczenie boolowskie                 |

### Ścieżka wektorowa

| Tool         | Description                                 |
| ------------ | ------------------------------------------- |
| `path_get`   | Pobierz dane ścieżki węzła wektorowego      |
| `path_set`   | Ustaw dane ścieżki węzła wektorowego        |
| `path_scale` | Skaluj ścieżkę wektorową                    |
| `path_flip`  | Odbij ścieżkę wektorową poziomo lub pionowo |
| `path_move`  | Przesuń ścieżkę wektorową                   |

### Eksport

| Tool           | Description                                                                    |
| -------------- | ------------------------------------------------------------------------------ |
| `export_image` | Eksportuj węzły jako PNG, JPG lub WEBP. Zwraca dane obrazu zakodowane w base64 |
| `export_svg`   | Eksportuj węzły jako znaczniki SVG                                             |

### Widok

| Tool                   | Description                                   |
| ---------------------- | --------------------------------------------- |
| `viewport_get`         | Pobierz bieżącą pozycję widoku i poziom zoomu |
| `viewport_set`         | Ustaw pozycję i zoom widoku                   |
| `viewport_zoom_to_fit` | Dostosuj zoom widoku do wskazanych węzłów     |

### Zmienne

| Tool                | Description                                 |
| ------------------- | ------------------------------------------- |
| `get_variable`      | Pobierz zmienną po ID lub nazwie            |
| `find_variables`    | Znajdź zmienne według wzorca nazwy lub typu |
| `create_variable`   | Utwórz nową zmienną w kolekcji              |
| `set_variable`      | Ustaw wartość zmiennej w trybie             |
| `delete_variable`   | Usuń zmienną                                |
| `bind_variable`     | Powiąż zmienną z właściwością węzła         |
| `get_collection`    | Pobierz kolekcję zmiennych po ID lub nazwie |
| `create_collection` | Utwórz nową kolekcję zmiennych              |
| `delete_collection` | Usuń kolekcję zmiennych                     |

### Analiza

| Tool                 | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `analyze_colors`     | Analizuj użycie palety kolorów w dokumencie               |
| `analyze_typography` | Analizuj rozkład czcionek/rozmiarów/grubości              |
| `analyze_spacing`    | Analizuj wartości odstępów i paddingów                    |
| `analyze_clusters`   | Wykrywaj powtarzające się wzorce (potencjalne komponenty) |

### Diff

| Tool          | Description                                    |
| ------------- | ---------------------------------------------- |
| `diff_create` | Utwórz migawkę bieżącego stanu dokumentu       |
| `diff_show`   | Pokaż różnice między bieżącym stanem a migawką |

### Nawigacja

| Tool          | Description                         |
| ------------- | ----------------------------------- |
| `switch_page` | Przełącz na stronę po nazwie lub ID |

### Wyjście awaryjne

| Tool   | Description                                              |
| ------ | -------------------------------------------------------- |
| `eval` | Wykonaj JavaScript z pełnym dostępem do Figma Plugin API |

Uwaga: `eval` jest dostępny przez stdio, ale wyłączony w trybie HTTP ze względów bezpieczeństwa.
