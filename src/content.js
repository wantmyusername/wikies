/* WikiES — content script
 * Detecta artículos de en.wikipedia.org o pt.wikipedia.org sin versión en
 * español, traduce el wikitexto con OpenAI y muestra un panel editable para
 * copiar/pegar.
 *
 * Tratamiento de "artefactos" (plantillas/infobox/categorías):
 *   1. Se ENMASCARAN plantillas, tablas y categorías con marcadores ⟪T0⟫, ⟪T1⟫…
 *   2. El nombre español REAL de cada plantilla/categoría se obtiene de la API
 *      de Wikipedia (prop=langlinks: Template:X -> Plantilla:Y, Category:X ->
 *      Categoría:Y). Es la fuente autoritativa, no un mapa inventado.
 *   3. La prosa se traduce aparte; las plantillas se traducen con el mapa real.
 *   4. Se recompone todo y se listan avisos útiles (categorías sin equivalente,
 *      citas en inglés pendientes, etc.).
 */
(() => {
  "use strict";
  if (window.__wikiESLoaded) return;
  window.__wikiESLoaded = true;

  // Idioma de origen según el host donde se inyecta el script. Por defecto en.
  const SOURCE_LANG = /^pt\.wikipedia\.org$/i.test(location.hostname) ? "pt" : "en";
  const SOURCE_LANG_NAME = SOURCE_LANG === "pt" ? "portugués" : "inglés";
  const SOURCE_API = "https://" + SOURCE_LANG + ".wikipedia.org/w/api.php";
  const ES_API = "https://es.wikipedia.org/w/api.php";

  // Namespaces reales de las plantillas y categorías del wiki de origen.
  const SRC_TPL_NS = SOURCE_LANG === "pt" ? "Predefinição" : "Template";
  const SRC_CAT_NS = SOURCE_LANG === "pt" ? "Categoria" : "Category";

  const TOKEN_RE = /⟪T(\d+)⟫/g;
  const tokenOf = (i) => "⟪T" + i + "⟫";

  // Mapa de respaldo (solo se usa si la API no devuelve langlink). El mapa real
  // que se pasa a la IA se construye con langlinks y SIEMPRE tiene prioridad.
  const TEMPLATE_MAP = {
    "Infobox person": "Ficha de persona",
    "Infobox musical artist": "Ficha de agrupación artística",
    "Infobox album": "Ficha de álbum",
    "Infobox song": "Ficha de sencillo",
    "Infobox writer": "Ficha de escritor",
    "Infobox actor": "Ficha de actor",
    "Infobox scientist": "Ficha de científico",
    "Infobox politician": "Ficha de político",
    "Infobox officeholder": "Ficha de cargo público",
    "Infobox company": "Ficha de organización",
    "Infobox football club": "Ficha de equipo de fútbol",
    "Infobox settlement": "Ficha de entidad subnacional",
    "Infobox country": "Ficha de país",
    "Infobox film": "Ficha de película",
    "Infobox television": "Ficha de serie de televisión",
    "Infobox video game": "Ficha de videojuego",
    "Infobox book": "Ficha de libro",
    "Infobox university": "Ficha de universidad",
    "Infobox school": "Ficha de escuela",
    "Infobox sportsperson": "Ficha de deportista",
    "cite web": "cita web",
    "cite news": "cita noticia",
    "cite book": "cita libro",
    "cite journal": "cita publicación",
    "cite magazine": "cita revista",
    "cite conference": "cita conferencia",
    "cite encyclopedia": "cita enciclopedia",
    reflist: "listaref",
    Reflist: "listaref",
    references: "listaref",
    "Authority control": "Control de autoridades",
    "Commons category": "Commonscat",
    "birth date and age": "fecha de nacimiento y edad",
    "birth date": "fecha de nacimiento",
    "death date and age": "fecha de fallecimiento y edad",
    convert: "convertir",
    flagicon: "bandera",
    flag: "bandera",
    lang: "lang",
    IPA: "IPA",
    // Respaldo para plantillas frecuentes de pt.wikipedia (el langlink real
    // tiene prioridad). Clave = nombre en el wiki de origen.
    "Info/artista musical": "Ficha de agrupación artística",
    "Info/álbum": "Ficha de álbum",
    "Info/single": "Ficha de sencillo",
    "Info/escritor": "Ficha de escritor",
    "Info/ator": "Ficha de actor",
    "Info/cientista": "Ficha de científico",
    "Info/político": "Ficha de político",
    "Info/empresa": "Ficha de organización",
    "Info/clube de futebol": "Ficha de equipo de fútbol",
    "Info/assentamento": "Ficha de entidad subnacional",
    "Info/país": "Ficha de país",
    "Info/filme": "Ficha de película",
    "Info/série de televisão": "Ficha de serie de televisión",
    "Info/jogo eletrônico": "Ficha de videojuego",
    "Info/livro": "Ficha de libro",
    "Info/universidade": "Ficha de universidad",
    "Info/escola": "Ficha de escuela",
    "Info/desportista": "Ficha de deportista",
    "citar web": "cita web",
    "citar livro": "cita libro",
    "citar notícia": "cita noticia",
    "citar jornal": "cita noticia",
    "citar revista": "cita revista",
    "citar periódico": "cita publicación",
    "citar conferência": "cita conferencia",
    "citar enciclopédia": "cita enciclopedia",
    "Citar web": "cita web",
    "Citar livro": "cita libro",
    "Citar notícia": "cita noticia",
    "Citar jornal": "cita noticia",
    "Lista de referências": "listaref",
    "Controle de autoridade": "Control de autoridades",
    "Commons": "Commonscat",
    "data de nascimento e idade": "fecha de nacimiento y edad",
    "data de nascimento": "fecha de nacimiento",
    "data de falecimento e idade": "fecha de fallecimiento y edad",
    "converter": "convertir",
    "bandeira": "bandera",
  };

  // Plantillas de mantenimiento/formato que deben eliminarse.
  const TEMPLATE_REMOVE = [
    "Use mdy dates",
    "Use dmy dates",
    "Use British English",
    "Use American English",
    "Short description",
    "Good article",
    "Featured article",
    "Cleanup",
    "More citations needed",
    // Mantenimiento en pt.wikipedia.
    "Sem fontes",
    "Mais fontes",
    "Sem referências",
    "Reciclagem",
    "Wikificar",
    "Má formatação",
    "Parcial",
    "Desatualizado",
    "Info/Sem fontes",
  ];

  const PROSE_SYSTEM = `Eres un traductor profesional de Wikipedia (${SOURCE_LANG_NAME} → español). Traduce el texto al español enciclopédico natural y fluido.
REGLAS ESTRICTAS:
- Conserva EXACTAMENTE los marcadores ⟪T0⟫, ⟪T1⟫… sin cambiar el número ni añadir espacios.
- Conserva la sintaxis wiki: [[enlaces]], [[Enlace|texto]], encabezados (==, ===), '''negrita''', ''cursiva'', listas (* #), tablas, <ref>, </ref>, <ref name="...">, y etiquetas HTML.
- Traduce el texto visible de los enlaces internos cuando sea un término común; deja igual nombres propios, títulos de obras y nombres de archivos.
- Devuelve ÚNICAMENTE la traducción. No añadas comentarios, títulos ni explicaciones.`;

  const TEMPLATE_SYSTEM = `Conviertes plantillas de la Wikipedia en ${SOURCE_LANG_NAME} a la Wikipedia en español.
Recibirás JSON: {"blocks":[{"id":0,"en":"{{...}}"}]}.
Devuelve SOLO un objeto JSON con la forma {"<id>":"<wikitexto convertido>"} para CADA id.
REGLAS:
- Sustituye el nombre de la plantilla por su equivalente español usando el MAPA (clave=nombre en el wiki de origen, valor=español). El mapa es autoritativo: si aparece ahí, usa ESE nombre.
- Traduce también los NOMBRES de los parámetros al español habitual de esa plantilla y los valores legibles (fechas, lugares, cargos, descripciones, roles).
- Elimina las plantillas de esta lista (devuelve "" para ellas): __REMOVE__.
- NO cambies: URLs, nombres de archivos (File:...), refs (ref name), números, códigos de idioma.
- Si una plantilla no tiene equivalente claro, devuélvela envuelta en un comentario HTML con el prefijo EXACTO: <!-- sin-equivalente: NOMBRE ... -->
- Mantén el wikitexto válido. No escribas texto fuera del JSON.`;

  // Nombres de parámetro reales de las plantillas de cita en es.wikipedia.
  const CITE_GUIDE = `PARA PLANTILLAS DE CITA (cita web, cita noticia, cita libro, cita publicación, cita conferencia) usa SOLO estos parámetros, SIN guiones ni guiones bajos:
url, título, apellido, nombre, apellido1, nombre1, autor, autores, enlaceautor, fecha, sitioweb, obra, editorial, ubicación, idioma, fechaacceso, urlarchivo, fechaarchivo, urlmuerta, páginas, volumen, número, publicación, isbn, doi, pmid, pmc, cita, formato, vía, ref.
PROHIBIDO inventar: trabajo, sitio_web, fecha-acceso, url-archivo, fecha-archivo, estado-url, website, work, publisher, access-date, archive-url, archive-date, accessdate, archivedate.`;

  // Correcciones deterministas de parámetros de cita (inglés/errores -> es).
  const CITE_PARAM_FIXES = {
    sitio_web: "sitioweb",
    "sitio web": "sitioweb",
    website: "sitioweb",
    fecha_acceso: "fechaacceso",
    "fecha-acceso": "fechaacceso",
    "access-date": "fechaacceso",
    accessdate: "fechaacceso",
    url_archivo: "urlarchivo",
    "url-archivo": "urlarchivo",
    "archive-url": "urlarchivo",
    archiveurl: "urlarchivo",
    fecha_archivo: "fechaarchivo",
    "fecha-archivo": "fechaarchivo",
    "archive-date": "fechaarchivo",
    archivedate: "fechaarchivo",
    "estado-url": "urlmuerta",
    "url-status": "urlmuerta",
    urlstatus: "urlmuerta",
    trabajo: "obra",
    work: "obra",
    publisher: "editorial",
    "author-link": "enlaceautor",
    authorlink: "enlaceautor",
    pages: "páginas",
    page: "página",
    volume: "volumen",
    issue: "número",
    journal: "publicación",
    via: "vía",
    quote: "cita",
    format: "formato",
    language: "idioma",
    last: "apellido",
    first: "nombre",
    last1: "apellido1",
    first1: "nombre1",
    last2: "apellido2",
    first2: "nombre2",
    last3: "apellido3",
    first3: "nombre3",
    title: "título",
    titulo: "título",
    "trans-title": "título-trad",
    location: "ubicación",
    ubicacion: "ubicación",
    paginas: "páginas",
    numero: "número",
    publicacion: "publicación",
    author: "autor",
    authors: "autores",
    // Parámetros habituales de las plantillas «citar» de pt.wikipedia.
    acessodata: "fechaacceso",
    acessodata2: "fechaacceso",
    data: "fecha",
    publicado: "editorial",
    editora: "editorial",
    local: "ubicación",
    língua: "idioma",
    lingua: "idioma",
    páginas: "páginas",
    pagina: "página",
    publicação: "publicación",
    periódico: "publicación",
    jornal: "publicación",
    revista: "publicación",
    número: "número",
    edição: "número",
    primeira: "nombre1",
    primeiro: "nombre1",
    última: "apellido1",
    último: "apellido1",
    "último-nome": "apellido1",
    autoria: "autor",
    citação: "cita",
    arquivourl: "urlarchivo",
    "arquivo-url": "urlarchivo",
    arquivodata: "fechaarchivo",
    "arquivo-data": "fechaarchivo",
    urlmorta: "urlmuerta",
    "url-morta": "urlmuerta",
    formato: "formato",
    título: "título",
    capítulo: "capítulo",
    transcrição: "cita",
  };

  // Plantillas de premios (tablas de galardones) inglés -> {{Celda|...}} en ES.
  const AWARD_CELLS = {
    won: "{{Celda|Ganador}}",
    win: "{{Celda|Ganador}}",
    nom: "{{Celda|Nominado}}",
    nominated: "{{Celda|Nominado}}",
    nomination: "{{Celda|Nominado}}",
    pending: "{{Celda|Pendiente}}",
  };

  function normalizeCiteParams(wt) {
    let out = wt.replace(/(\|\s*)([A-Za-z0-9_\- ]+?)(\s*=)/g, (_m, pre, key, eq) => {
      const mapped = CITE_PARAM_FIXES[key.toLowerCase()];
      return pre + (mapped || key) + eq;
    });
    out = out.replace(/(\|\s*urlmuerta\s*=\s*)(live|dead|usurped|unfit|bot:\s*unknown)/gi, (_m, pre, v) => {
      return pre + (v.toLowerCase() === "live" ? "no" : "sí");
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Red
  // ---------------------------------------------------------------------------
  async function sourceApi(params) {
    const u = new URL(SOURCE_API);
    u.search = new URLSearchParams(Object.assign({ format: "json", formatversion: "2", origin: "*" }, params));
    const r = await fetch(u.toString());
    if (!r.ok) throw new Error("API " + r.status);
    return r.json();
  }

  async function esApi(params) {
    const u = new URL(ES_API);
    u.search = new URLSearchParams(Object.assign({ format: "json", formatversion: "2", origin: "*", lang: "es" }, params));
    const r = await fetch(u.toString());
    if (!r.ok) throw new Error("API " + r.status);
    return r.json();
  }

  // Parámetros REALES de las plantillas en es.wikipedia (acción templatedata).
  async function getTemplateParams(esNames) {
    const uniq = [...new Set((esNames || []).map((n) => String(n).replace(/^Plantilla:/, "").trim()).filter(Boolean))];
    const out = {};
    for (let i = 0; i < uniq.length; i += 40) {
      const part = uniq.slice(i, i + 40);
      try {
        const d = await esApi({ action: "templatedata", titles: part.map((n) => "Plantilla:" + n).join("|") });
        const pages = d.pages || {};
        const arr = Array.isArray(pages) ? pages : Object.values(pages);
        for (const p of arr) {
          const name = String(p.title || "").replace(/^Plantilla:/, "");
          const params = p.params || {};
          const list = Object.entries(params).map(([k, v]) =>
            v && v.aliases && v.aliases.length ? k + " [" + v.aliases.join(", ") + "]" : k
          );
          out[name] = list;
        }
      } catch (_) { /* plantilla sin TemplateData */ }
    }
    return out;
  }

  // Sugerencia de plantilla ES por búsqueda (para las que no tienen langlink).
  async function suggestEsTemplates(enNames) {
    const out = {};
    for (const n of (enNames || []).slice(0, 15)) {
      try {
        const q = n.replace(/^(Infobox\s+|Info\/)/i, "").replace(/\s+/g, " ").trim();
        const d = await esApi({ action: "query", list: "search", srsearch: q, srnamespace: "10", srlimit: "3" });
        const hits = (d.query && d.query.search) || [];
        out[n] = hits.map((h) => h.title.replace(/^Plantilla:/, ""));
      } catch (_) { /* ignore */ }
    }
    return out;
  }

  function chat(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "chat", payload }, (r) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!r) return reject(new Error("Sin respuesta del background"));
        if (!r.ok) return reject(new Error(r.error));
        resolve(r.content || "");
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Wikipedia: langlinks
  // ---------------------------------------------------------------------------
  async function getEsLanglink(title) {
    const d = await sourceApi({
      action: "query",
      prop: "langlinks|revisions",
      rvprop: "ids",
      lllang: "es",
      titles: title,
      redirects: "1",
    });
    const p = d.query && d.query.pages && d.query.pages[0];
    const es = p && p.langlinks && p.langlinks[0] && p.langlinks[0].title;
    const rev = p && p.revisions && p.revisions[0];
    return {
      exists: !!es,
      esTitle: es || null,
      revid: (rev && rev.revid) || null,
      resolvedTitle: (p && p.title) || title,
    };
  }

  async function getWikitext(title) {
    const d = await sourceApi({
      action: "query",
      prop: "revisions",
      rvprop: "content|ids",
      rvslots: "main",
      titles: title,
      redirects: "1",
    });
    const p = d.query && d.query.pages && d.query.pages[0];
    if (!p || p.missing) throw new Error("Artículo no encontrado");
    const rev = p.revisions && p.revisions[0];
    return {
      content: (rev && rev.slots && rev.slots.main && rev.slots.main.content) || "",
      revid: (rev && rev.revid) || null,
    };
  }

  // Atribución exigida al traducir ([[Plantilla:Traducido ref]]).
  function buildAttribution(sourceTitle, revid) {
    return "{{Traducido ref|" + SOURCE_LANG + "|" + sourceTitle + (revid ? "|oldid=" + revid : "") + "|total}}";
  }

  function buildEditSummary(sourceTitle, revid) {
    return "Traducido de [[:" + SOURCE_LANG + ":" + sourceTitle + "]]" + (revid ? " (versión " + revid + ")" : "");
  }

  // Inserta la atribución en «Enlaces externos» (o crea la sección).
  function insertAttribution(wikitext, tpl) {
    const m = wikitext.match(/^(==+\s*Enlaces externos\s*==+)\s*$/im);
    if (m) {
      const idx = m.index + m[0].length;
      return wikitext.slice(0, idx) + "\n" + tpl + wikitext.slice(idx);
    }
    return wikitext.replace(/\s*$/, "") + "\n\n== Enlaces externos ==\n" + tpl + "\n";
  }

  // Devuelve { nombreOriginal: "Título en es" | null } consultando langlinks.
  async function langlinkMap(names, ns) {
    const uniq = [...new Set((names || []).map((n) => (n || "").trim()).filter(Boolean))];
    const map = {};
    for (let i = 0; i < uniq.length; i += 40) {
      const part = uniq.slice(i, i + 40);
      let d;
      try {
        d = await sourceApi({
          action: "query",
          prop: "langlinks",
          lllang: "es",
          titles: part.map((n) => ns + ":" + n).join("|"),
          redirects: "1",
          lllimit: "max",
        });
      } catch (_) {
        part.forEach((n) => (map[n] = null));
        continue;
      }
      const found = new Map();
      for (const p of (d.query && d.query.pages) || []) {
        const stripped = p.title.slice(p.title.indexOf(":") + 1);
        found.set(stripped.toLowerCase(), (p.langlinks && p.langlinks[0] && p.langlinks[0].title) || null);
      }
      for (const n of part) {
        map[n] = found.has(n.toLowerCase()) ? found.get(n.toLowerCase()) : null;
      }
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Enmascarado
  // ---------------------------------------------------------------------------
  function maskWikitext(src) {
    const blocks = [];
    const put = (text, kind, meta) => {
      const i = blocks.length;
      blocks.push({ kind, text, meta: meta || null });
      return tokenOf(i);
    };
    let text = src;

    // Plantillas tipográficas de apóstrofo del inglés -> entidad HTML (evita el
    // problema de las tres comillas y no existe equivalente en es.wikipedia).
    text = text.replace(/\{\{\s*[`']s\s*\}\}/g, () => put("&#39;s", "raw"));
    text = text.replace(/\{\{\s*[`']\s*\}\}/g, () => put("&#39;", "raw"));
    text = text.replace(/\{\{\s*Unspaced apostrophe\s*\}\}/gi, () => put("&#39;", "raw"));
    text = text.replace(/\{\{\s*Apostrophe\+s\s*\}\}/gi, () => put("&#39;s", "raw"));
    text = text.replace(/\{\{\s*Apostrophe\s*\}\}/gi, () => put("&#39;", "raw"));

    // Premios: {{Won}}/{{Nom}}/{{Nominated}} -> {{Celda|Ganador}}/{{Celda|Nominado}}
    text = text.replace(/\{\{\s*([A-Za-z]+)\s*(?:\|[^{}]*)?\}\}/g, (m, name) => {
      const cell = AWARD_CELLS[name.toLowerCase()];
      return cell ? put(cell, "raw") : m;
    });

    text = text.replace(/<!--[\s\S]*?-->/g, (m) => put(m, "comment"));
    text = text.replace(
      /<(nowiki|math|code|pre|syntaxhighlight|source|score|gallery)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      (m) => put(m, "raw")
    );
    // Categorías: [[Category:X|orden]] (en), [[Categoria:X|orden]] (pt) y [[Categoría:X|orden]] (es)
    text = text.replace(
      /\[\[\s*(Category|Categoria|Categoría)\s*:\s*([^\]|]+?)\s*(\|[^\]]*)?\]\]/gi,
      (m, _ns, name, sort) => put(m, "category", { en: name.trim(), sort: sort || "" })
    );
    text = maskBraces(text, put);
    return { text, blocks };
  }

  // Cuenta llaves para capturar {{plantillas}}, {{{parámetros}}} y {|tablas|}
  function maskBraces(s, put) {
    let out = "";
    let depth = 0;
    let start = -1;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (c === "}") {
        if (depth > 0) {
          depth--;
          if (depth === 0) out += put(s.slice(start, i + 1), "block");
        } else {
          out += c;
        }
      } else if (depth === 0) {
        out += c;
      }
    }
    if (depth > 0) out += s.slice(start);
    return out;
  }

  function unmask(text, blocks, replacements) {
    return text.replace(TOKEN_RE, (m, idx) => {
      const i = Number(idx);
      if (replacements[i] != null) return replacements[i];
      return blocks[i] ? blocks[i].text : m;
    });
  }

  function chunkText(text, maxLen) {
    const paras = text.split(/\n{2,}/);
    const chunks = [];
    let cur = "";
    for (const p of paras) {
      if (cur && cur.length + p.length + 2 > maxLen) {
        chunks.push(cur);
        cur = p;
      } else {
        cur = cur ? cur + "\n\n" + p : p;
      }
    }
    if (cur) chunks.push(cur);
    return chunks;
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isTable(wt) {
    return /^\s*\{\|/.test(wt);
  }

  function templateName(wt) {
    const m = wt.match(/^\s*\{\{\s*([^|}\n]+)/);
    if (!m) return null;
    let name = m[1].replace(/[`'"«»]/g, "").trim();
    if (!name || /^[{!#*:;]/.test(name)) return null;
    return name.slice(0, 60);
  }

  // ---------------------------------------------------------------------------
  // Traducción
  // ---------------------------------------------------------------------------
  async function translateTitle(title, onStatus) {
    onStatus && onStatus("Traduciendo el título…");
    const content = await chat({
      messages: [
        {
          role: "system",
          content:
            "Traduce títulos de artículos de Wikipedia al español. Responde SOLO con el título traducido, sin comillas, sin punto final y sin texto adicional.",
        },
        { role: "user", content: title },
      ],
      max_tokens: 80,
    });
    return content.trim().replace(/^["'«]|["'»]$/g, "");
  }

  async function translateProse(maskedText, onStatus) {
    const chunks = chunkText(maskedText, 4000);
    const out = [];
    for (let i = 0; i < chunks.length; i++) {
      onStatus && onStatus(`Traduciendo texto… (${i + 1}/${chunks.length})`);
      const content = await chat({
        messages: [
          { role: "system", content: PROSE_SYSTEM },
          { role: "user", content: chunks[i] },
        ],
        max_tokens: 4096,
      });
      out.push(content.trim());
    }
    return out.join("\n\n");
  }

  async function translateBlocks(blocks, templateNameMap, onStatus) {
    const targets = [];
    blocks.forEach((b, i) => {
      if (b.kind === "block" && !isTable(b.text)) targets.push({ id: i, en: b.text });
    });
    if (!targets.length) return {};

    const map = Object.assign({}, TEMPLATE_MAP);
    for (const [en, es] of Object.entries(templateNameMap || {})) {
      if (es) map[en] = es.replace(/^Plantilla:/, "");
    }

    // Parámetros reales (TemplateData) de las plantillas ES que se van a usar.
    const usedEs = [];
    for (const t of targets) {
      const n = templateName(t.en);
      if (n && map[n]) usedEs.push(map[n]);
    }
    onStatus && onStatus("Buscando parámetros reales en es.wikipedia…");
    const paramInfo = await getTemplateParams(usedEs).catch(() => ({}));
    const paramLines = Object.entries(paramInfo)
      .filter(([, list]) => list && list.length)
      .map(([name, list]) => name + ": " + list.join(", "));
    const paramSection = paramLines.length
      ? "\n\nPARÁMETROS REALES de las plantillas en es.wikipedia (usa EXACTAMENTE estos nombres de parámetro, en español):\n" +
        paramLines.join("\n")
      : "";

    onStatus && onStatus("Traduciendo plantillas e infobox…");
    const system =
      TEMPLATE_SYSTEM.replace("__REMOVE__", TEMPLATE_REMOVE.join(", ")) +
      "\n\n" +
      CITE_GUIDE +
      paramSection +
      "\n\nMAPA (" + SOURCE_LANG_NAME + " → español):\n" +
      JSON.stringify(map);

    const content = await chat({
      json: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ blocks: targets }) },
      ],
      max_tokens: 8192,
    });

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (_) {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const result = {};
    for (const t of targets) {
      const v = parsed[t.id];
      if (typeof v === "string") result[t.id] = v;
    }
    return result;
  }

  function buildReplacements(blocks, blockOut, catMap) {
    return blocks.map((b, i) => {
      if (b.kind === "block") {
        const out = blockOut[i] != null ? blockOut[i] : b.text;
        return normalizeCiteParams(out);
      }
      if (b.kind === "category") {
        const en = b.meta.en;
        const sort = b.meta.sort || "";
        const raw = catMap && catMap[en];
        const es = raw ? raw.replace(/^Categoría:/, "") : null;
        if (es) return "[[Categoría:" + es + sort + "]]";
        return "<!-- categoría sin equivalente en es.wikipedia: " + b.text + " -->";
      }
      return b.text;
    });
  }

  function postProcess(text, ctx) {
    let out = text;

    // Forzar nombres de plantilla descubiertos vía langlinks.
    for (const [en, es] of Object.entries(ctx.templateNameMap || {})) {
      if (!es) continue;
      const name = es.replace(/^Plantilla:/, "");
      const re = new RegExp("\\{\\{\\s*" + escapeRegExp(en) + "\\s*(\\||\\}\\})", "gi");
      out = out.replace(re, (_m, p1) => "{{" + name + p1);
    }

    // Eliminar plantillas de mantenimiento si sobrevivieron.
    for (const name of TEMPLATE_REMOVE) {
      const e = escapeRegExp(name);
      out = out.replace(new RegExp("\\{\\{\\s*" + e + "\\s*\\}\\}", "gi"), "");
      out = out.replace(new RegExp("\\{\\{\\s*" + e + "\\s*\\|[\\s\\S]*?\\}\\}", "gi"), "");
    }

    out = out.replace(new RegExp("\\[\\[" + SOURCE_LANG + ":[^\\]]*\\]\\]\\s*", "gi"), "");
    out = out.replace(/\n{3,}/g, "\n\n");
    return out;
  }

  function collectWarnings(result, blocks, ctx) {
    const warnings = [];

    const noCat = [];
    blocks.forEach((b) => {
      if (b.kind === "category" && (!ctx.catMap || !ctx.catMap[b.meta.en])) noCat.push(b.meta.en);
    });
    if (noCat.length) {
      warnings.push("Categorías sin equivalente en es.wikipedia (se han comentado): " + [...new Set(noCat)].join(" · "));
    }

    const noTpl = Object.entries(ctx.templateNameMap || {})
      .filter(([, es]) => !es)
      .map(([en]) => en);
    if (noTpl.length) {
      warnings.push("Plantillas sin equivalente en es.wikipedia (revisa): " + [...new Set(noTpl)].join(", "));
    }

    const auto = Object.entries(ctx.autoApplied || {});
    if (auto.length) {
      warnings.push(
        "Mapeadas automáticamente por búsqueda (verifica): " +
          auto.map(([en, es]) => en + " → " + es).join("; ")
      );
    }

    const cite = [...result.matchAll(/\{\{\s*((?:cite|citar) [a-zà-ú]+)\s*[\|}]/gi)].map((m) => m[1].toLowerCase());
    if (cite.length) {
      warnings.push("Quedan " + cite.length + " plantillas de cita sin convertir (" + [...new Set(cite)].join(", ") + "): revisa su conversión.");
    }

    const noEq = [...result.matchAll(/sin-equivalente:\s*([^\n]*?)\s*-->/g)].map((m) => m[1].trim());
    if (noEq.length) {
      warnings.push("La IA marcó como sin equivalente: " + noEq.join(", "));
    }

    return warnings;
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, system-ui, "Segoe UI", sans-serif; }
    .fab { position: fixed; right: 18px; bottom: 18px; z-index: 2147483646;
      background: #36c; color: #fff; border: 0; border-radius: 24px; padding: 12px 18px;
      font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.3); }
    .fab:hover { background: #2a4b8d; }
    .panel { position: fixed; top: 0; right: 0; width: 440px; max-width: 96vw; height: 100vh;
      z-index: 2147483647; background: #fff; color: #202122; border-left: 1px solid #c8ccd1;
      box-shadow: -6px 0 24px rgba(0,0,0,.18); display: none; flex-direction: column; }
    .panel.open { display: flex; }
    .head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #eaecf0; }
    .head h1 { font-size: 15px; margin: 0; flex: 1; }
    .head button { border: 0; background: #eaecf0; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
    .body { flex: 1; overflow: auto; padding: 12px 14px; }
    .row { margin-bottom: 10px; }
    label { display: block; font-size: 12px; font-weight: 600; color: #54595d; margin-bottom: 4px; }
    input[type=text] { width: 100%; padding: 8px; border: 1px solid #a2a9b1; border-radius: 6px; font-size: 14px; }
    textarea { width: 100%; height: 44vh; padding: 10px; border: 1px solid #a2a9b1; border-radius: 6px;
      font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; resize: vertical; }
    textarea.small { height: auto; min-height: 48px; }
    .chk { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 400; color: #202122; margin-top: 6px; }
    .chk input { width: auto; }
    .sub { font-size: 11px; color: #72777d; margin-top: 4px; word-break: break-word; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
    .actions button { border: 0; border-radius: 6px; padding: 9px 14px; font-size: 13px; cursor: pointer; background: #eaecf0; }
    .actions button.primary { background: #36c; color: #fff; font-weight: 600; }
    .actions button.primary:hover { background: #2a4b8d; }
    .status { font-size: 13px; color: #54595d; min-height: 18px; }
    .status.err { color: #b32424; }
    .status.ok { color: #14866d; }
    .badge { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 10px; }
    .badge.no { background: #fee7e6; color: #b32424; }
    .badge.yes { background: #d5fdf4; color: #14866d; }
    .warn { background: #fef6e7; border: 1px solid #fc3; border-radius: 6px; padding: 8px 10px;
      font-size: 12px; margin-top: 10px; white-space: pre-wrap; }
    .hint { font-size: 11px; color: #72777d; margin-top: 6px; }
    a { color: #36c; }
  `;

  function buildUI(title) {
    const host = document.createElement("div");
    host.style.cssText = "all: initial;";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);

    const fab = document.createElement("button");
    fab.className = "fab";
    fab.textContent = "→ ES (WikiES)";
    root.appendChild(fab);

    const panel = document.createElement("aside");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="head">
        <h1>WikiES · traducir a Wikipedia ES</h1>
        <button id="settings" title="Opciones">⚙︎</button>
        <button id="close" title="Cerrar">✕</button>
      </div>
      <div class="body">
        <div class="row"><span id="lang" class="badge">Comprobando…</span></div>
        <div class="row">
          <label>Título en español</label>
          <input id="title" type="text" value="" />
        </div>
        <div class="row">
          <label>Atribución de traducción (Plantilla:Traducido ref)</label>
          <textarea id="attr" class="small" readonly placeholder="Se genera al traducir…"></textarea>
          <label class="chk"><input type="checkbox" id="useAttr" checked> Insertar en «Enlaces externos» del artículo</label>
          <div id="attrHint" class="sub"></div>
        </div>
        <div class="actions">
          <button id="translate" class="primary">Traducir</button>
          <button id="copy">Copiar wikitexto</button>
          <button id="copyAttr">Copiar atribución</button>
          <button id="open">Copiar y abrir editor ES</button>
        </div>
        <div id="status" class="status"></div>
        <textarea id="out" spellcheck="false" placeholder="Aquí aparecerá el wikitexto traducido…"></textarea>
        <div id="warn"></div>
        <div class="hint">Revisa siempre el resultado antes de publicar. La traducción automática no sustituye una revisión humana.</div>
      </div>`;
    root.appendChild(panel);

    const $ = (id) => panel.querySelector("#" + id);
    const statusEl = $("status");
    const warnEl = $("warn");
    const titleEl = $("title");
    const outEl = $("out");
    const langEl = $("lang");
    const attrEl = $("attr");
    const attrHintEl = $("attrHint");
    const useAttrEl = $("useAttr");

    const setStatus = (t, cls) => { statusEl.textContent = t || ""; statusEl.className = "status " + (cls || ""); };
    const setWarn = (html) => { warnEl.innerHTML = html || ""; };
    const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    fab.addEventListener("click", async () => {
      panel.classList.add("open");
      fab.style.display = "none";
      setStatus("Comprobando si ya existe en español…");
      try {
        const ll = await getEsLanglink(title);
        if (ll.exists) {
          const url = "https://es.wikipedia.org/wiki/" + encodeURIComponent(ll.esTitle.replace(/ /g, "_"));
          langEl.className = "badge yes";
          langEl.innerHTML = 'Ya existe en ES: <a href="' + url + '" target="_blank">' + escapeHtml(ll.esTitle) + "</a>";
        } else {
          langEl.className = "badge no";
          langEl.textContent = "No existe en español · se puede crear";
          titleEl.value = title;
        }
        attrEl.value = buildAttribution(title, ll.revid);
        attrHintEl.textContent = "Resumen de edición sugerido: " + buildEditSummary(title, ll.revid);
        setStatus("Listo. Pulsa «Traducir».");
      } catch (e) {
        langEl.className = "badge no";
        langEl.textContent = "Sin comprobar";
        setStatus("Error al comprobar: " + e.message, "err");
      }
    });

    $("close").addEventListener("click", () => {
      panel.classList.remove("open");
      fab.style.display = "";
    });

    $("settings").addEventListener("click", () => chrome.runtime.sendMessage({ type: "openOptions" }));

    $("copy").addEventListener("click", async () => {
      if (!outEl.value) return setStatus("Nada que copiar todavía", "err");
      try {
        await navigator.clipboard.writeText(outEl.value);
        setStatus("Wikitexto copiado ✓", "ok");
      } catch (_) {
        outEl.select();
        document.execCommand("copy");
        setStatus("Wikitexto copiado (modo alternativo) ✓", "ok");
      }
    });

    $("copyAttr").addEventListener("click", async () => {
      if (!attrEl.value) return setStatus("La atribución se genera al comprobar el artículo", "err");
      try {
        await navigator.clipboard.writeText(attrEl.value);
        setStatus("Atribución copiada ✓", "ok");
      } catch (_) {
        attrEl.select();
        document.execCommand("copy");
        setStatus("Atribución copiada (modo alternativo) ✓", "ok");
      }
    });

    $("open").addEventListener("click", async () => {
      if (!outEl.value) return setStatus("Nada que copiar todavía", "err");
      try { await navigator.clipboard.writeText(outEl.value); } catch (_) { outEl.select(); document.execCommand("copy"); }
      const t = (titleEl.value || title).replace(/ /g, "_");
      window.open("https://es.wikipedia.org/w/index.php?title=" + encodeURIComponent(t) + "&action=edit", "_blank");
      setStatus("Copiado y editor abierto. Pega el wikitexto (⌘/Ctrl+V).", "ok");
    });

    $("translate").addEventListener("click", async () => {
      const btn = $("translate");
      btn.disabled = true;
      setWarn("");
      try {
        setStatus("Comprobando idioma…");
        const ll = await getEsLanglink(title);
        if (ll.exists && !confirm("Ya existe un artículo en español: «" + ll.esTitle + "».\n¿Quieres generar una traducción igualmente?")) {
          setStatus("Cancelado");
          return;
        }

        setStatus("Descargando wikitexto original…");
        const page = await getWikitext(title);
        const wikitext = page.content;
        if (!wikitext) throw new Error("Sin contenido que traducir");

        const revid = page.revid || ll.revid;
        const attribution = buildAttribution(title, revid);
        attrEl.value = attribution;
        attrHintEl.textContent = "Resumen de edición sugerido: " + buildEditSummary(title, revid);

        const { text: masked, blocks } = maskWikitext(wikitext);

        const catNames = blocks.filter((b) => b.kind === "category").map((b) => b.meta.en);
        const tplNames = blocks
          .filter((b) => b.kind === "block" && !isTable(b.text))
          .map((b) => templateName(b.text))
          .filter(Boolean);

        setStatus("Buscando equivalentes reales en es.wikipedia…");
        const [catMap, templateNameMap] = await Promise.all([
          langlinkMap(catNames, SRC_CAT_NS).catch(() => ({})),
          langlinkMap(tplNames, SRC_TPL_NS).catch(() => ({})),
        ]);

        // Auto-aplicar la mejor sugerencia de búsqueda para las sin interwiki.
        const autoApplied = {};
        const unresolvedTpl = Object.entries(templateNameMap)
          .filter(([, es]) => !es)
          .map(([en]) => en);
        if (unresolvedTpl.length) {
          setStatus("Buscando plantillas equivalentes por búsqueda…");
          const suggestions = await suggestEsTemplates(unresolvedTpl).catch(() => ({}));
          for (const [en, hits] of Object.entries(suggestions)) {
            const best = (hits || []).find((h) => !/\//.test(h) && !/\.(css|js)$/i.test(h));
            if (best) {
              templateNameMap[en] = "Plantilla:" + best;
              autoApplied[en] = best;
            }
          }
        }
        console.debug("[WikiES] categorías →", catMap, "plantillas →", templateNameMap, "auto →", autoApplied);

        const prose = await translateProse(masked, setStatus);
        const blockOut = await translateBlocks(blocks, templateNameMap, setStatus);

        const replacements = buildReplacements(blocks, blockOut, catMap);
        let result = unmask(prose, blocks, replacements);
        result = postProcess(result, { templateNameMap });
        if (useAttrEl.checked) result = insertAttribution(result, attribution);

        const warnings = collectWarnings(result, blocks, { catMap, templateNameMap, autoApplied });

        outEl.value = result;

        if (!titleEl.value || titleEl.value === title) {
          const esTitle = await translateTitle(title, setStatus).catch(() => title);
          titleEl.value = esTitle;
        }

        if (warnings.length) {
          setWarn('<div class="warn">' + warnings.map(escapeHtml).join("\n\n") + "</div>");
        }
        setStatus("Traducción lista. Revisa y copia ✓", "ok");
      } catch (e) {
        setStatus("Error: " + e.message, "err");
      } finally {
        btn.disabled = false;
      }
    });

    document.documentElement.appendChild(host);
  }

  // ---------------------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------------------
  const EXCLUDED_NS =
    /^(Special|Wikipedia|Portal|Template|Category|File|Help|User|Talk|Draft|Module|MediaWiki|Especial|Wikipédia|Predefinição|Categoria|Ficheiro|Ajuda|Usuário|Usuário(a)|Discussão|Rascunho|Módulo):/i;
  const MAIN_PAGES = /^(Main_Page|Página_principal)$/i;

  function currentArticleTitle() {
    if (!/^(en|pt)\.wikipedia\.org$/i.test(location.hostname)) return null;
    const m = location.pathname.match(/^\/wiki\/(.+)$/);
    if (!m) return null;
    const t = decodeURIComponent(m[1]);
    if (EXCLUDED_NS.test(t)) return null;
    if (MAIN_PAGES.test(t)) return null;
    return t.replace(/_/g, " ");
  }

  const title = currentArticleTitle();
  if (title) buildUI(title);
})();
