"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const wiki = require("../src/content.js");

test("enmascara plantillas simples", () => {
  const { text, blocks } = wiki.maskWikitext("Hola {{foo|a=1}} mundo");
  assert.equal(text, "Hola ⟪T0⟫ mundo");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "block");
  assert.equal(blocks[0].text, "{{foo|a=1}}");
});

test("enmascara plantillas anidadas como un solo bloque", () => {
  const src = "{{outer|{{inner|x}}}}";
  const { text, blocks } = wiki.maskWikitext(src);
  assert.equal(text, "⟪T0⟫");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, src);
});

test("no confunde un valor de parámetro «|{{...}}» con una tabla", () => {
  const src = "{{cite|title=A|{{nested}}}}";
  const { text, blocks } = wiki.maskWikitext(src);
  assert.equal(text, "⟪T0⟫");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, src);
});

test("enmascara tablas completas aunque contengan plantillas", () => {
  const src = '{| class="wikitable"\n! a\n|-\n| {{foo|x}} || b\n|}';
  const { text, blocks } = wiki.maskWikitext(src);
  assert.equal(text, "⟪T0⟫");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "block");
  assert.equal(blocks[0].text, src);
});

test("enmascara parámetros de plantilla con llaves triples", () => {
  const src = "{{{param|default}}}";
  const { text, blocks } = wiki.maskWikitext(src);
  assert.equal(text, "⟪T0⟫");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, src);
});

test("separa bloques por texto intermedio", () => {
  const { text, blocks } = wiki.maskWikitext("{{a}}bar{{b}}");
  assert.equal(text, "⟪T0⟫bar⟪T1⟫");
  assert.equal(blocks.length, 2);
});

test("isCiteTemplate distingue citas de fichas", () => {
  assert.equal(wiki.isCiteTemplate("{{cita web|url=x}}"), true);
  assert.equal(wiki.isCiteTemplate("{{Cita noticia|título=x}}"), true);
  assert.equal(wiki.isCiteTemplate("{{cite book|title=x}}"), true);
  assert.equal(wiki.isCiteTemplate("{{Ficha de persona|nombre=x}}"), false);
  assert.equal(wiki.isCiteTemplate("{| table |}"), false);
});

test("normalizeCiteParams traduce parámetros y valores", () => {
  const out = wiki.normalizeCiteParams(
    "{{cita web|last=Smith|first=John|access-date=2020|url-status=dead}}"
  );
  assert.match(out, /apellido=Smith/);
  assert.match(out, /nombre=John/);
  assert.match(out, /fechaacceso=2020/);
  assert.match(out, /urlmuerta=sí/);
});

test("normalizeCiteParams mapea url-access a suscripción=sí", () => {
  const out = wiki.normalizeCiteParams("{{cita web|url-access=subscription}}");
  assert.match(out, /suscripción=sí/);
});

test("buildReplacements solo normaliza plantillas de cita", () => {
  const blocks = [
    { kind: "block", text: "{{cita web|last=A}}", meta: null },
    { kind: "block", text: "{{Ficha de persona|firstName=B}}", meta: null },
  ];
  const blockOut = {
    0: "{{cita web|last=A|access-date=2020}}",
    1: "{{Ficha de persona|title=B}}",
  };
  const out = wiki.buildReplacements(blocks, blockOut, {});
  assert.match(out[0], /apellido=A/);
  assert.match(out[0], /fechaacceso=2020/);
  assert.equal(out[1], "{{Ficha de persona|title=B}}");
});

test("chunkText respeta el tamaño máximo", () => {
  const chunks = wiki.chunkText("a".repeat(10) + "\n\n" + "b".repeat(10), 15);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], "a".repeat(10));
});

test("insertAttribution coloca la plantilla antes de Enlaces externos", () => {
  const wt = "Texto\n\n== Referencias ==\n{{Listaref}}\n\n== Enlaces externos ==\n* x";
  const out = wiki.insertAttribution(wt, "{{Traducido ref|en|Foo}}");
  assert.ok(out.indexOf("Traducido ref") !== -1);
  assert.ok(out.indexOf("Traducido ref") < out.indexOf("Enlaces externos"));
});

test("insertAttribution cae al final si no hay secciones", () => {
  const out = wiki.insertAttribution("Solo texto", "{{Traducido ref|en|Foo}}");
  assert.match(out, /Traducido ref/);
  assert.match(out, /== Enlaces externos ==/);
});

test("normalizeTplName elimina prefijos, acentos y artículos genéricos", () => {
  assert.equal(wiki.normalizeTplName("Infobox person"), "person");
  assert.equal(wiki.normalizeTplName("Plantilla:Ficha de persona"), "persona");
  assert.equal(wiki.normalizeTplName("Predefinição:Info/álbum"), "album");
});

test("buildAttribution usa trad=total, oldid y fecha en español", () => {
  const out = wiki.buildAttribution("Foo", 123);
  assert.ok(out.startsWith("{{Traducido ref|en|Foo|oldid=123|trad=total|fecha="));
  assert.match(out, /\|fecha=\d{1,2} de [a-z]+ de \d{4}\}\}$/);
  const noRev = wiki.buildAttribution("Foo", null);
  assert.ok(!noRev.includes("oldid="));
  assert.match(noRev, /\|trad=total\|/);
});

test("currentArticleTitle devuelve null fuera de un wiki soportado", () => {
  assert.equal(wiki.currentArticleTitle(), null);
});
