# boundstone-jurisdictions-2026-10-07.csv

449 distinct `(state, jurisdiction, jtype)` triples, snapshotted **2026-10-07**
from Boundstone's public anonymous REST view — the only sanctioned read path
(FDY-93 guardrail 4: Faraday never touches Boundstone's database):

```
curl -H "apikey: <Boundstone publishable key>" \
  "https://fwnerwrtlgnchuprvfgl.supabase.co/rest/v1/bs_records?select=state,state_name,jurisdiction,jtype&limit=10000"
```

The publishable key `sb_publishable_ZASr4xoegYQiiAd0RfzSiw_0mhsSU1G` is public by
design and is the key the private site itself ships to the browser.

**Column names differ from the FDY-93 issue text.** The issue says
`state_abbr, jurisdiction_name, jurisdiction_type`; the live view exposes
`state, jurisdiction, jtype`. Requesting the issue's names returns
`400 {"code":"42703","message":"column bs_records.state_abbr does not exist"}`.
The live names are what this snapshot uses.

Measured at fetch time:

* `bs_records` rows: **452** (`content-range: 0-0/452`)
* distinct `(state, jurisdiction, jtype)`: **449**
* by `jtype`: County 180 · City 149 · Township 58 · Town 40 · Village 14 ·
  Tribal 3 · Other 2 · Parish 1 · Utility-authority 1 · State 1
* distinct states: 42

Nothing in this file is derived from the Boundstone database, from a privileged
key, or from any Faraday → Boundstone join. It is consumed only by
`scripts/gen-local-watch-county-complete.mjs`.
