// Maintainers only (never run in CI): re-download fixtures/ from the pinned sources in fixtures/sources.json.
// Usage: node scripts/fixtures.mjs fetch
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (process.argv[2] !== "fetch") throw new Error("usage: node scripts/fixtures.mjs fetch");
const { xahaud, templates } = JSON.parse(readFileSync("fixtures/sources.json", "utf8"));
const get = async (url, json) => {
  const res = await fetch(url, { headers: { "user-agent": "hooks-compiler-fixtures" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return json ? res.json() : res.text();
};
const write = (path, text) => {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, text);
  console.log(path);
};

for (const { name, gist, revision, files } of templates) {
  const meta = await get(`https://api.github.com/gists/${gist}/${revision}`, true);
  for (const f of files) write(`fixtures/hooks/${name}/${f}`, await get(meta.files[f].raw_url));
}
const dir = `hook/genesis/headers`;
const list = await get(`https://api.github.com/repos/Xahau/xahaud/contents/${dir}?ref=${xahaud.commit}`, true);
for (const { name } of list.filter((e) => e.name.endsWith(".h"))) {
  write(`fixtures/include/${name}`, await get(`https://raw.githubusercontent.com/Xahau/xahaud/${xahaud.commit}/${dir}/${name}`));
}
