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

`data/sides.json` holds one entry per side inscription ever used on a cube, resolved once and kept forever (the inscription is immutable):

```json
"df58fbb44dbb2a9b17405f944c8ff966fd120cccda87873f3206f012ea239bebi0": {
  "contentType": "image/png",
  "exists": true,
  "renderable": true,
  "width": 600,
  "height": 600,
  "texture": true,
  "collection": "bitcoinonezero"
}
```

`renderable` is what the cube renderer sees: it loads every side as an `<img>` (three.js `TextureLoader`), so a face is black exactly when the browser cannot decode the side as an image. The probe asks headless Chrome that same question.

`texture` is the second half of that question: does the browser accept the decoded image as a WebGL texture source? An SVG **without an intrinsic size** (`width="100%"` and no height, or only a `viewBox`) decodes as an image but is refused, and the upload fails with `INVALID_VALUE` ("bad image data"). Cubes built from such sides rendered when they were minted and went black later, in every viewer that hands the image to WebGL unchanged, including ordinals.com's own `/preview/`. [cubes.haushoppe.art](https://cubes.haushoppe.art) rasterises them back into view, so there they still show. `null` means the fact was not established. `collection` is the Magic Eden symbol from the [archive's reverse index](https://github.com/ordpool-space/magic-eden-ordinals-archive#by-idprefixcsvgz-reverse-index), `null` when the archive does not know the inscription.

`data/rarity.json` is the score over all cubes (see [Rarity](#rarity)): the rules it was computed with, the collection table, and one row per cube in canonical order:

```json
{
  "inscriptionId": "…i0",
  "position": 12,
  "status": "scored",            // scored | cursed | after-close
  "cursed": [],                  // duplicate-side | black-side | reused-inscription
  "blackSides": [],              // 1-based faces that do not render
  "reusedSides": [],             // 1-based faces claimed by an earlier cube
  "chromeSides": [],             // 1-based faces the browser refuses to texture
  "collection": "omb",           // all six sides from this collection, else null
  "collections": ["omb"],        // every collection the cube shows
  "validOrdinal": 11,            // position among scored cubes, in mint order
  "tier": 1,
  "tierBonus": 100,
  "popularity": 17,              // scored cubes showing this collection
  "popularityPoints": 100,
  "score": 200,
  "rank": 1                      // leaderboard position, strict 1..n
}
```

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

**Phase D — Rarity** (`scripts/rarity.mjs`, runs after every grind)

Resolves the sides of any new cube into `data/sides.json` (content type from our own backend, image probe in the runner's Chrome, collection from the archive's reverse index), then recomputes `data/rarity.json` over all cubes. With nothing new, both files come out byte-identical, so the run commits nothing. `SKIP_SIDES=1 npm run rarity` scores from the cached sides only; `ARCHIVE_BASE=file:///path/to/magic-eden-ordinals-archive` reads the reverse index from a local checkout.

## Rarity

Cubes are scored against each other, and the score moves with every new cube. These rules are the specification; `scripts/score.mjs` implements them and `data/rarity.json` is the result.

**A cube is cursed, and gets no score, when any of these holds:**

- two of its faces show the same inscription (`duplicate-side`);
- a face is black because its side does not render as an image (`black-side`), which covers missing inscriptions, text, HTML, JSON, 3D models and undecodable bytes;
- a side was already claimed by an earlier cube (`reused-inscription`). Each cube claims its six inscriptions in mint order, block height first and inscription number within a block, whether or not the claiming cube is itself cursed. First is first.

Every cube in `cubes.json` has a row in `rarity.json`, and every row is one of `scored`, `cursed` or `after-close`. The experiment closes after 10,000 scored cubes; later cubes are `after-close`, neither cursed nor scored. A run that cannot settle a side's image probe keeps the sides it did resolve, leaves `rarity.json` untouched and exits non-zero; the next run retries, so a brand-new cube can be missing from `rarity.json` for a run or two but is never published with a guessed status.

**Score = tier bonus + popularity points.**

| Tier | Ordinal among scored cubes | Bonus |
|---|---|---|
| 1 | 1 to 100 | 100 |
| 2 | 101 to 1,000 | 50 |
| 3 | 1,001 to 5,000 | 25 |
| 4 | 5,001 to 10,000 | 0 |

The popularity of a collection is the number of scored cubes that show at least one side from it. A cube whose six sides all come from one collection earns popularity points: 100 × its collection's popularity ÷ the popularity of the most popular collection, rounded. Mixed cubes and cubes from collections the archive does not know earn none. Both axes top out at 100: the first hundred cubes keep their head start, and a late cube can still climb past everything below them by choosing its collection well.

**Rank** orders scored cubes by score, highest first; on a tie the older cube wins (same mint order as above), so ranks are a strict 1 to n.

**`chromeSides` is not a curse and costs no points.** It names the faces whose side the browser refuses as a texture source (see `texture` above). Those cubes rendered when they were minted, and cubes.haushoppe.art renders them still, so nothing about the cube is wrong; the field exists so a viewer can say what happened. The site labels them *Cursed | Chrome f*cked us*.

Collections come from the frozen [Magic Eden archive](https://github.com/ordpool-space/magic-eden-ordinals-archive), the same source the mint page draws its suggestions from. Further sources can be added later at one place (`scripts/collections.mjs`).

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
