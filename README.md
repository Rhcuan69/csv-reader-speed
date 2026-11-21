# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Rhcuan69/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Rhcuan69/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's **csv-reader 1.0.0**, for the make.fun bounty
[csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121) ("Read broken CSV files
faster, 21 November 2026"). `solve.js` is a dependency-free ES module whose
`run(input)` returns exactly what csv-reader 1.0.0 returns for every
`{text, header}`: the JSON value `{columns, rows, errors}`.

## Semantics (csv-reader 1.0.0's broken-row policy)

The text is read once, left to right, with commas and double quotes:

- A U+FEFF at the very start is dropped.
- A record ends at LF or CRLF; a line left with no characters is no record.
- Outside quotes a CR not followed by LF is dropped (`stray_cr`).
- A field that opens with a quote runs to the next quote that is not doubled;
  `""` inside it is one quote, and each CRLF or lone CR inside it is read as
  LF. What follows its closing quote, up to the next comma or line break, is
  appended as it stands (`quote_junk`, when the field ends). A quote that
  never closes is a literal character, and the text after it is read again as
  unquoted (`unterminated_quote`).
- A quote inside an unquoted field is a literal character. Fields stay
  strings, never trimmed or converted.
- `columns` is the first record when `header` is true, else `null`; `rows`
  holds the records after it (every record when `header` is false), each
  padded with `""` (`short_row`, with `fields`: its field count) or cut
  (`long_row`, with `extra`: the cut fields) to the first record's width.
- Each error is `{code, line, row}`, in the order met; `line` is the 1-based
  line its record starts on (counting every LF, CRLF and lone CR inside
  quotes), `row` its record's index in `rows` (`null` for the header).

## Approach

The reference builds every field a character at a time (`value += c`), which
turns each field into a rope of per-character appends. This implementation is
one left-to-right pass that cuts each field out with a single `slice`:

- **Unquoted field:** `indexOf(',')` and `indexOf('\n')` find the nearest
  delimiter (both native scans, each bounded by about a line); the field is
  one `slice`. A CR inside the field is detected with one more short scan;
  the common cases — no CR at all, or a trailing CR that is just the CRLF
  ending the field — stay on the fast path. Only a genuine stray CR falls
  back to a small walk that drops the CRs and records `stray_cr`.
- **Quoted field:** `indexOf('"')` finds the closing quote; a field with no
  doubled quotes and no line breaks inside is one `slice`. Doubled quotes
  and CR/LF inside quotes are handled segment by segment (CRLF and lone CR
  become LF, each counting one line).
- **Unterminated quote:** the scan resets to just after the opening quote,
  records `unterminated_quote`, and re-reads the field as unquoted with the
  quote as its first character — exactly as the reference does, including
  the line-number reset.
- **Junk after a closing quote:** re-uses the unquoted reader, so stray CRs
  inside the junk are reported before `quote_junk`, in the reference's order.

No dependencies, no imports, no state kept between calls. `main.ts` is the
kit baseline's driver (it reads `/input/cases.json`, answers each case with
`run`, writes `/output/answers.json`); it is not modified.

## Benchmark

Practice set: 6 cases, 10,193,953 characters total. Node v24.22.1,
`--no-incremental-marking` (as the harness runs), this machine, 7 rounds.

| | `run()` only, all 6 cases |
|---|---|
| this `solve.js` | mean **126.6 ms**, median **110.9 ms** (~80 MB/s) |
| csv-reader 1.0.0 (reference) | mean **669.2 ms**, median **689.4 ms** |
| **speedup** | **5.28x mean, 6.22x median** |

End to end through the `main.ts` driver (including JSON parse of the cases,
all 6 `run()` calls, JSON stringify of the 11.6 MB answers and file I/O):
~990 ms vs ~2050 ms for the reference (~2.1x); the remaining time is the
fixed JSON/parse cost both entries pay.

## Correctness

- `node tools/check.mjs` — all **6/6 practice cases byte-identical**
  (`JSON.stringify` equal) to the reference and to
  `practice/reference/expected.json`.
- `node tools/fuzz.mjs [count] [seed]` — **10,000/10,000 random small
  broken-CSV inputs identical** to the reference (quotes, stray CRs, CRLF,
  junk after quotes, unterminated quotes, BOM, empty lines).
- `node tools/bench.mjs [rounds]` — the benchmark above.

## Layout

- `solve.js` — the entry (ES module, `run(input)`).
- `main.ts` — the kit baseline's driver; copy it from
  `baselines/csv-reader/main.ts` in the kit when assembling the repo.
- `package.json` — `{"type": "module"}` so `solve.js`/`main.ts` load as ESM.
- `LICENSE` — MIT (`SPDX-License-Identifier: MIT`).
- `.makefun/owner.json` — the claim file naming the account's primary wallet.
- `tools/` — `check.mjs` (correctness vs reference + expected),
  `bench.mjs` (benchmark vs reference), `fuzz.mjs` (random-input
  differential test), `check2.mjs`/`one.mjs`/`bisect.mjs`/`region.mjs`
  (small-case debugging helpers used during development).

## License

MIT — see [LICENSE](LICENSE).
