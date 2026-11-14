# Token Radar — Build the best token launch radar

A dashboard that finds protocols whose token does not exist yet, ranks them by an
implied value, and shows a reader how to farm each one.

## The model (radar-2)

The implied value of a pre-token protocol is derived from the snapshot's own figures:

```
implied = round( tvl_usd x ratio(category)
                 x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
                 x (0.6 + min(age_days, 1095) / 1095 x 0.4) )
```

`ratio(category)` is the FDV/TVL ratio the market already pays that category, read off the
token-bearing protocols in the same snapshot: each protocol's `mcap_usd / tvl_usd`, clamped to
[0.001, 5], taken as the category median, then shrunk toward the global median (0.205) with a
prior of 8 protocols. A category with no token-bearing protocol of its own takes the global
median. No protocol name is ever special-cased.

The board ranks every genuine pre-token protocol (198): the whole 40-protocol watchlist plus
158 pre-token protocols below the floor. Wrapped, staked and bridged products of tokens that
already trade (WBTC, staked ETH, bridges) are set aside on their own tab, never ranked — a
wrapped token is not a launch. Live-token protocols are set aside with their market caps.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22 or later, standard library only, no network. The run is deterministic: two runs
write the same bytes. Output: `board.json`, `data.js`, `dashboard/`, `screenshots/`,
`dossier.json`.

## Layout

- `main.ts` — entrypoint: reads the snapshot, scores the board, writes the outputs.
- `lib/model.ts` — the value model, the farm-plan generator, the snapshot parser.
- `vendor/makefun-board.ts` — make.fun's dossier library (copied from the kit).
- `dashboard/` — `index.html`, `app.css`, `app.js`: sortable, filterable board; live-token
  and wrapped-product tabs; a detail sheet per protocol with the model's arithmetic, a note
  to the judge, and the farm plan.
- `screenshots/` — the board, a protocol detail, a filtered view (1440x900).
