# ordinal-cubes-index

Static, self-updating index of every cube minted via [cubes.haushoppe.art](https://cubes.haushoppe.art) on Bitcoin Ordinals.

A GitHub Action walks our own ord instance (`ord.ordpool.space`) forward via the inscription `next` linked list, identifies cubes by their HTML marker, parses traits, and commits the result to [`data/cubes.json`](./data/cubes.json) — served via GitHub Pages at:

**https://ordpool-space.github.io/ordinal-cubes-index/data/cubes.json**

## Data shape

`data/cubes.json` is an array sorted by block height + inscription number ascending. Cube 0 is the genesis cube.
Three different versions have been released so far, each with minor bug fixes and improvements. A v4 might be released, but that's not certain.

```json
{
  "inscriptionId": "f1997166547da9784a3e7419d2b248551565211811d4f5e705b685efa244451fi0",
  "inscriptionNumber": 13271890,
  "blockHeight": 795579,
  "timestamp": 1687527225,
  "contentLength": 557,
  "attributes": [
    { "trait_type": "Side 1", "value": "<inscription id>" },
    { "trait_type": "Side 2", "value": "<inscription id>" },
    { "trait_type": "Side 3", "value": "<inscription id>" },
    { "trait_type": "Side 4", "value": "<inscription id>" },
    { "trait_type": "Side 5", "value": "<inscription id>" },
    { "trait_type": "Side 6", "value": "<inscription id>" },
    { "trait_type": "Version", "value": "v1" },
    { "trait_type": "Title", "Optional Title, introduced in later versions" }
  ],
  "name": "Ordinal Cube #0"
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

**Phase B — Backfill** (`scripts/backfill.mjs`, optional, run manually on a dev box)

Bulk parallel forward scan by inscription number, used to close the multi-million-inscription gap between the bootstrap cursor and the current tip. Safe to use only past the Jubilee fork — pre-Jubilee ranges need linked-list walking via grind.mjs to catch cursed inscriptions.

```bash
CONCURRENCY=40 node scripts/backfill.mjs   # be polite — start modest
```

Each `BATCH_COMMIT` (default 10000) inscriptions, progress is committed to `cubes.json` + `cursor.json` so the run is resumable.

**Phase C — Steady state** (`.github/workflows/grind.yml`)

Continuous cron runs `scripts/grind.mjs` with the default 5000-iteration budget. Picks up wherever the cursor left off. If anything changed, commits and pushes. Idempotent — re-running with no new inscriptions is a no-op.

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

## License

CC0 1.0 Universal — see [LICENSE](./LICENSE). Underlying inscription data is on-chain Bitcoin; no rights are claimed over it.
