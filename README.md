# ordinal-cubes-index

Static, self-updating index of every cube minted via [cubes.haushoppe.art](https://cubes.haushoppe.art) on Bitcoin Ordinals.

A GitHub Action walks our own ord instance (`ord.ordpool.space`) forward via the inscription `next` linked list, identifies cubes by their HTML marker, parses traits, and commits the result to [`data/cubes.json`](./data/cubes.json) — served via GitHub Pages at:

**https://ordpool-space.github.io/ordinal-cubes-index/data/cubes.json**

## Why this exists

The previous discovery path was OrdinalsBot's `/search` endpoint. It broke in mid-2026 (their indexer's internal DNS stopped resolving) and the service looks abandoned. Rather than swap one vendor for another, the index now runs on a public Action against infrastructure we own. No API keys, no external SaaS, no surprises.

## Data shape

`data/cubes.json` is an array sorted by inscription number ascending. Cube 0 is the genesis cube (a cursed inscription at number −265038).

```json
{
  "inscriptionId": "72cb9bcb673652e9bf41d562920371e27dcfa39904cb7e96c45faad70b07f0e2i0",
  "inscriptionNumber": -265038,
  "blockHeight": 814583,
  "timestamp": 1698704842,
  "contentLength": 613,
  "attributes": [
    { "trait_type": "Side 1", "value": "<inscription id>" },
    { "trait_type": "Side 2", "value": "<inscription id>" },
    { "trait_type": "Side 3", "value": "<inscription id>" },
    { "trait_type": "Side 4", "value": "<inscription id>" },
    { "trait_type": "Side 5", "value": "<inscription id>" },
    { "trait_type": "Side 6", "value": "<inscription id>" },
    { "trait_type": "Version", "value": "v1" },
    { "trait_type": "Title", "value": "itsdonny x Johannes, rat sat" }
  ],
  "name": "Ordinal Cube #0 (itsdonny x Johannes, rat sat)"
}
```

`data/cursor.json` tracks the scanner's position:

```json
{
  "lastScannedId": "…",
  "lastScannedNumber": 96141606,
  "blessedTipAtLastRun": 126690338,
  "lastScanAt": "2026-06-18T…",
  "source": "bootstrap"
}
```

`data/validation.json` records the result of the one-time bootstrap run (530 cubes pulled from the Magic Eden archive, re-validated against our own ord).

## How it works

**Phase A — Bootstrap** (`scripts/bootstrap.mjs`, run once)

Reads the cube IDs Magic Eden had on file for the `ordinal-cubes-by-haus-hoppe` collection (from our public [magic-eden-ordinals-archive](https://github.com/ordpool-space/magic-eden-ordinals-archive)), fetches each one's metadata + content from `ord.ordpool.space`, runs the cube parser, sorts by inscription number, writes `cubes.json` + `cursor.json` + `validation.json`. ~10 seconds.

**Phase B — Backfill** (`scripts/grind.mjs` with a large `MAX_ITERATIONS`)

Walks forward from the bootstrap cursor (latest known cube) to the chain tip, looking for cubes the Magic Eden snapshot missed. Run manually on a dev box once.

**Phase C — Steady state** (`.github/workflows/grind.yml`)

Hourly cron runs `scripts/grind.mjs` with the default 5000-iteration budget. Picks up wherever the cursor left off. If anything changed, commits and pushes. Idempotent — re-running with no new inscriptions is a no-op.

## Running locally

```bash
node --version  # >=22

npm run bootstrap            # one-time: pull from ME archive, validate, write cubes.json
npm run grind                # walk forward 5000 inscriptions
MAX_ITERATIONS=50000 npm run grind   # bigger budget for backfill
STOP_AT_TIP=1 npm run grind          # stop the moment we reach the tip
```

`ORD_BASE` env var overrides the default ord endpoint (`https://ord.ordpool.space`) — useful for running against a local ord during dev.

## Consuming the index

Anything that wants to know what cubes exist:

```ts
const cubes = await fetch(
  'https://ordpool-space.github.io/ordinal-cubes-index/data/cubes.json'
).then(r => r.json());
```

GitHub Pages serves with `Access-Control-Allow-Origin: *` and gzip transparently — no CORS or decompression dance needed in the browser.

## Cross-references

- The cube renderer inscriptions (referenced by every cube) are pinned in `scripts/parse-cube.mjs`. There are three versions; they're permanent on-chain inscriptions and don't change.
- One cube (`615c70a…2f33i0` "Bitcoin Wizards") has a Cloudflare beacon `<script defer>` inscribed inside its on-chain bytes — the upload service that minted it ran behind Cloudflare with beacon injection enabled. The parser strips it before the regex match. Confirmed identical on both `ord.ordpool.space` and `ordinals.com`.

## License

MIT — see [LICENSE](./LICENSE) once it exists. Underlying inscription data is on-chain Bitcoin; no rights are claimed over it.
