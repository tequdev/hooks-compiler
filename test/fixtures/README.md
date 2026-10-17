# Fixtures

Vendored inputs for `pnpm test:determinism` (see `scripts/determinism.mjs`). Pins live in `sources.json`; `hashes.json` holds the expected SHA-256 of each built hook.

## Sources

- `hooks/<name>/`: the starter, firewall, notary, carbon and peggy templates of [Xahau/xrpl-hooks-ide](https://github.com/Xahau/xrpl-hooks-ide) (`state/constants/templates.ts` lists the gist ids). Each is a GitHub gist pinned to the revision in `sources.json`, e.g. `https://gist.github.com/<owner>/<gist>/<revision>`. Only the `.c` files are kept. The gist for firewall holds two hooks, so `blacklist` is a separate fixture from the same gist.
- `include/`: every `.h` from [Xahau/xahaud `hook/genesis/headers`](https://github.com/Xahau/xahaud/tree/dev/hook/genesis/headers) at the commit pinned in `sources.json`. All hooks share this directory.

## Licences

- xahaud is ISC licensed (`LICENSE.md` in that repository).
- xrpl-hooks-ide declares no licence, and the gists carry none. The templates are small example hooks vendored unmodified for testing; remove them if the owners object.

## Not included

None. All six templates compile with the default flags.

## Refresh

```
node scripts/fixtures.mjs fetch
node scripts/determinism.mjs --update
```

Edit `sources.json` first to move a pin, then commit the changed files together with the new hashes.
