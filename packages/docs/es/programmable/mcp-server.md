---
title: MCP Server
description: Conecta herramientas de codificación con IA a OpenPencil para inspeccionar y editar diseños mediante el Model Context Protocol.
---

# MCP Server

OpenPencil incluye un servidor MCP que permite a las herramientas de codificación con IA — Claude Code, Cursor, Windsurf, etc. — leer y modificar diseños en la aplicación en ejecución. Dos binarios:

- **`openpencil-mcp`** — transporte stdio para clientes MCP
- **`openpencil-mcp-http`** — servidor HTTP + WebSocket para navegadores, scripts y el puente interno de la aplicación

## Requisitos previos

Antes de conectar cualquier cliente, asegúrate de:

1. La aplicación de escritorio de OpenPencil se está ejecutando **con un documento abierto**. El servidor MCP no sirve de nada sin una conexión con la aplicación: es un puente, no un renderizador.
2. La versión del paquete MCP coincide con la versión de la aplicación. El endpoint `/health` informa de las versiones para que los clientes puedan detectar discrepancias.

El servidor MCP se inicia automáticamente al lanzar la aplicación de escritorio (las compilaciones de producción de Tauri generan `openpencil-mcp-http`; el modo de desarrollo usa un plugin de Vite). También puedes ejecutarlo de forma independiente.

## Arquitectura

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

El puente stdio (`openpencil-mcp`) se conecta al servidor HTTP mediante un socket de dominio Unix (en macOS/Linux) o a través del puerto HTTP del archivo de descubrimiento (`httpPort`, en Windows o configuraciones sin socket). **No** habla MCP directamente con la aplicación: canaliza las llamadas a las herramientas MCP a través de HTTP hasta el servidor, que las reenvía a la aplicación en ejecución mediante WebSocket.

## Cómo se conecta

El servidor escribe un **archivo de descubrimiento** al iniciarse. El puente stdio lee este archivo para encontrar el servidor. No se necesita configuración manual.

Dos transportes: **stdio** para clientes MCP y **Streamable HTTP** para extensiones de navegador y scripts. En macOS y Linux, los clientes locales prefieren un socket de dominio Unix privado; Windows y los sockets no disponibles recurren a TCP en localhost.

## Instalación

```sh
npm install -g @open-pencil/mcp
```

## Stdio (Claude Code, Cursor, etc.)

El servidor stdio detecta automáticamente la aplicación de OpenPencil en ejecución. Prefiere el socket de dominio Unix de la aplicación en macOS y Linux y recurre a TCP en localhost cuando es necesario. Asegúrate de que la aplicación de escritorio esté abierta con un documento cargado.

### Claude Code

```sh
npm install -g @open-pencil/mcp
claude mcp add --scope user open-pencil -- openpencil-mcp
```

Verifica:

```sh
claude mcp list
```

Claude Code pregunta antes de usar cada herramienta MCP. Para aprobar automáticamente las herramientas de OpenPencil, añade lo siguiente a `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__open-pencil__*"]
  }
}
```

Ejemplo de prompt:

```text
Use the open-pencil MCP server to inspect the current page and create a small hero section on the canvas.
```

### Otros clientes MCP

Añade lo siguiente a tu configuración de MCP (p. ej., `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

Ejecuta desde el código fuente sin instalar:

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

Para extensiones de navegador, scripts, CI o cualquier cliente HTTP:

```sh
openpencil-mcp-http
```

O desde el código fuente: `bun packages/mcp/src/index.ts` / `npx tsx packages/mcp/src/index.ts`

Valores de seguridad predeterminados:

- El socket Unix y los archivos de descubrimiento se crean con permisos solo para el propietario en macOS y Linux.
- TCP se vincula a `127.0.0.1` y usa el puerto 7600 por defecto.
- La autenticación está habilitada por defecto con un token generado almacenado en el archivo de descubrimiento privado.
- `eval` está deshabilitado.
- Las operaciones de archivos se limitan a `OPENPENCIL_MCP_ROOT` (por defecto, el directorio de trabajo actual) y rechazan las fugas mediante enlaces simbólicos.
- CORS está deshabilitado por defecto; establece `OPENPENCIL_MCP_CORS_ORIGIN` para permitir un origen.

Establece `PORT=0` para deshabilitar TCP en macOS y Linux. Windows requiere TCP. Establece `OPENPENCIL_MCP_SOCKET` para anular la ruta del socket Unix, u `OPENPENCIL_MCP_DISCOVERY_PATH` para anular la ubicación del archivo de descubrimiento. Para proporcionar un token estable, establece `OPENPENCIL_MCP_AUTH_TOKEN`; un valor explícitamente vacío deshabilita la autenticación y solo debe usarse con un socket local de confianza.

Los endpoints están disponibles en ambos transportes activos:

- `GET /health` — estado de conexión del servidor y de la aplicación; nunca devuelve el token de autenticación.
- `POST /rpc` — automatización autenticada de la aplicación en vivo.
- `POST /mcp` — MCP Streamable HTTP. Las sesiones usan la cabecera `mcp-session-id`.

## Flujo de trabajo

1. **Descubrir objetivos** — llama a `list_documents` primero cuando pueda haber más de un documento o página abiertos. Devuelve `document_id` e IDs de página estables.
2. **Abrir** — `open_file` para cargar un `.fig` existente, o `new_document` para un lienzo en blanco. Devuelven los metadatos del documento abierto o creado.
3. **Lectura** — `get_page_tree`, `find_nodes`, `get_node`, `list_pages`
4. **Creación** — `create_shape`, `render` (JSX)
5. **Modificación** — `set_fill`, `set_stroke`, `set_layout`, `update_node`, `set_effects`
6. **Estructura** — `reparent_node`, `group_nodes`, `clone_node`, `delete_node`
7. **Guardar** — `save_file` para escribir de vuelta a `.fig`

La mayoría de las herramientas aceptan campos opcionales `document_id` y `page_id`. Pásalos explícitamente en los flujos de trabajo de agentes en lugar de depender de la pestaña/página activa visible. `create_page` solo crea una página; llama a `switch_page` por separado cuando el flujo de trabajo deba cambiar la página activa.

## Skill de agente IA

Enseña a tu agente de codificación con IA a usar las herramientas de OpenPencil:

```sh
npx skills add open-pencil/skills@open-pencil
```

Funciona con Claude Code, Cursor, Windsurf, Codex y cualquier agente compatible con [skills](https://skills.sh). El skill cubre la CLI, las herramientas MCP, el renderizado JSX, eval y el puente de automatización de la aplicación en ejecución.

## Herramientas (91)

### Documento

| Tool             | Description                                                           |
| ---------------- | --------------------------------------------------------------------- |
| `open_file`      | Abre un archivo `.fig` para editar                                    |
| `save_file`      | Guarda el documento actual en un archivo `.fig`                       |
| `new_document`   | Crea un documento nuevo vacío                                         |
| `list_documents` | Lista los documentos/pestañas abiertos de la aplicación y sus páginas |

Nota: `open_file`, `new_document` y las herramientas de exportación que escriben archivos se registran cuando se configura una raíz de archivos: los binarios distribuidos `openpencil-mcp` y `openpencil-mcp-http` siempre establecen una, usando el directorio de trabajo actual (`cwd()`) por defecto cuando `OPENPENCIL_MCP_ROOT` no está definido. La llamada programática `startServer({ mcpRoot: null })` omite `open_file` y `new_document` porque no se configura ninguna raíz. `save_file` siempre está registrado; su ruta se valida contra la raíz siempre que esté definida; de lo contrario, se usa la ruta del archivo existente.

### Lectura

| Tool               | Description                                                            |
| ------------------ | ---------------------------------------------------------------------- |
| `get_selection`    | Obtiene los nodos seleccionados actualmente                            |
| `get_page_tree`    | Obtiene el árbol de nodos completo de la página actual                 |
| `get_current_page` | Obtiene el nombre y el ID de la página actual                          |
| `get_node`         | Obtiene las propiedades detalladas de un nodo por ID                   |
| `find_nodes`       | Busca nodos por patrón de nombre y/o tipo                              |
| `get_components`   | Lista todos los componentes del documento                              |
| `list_pages`       | Lista todas las páginas                                                |
| `list_variables`   | Lista las variables de diseño                                          |
| `list_collections` | Lista las colecciones de variables                                     |
| `list_fonts`       | Lista las fuentes usadas en la página actual                           |
| `page_bounds`      | Obtiene el cuadro delimitador de todos los objetos de la página actual |
| `node_bounds`      | Obtiene el cuadro delimitador de un nodo                               |
| `node_ancestors`   | Obtiene la cadena de ancestros de un nodo                              |
| `node_children`    | Obtiene los hijos directos de un nodo                                  |
| `node_tree`        | Obtiene el subárbol con raíz en un nodo                                |
| `node_bindings`    | Obtiene los enlaces de variables de un nodo                            |

### Creación

| Tool                | Description                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `create_shape`      | Crea una forma (`FRAME`, `RECTANGLE`, `ELLIPSE`, `TEXT`, `LINE`, `STAR`, `POLYGON`, `SECTION`) |
| `create_vector`     | Crea un nodo vectorial a partir de una cadena de ruta                                          |
| `create_slice`      | Crea una slice de exportación                                                                  |
| `create_page`       | Crea una página nueva                                                                          |
| `render`            | Renderiza JSX a nodos de diseño — crea árboles de componentes completos en una sola llamada    |
| `create_component`  | Convierte un frame/grupo en un componente                                                      |
| `create_instance`   | Crea una instancia de un componente                                                            |
| `node_to_component` | Convierte un nodo existente en un componente en su lugar                                       |

### Modificación

| Tool                  | Description                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `set_fill`            | Establece el color de relleno (hex)                                                                                  |
| `set_stroke`          | Establece el color, el grosor y la alineación del contorno                                                           |
| `set_effects`         | Añade efectos de sombra o desenfoque                                                                                 |
| `update_node`         | Actualiza posición, tamaño, opacidad, radio de borde, texto y fuente                                                 |
| `set_layout`          | Establece el auto-layout (flexbox) — dirección, espaciado, padding y alineación                                      |
| `set_constraints`     | Establece las restricciones de redimensionamiento                                                                    |
| `set_rotation`        | Establece el ángulo de rotación en grados                                                                            |
| `set_opacity`         | Establece la opacidad (0–1)                                                                                          |
| `set_radius`          | Establece el radio de borde (uniforme o por esquina)                                                                 |
| `set_minmax`          | Establece las restricciones de ancho y alto mínimo/máximo                                                            |
| `set_text`            | Establece el contenido de texto de un nodo `TEXT`                                                                    |
| `set_font`            | Establece la familia y el peso de la fuente                                                                          |
| `set_font_range`      | Establece propiedades de fuente en un rango de caracteres                                                            |
| `set_text_resize`     | Establece el modo de auto-redimensionamiento del texto (fijo/ancho automático/alto automático)                       |
| `set_visible`         | Muestra u oculta un nodo                                                                                             |
| `set_blend`           | Establece el modo de fusión                                                                                          |
| `set_locked`          | Bloquea o desbloquea un nodo                                                                                         |
| `set_stroke_align`    | Establece la alineación del contorno (interior/centro/exterior)                                                      |
| `set_text_properties` | Establece el layout del texto: alineación, auto-redimensionamiento, mayúsculas/minúsculas, decoración y truncamiento |
| `set_layout_child`    | Configura el hijo de auto-layout: dimensionamiento, crecimiento, alineación y posicionamiento absoluto               |
| `node_move`           | Mueve un nodo a una posición nueva                                                                                   |
| `node_resize`         | Redimensiona un nodo                                                                                                 |
| `node_replace_with`   | Reemplaza un nodo por otro                                                                                           |
| `arrange`             | Alinea o distribuye los nodos seleccionados                                                                          |

### Estructura

| Tool                | Description                        |
| ------------------- | ---------------------------------- |
| `delete_node`       | Elimina un nodo                    |
| `clone_node`        | Duplica un nodo                    |
| `rename_node`       | Renombra un nodo                   |
| `reparent_node`     | Mueve un nodo a un padre diferente |
| `select_nodes`      | Selecciona nodos por ID            |
| `group_nodes`       | Agrupa nodos                       |
| `ungroup_node`      | Desagrupa un grupo                 |
| `flatten_nodes`     | Aplana nodos en un único vector    |
| `boolean_union`     | Unión booleana de dos o más nodos  |
| `boolean_subtract`  | Sustracción booleana               |
| `boolean_intersect` | Intersección booleana              |
| `boolean_exclude`   | Exclusión booleana                 |

### Ruta vectorial

| Tool         | Description                                          |
| ------------ | ---------------------------------------------------- |
| `path_get`   | Obtiene los datos de ruta de un nodo vectorial       |
| `path_set`   | Establece los datos de ruta de un nodo vectorial     |
| `path_scale` | Escala una ruta vectorial                            |
| `path_flip`  | Voltea una ruta vectorial horizontal o verticalmente |
| `path_move`  | Traslada una ruta vectorial                          |

### Exportación

| Tool           | Description                                                                            |
| -------------- | -------------------------------------------------------------------------------------- |
| `export_image` | Exporta nodos como PNG, JPG o WEBP. Devuelve los datos de imagen codificados en base64 |
| `export_svg`   | Exporta nodos como marcado SVG                                                         |

### Viewport

| Tool                   | Description                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| `viewport_get`         | Obtiene la posición y el nivel de zoom actuales del viewport     |
| `viewport_set`         | Establece la posición y el zoom del viewport                     |
| `viewport_zoom_to_fit` | Ajusta el zoom del viewport para mostrar los nodos especificados |

### Variables

| Tool                | Description                                        |
| ------------------- | -------------------------------------------------- |
| `get_variable`      | Obtiene una variable por ID o nombre               |
| `find_variables`    | Busca variables por patrón de nombre o tipo        |
| `create_variable`   | Crea una variable nueva en una colección           |
| `set_variable`      | Establece el valor de una variable en un modo      |
| `delete_variable`   | Elimina una variable                               |
| `bind_variable`     | Vincula una variable a una propiedad de un nodo    |
| `get_collection`    | Obtiene una colección de variables por ID o nombre |
| `create_collection` | Crea una colección de variables nueva              |
| `delete_collection` | Elimina una colección de variables                 |

### Análisis

| Tool                 | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `analyze_colors`     | Analiza el uso de la paleta de colores en el documento |
| `analyze_typography` | Analiza la distribución de fuentes/tamaños/pesos       |
| `analyze_spacing`    | Analiza los valores de espaciado y padding             |
| `analyze_clusters`   | Detecta patrones repetidos (posibles componentes)      |

### Diff

| Tool          | Description                                                      |
| ------------- | ---------------------------------------------------------------- |
| `diff_create` | Crea una instantánea del estado actual del documento             |
| `diff_show`   | Muestra las diferencias entre el estado actual y una instantánea |

### Navegación

| Tool          | Description                         |
| ------------- | ----------------------------------- |
| `switch_page` | Cambia a una página por nombre o ID |

### Escotilla de escape

| Tool   | Description                                                         |
| ------ | ------------------------------------------------------------------- |
| `eval` | Ejecuta JavaScript con acceso completo a la API del Plugin de Figma |

Nota: `eval` está disponible a través de stdio, pero está deshabilitado en el modo HTTP por seguridad.
