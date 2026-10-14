# WikiES

Extensión de Chrome que detecta artículos de Wikipedia en inglés, portugués o francés **sin versión en español** y genera un wikitexto traducido, editable y listo para pegar en la Wikipedia en español.

## Qué hace

- Comprueba si el artículo ya existe en `es.wikipedia.org` mediante *langlinks*.
- Descarga el wikitexto original y lo traduce con la API de OpenAI.
- Enmascara plantillas, infoboxes, tablas y categorías para traducir la prosa aparte.
- Resuelve el nombre **real** de cada plantilla/categoría en español consultando la API de Wikipedia (`Template:`/`Predefinição:` → `Plantilla:`, `Category:`/`Categoria:` → `Categoría:`).
- Genera la plantilla de atribución `{{Traducido ref}}` y un resumen de edición.
- Muestra un panel editable con avisos (categorías/plantillas sin equivalente, citas pendientes…).

## Fuentes soportadas

- `https://en.wikipedia.org/wiki/*` (inglés → español)
- `https://pt.wikipedia.org/wiki/*` (portugués → español)
- `https://fr.wikipedia.org/wiki/*` (francés → español)

## Instalación (modo desarrollador)

1. Descarga o clona este repositorio.
2. Abre `chrome://extensions` en Chrome (o `edge://extensions`).
3. Activa **Modo de desarrollador**.
4. Pulsa **Cargar descomprimida** y selecciona la carpeta del proyecto.

## Configuración

1. Haz clic en el icono de la extensión → **Opciones** (o clic derecho → Opciones).
2. Introduce tu **OpenAI API key** (`sk-...`).
3. Elige el modelo de traducción (por defecto `gpt-4o-mini`).

> La clave se guarda únicamente en `chrome.storage.local`, en tu navegador. No se envía a ningún servidor propio: solo se usa para llamar directamente a `api.openai.com`.

## Uso

1. Abre un artículo en `en.wikipedia.org`, `pt.wikipedia.org` o `fr.wikipedia.org`.
2. Pulsa el botón flotante **→ ES (WikiES)**.
3. Pulsa **Traducir** y revisa el resultado.
4. Copia el wikitexto o usa **Copiar y abrir editor ES** para pegarlo.

## Cómo funciona

1. **Enmascarado**: plantillas, tablas y categorías se sustituyen por marcadores `⟪T0⟫`, `⟪T1⟫`…
2. **Traducción de prosa**: el texto con marcadores se traduce por bloques.
3. **Resolución de plantillas/categorías**: se consultan *langlinks* reales de Wikipedia; lo que no tiene equivalente se marca o comenta.
4. **Recomposición**: se reconstruye el wikitexto, se normalizan parámetros de cita y se inserta la atribución.

## Aviso

La traducción automática no sustituye una revisión humana. Revisa siempre el resultado antes de publicar.

## Licencia

[MIT](LICENSE)
