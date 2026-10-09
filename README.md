# nhtsa-vpic-vin

Agent Plugin (not `.cursor-plugin`) wrapping public NHTSA APIs (no auth) for Diag Desk / Ambrosia's Automotive: VIN decode, safety recalls, and owner-complaint summaries.

- **Manifest:** `plugin.json` (Agent Plugins 1.0.0)
- **MCP:** `mcp.json` → stdio `node server/index.js` (zero dependencies, Node 18+ global `fetch`)
- **Tools:**
  - `decode_vin` `{ vin, modelYear? }` → VinDecode
  - `list_recalls` `{ vin?, make?, model?, modelYear? }` → `{ vehicle, source, queries, count, recalls:[RecallItem], note }`
  - `list_complaints` `{ vin?, make?, model?, modelYear?, top? }` → `{ vehicle, source, queries, count, crashes, fires, injuries, deaths, topComponents, note }`
- **Skills:** `skills/decode-vin/SKILL.md`, `skills/list-recalls/SKILL.md`
- **Proof:** see `PROOF.md`, `proof-<VIN>.json`, `proof-recalls-<VIN>.json`

## APIs

- VIN decode: `GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json` (optional `modelyear`)
- Recalls: `GET https://api.nhtsa.gov/recalls/recallsByVehicle?make=&model=&modelYear=`
- Complaints: `GET https://api.nhtsa.gov/complaints/complaintsByVehicle?make=&model=&modelYear=`
- Model-name fallbacks: `GET https://api.nhtsa.gov/products/vehicle/models?modelYear=&make=&issueType=r|c`

## Important caveats

- **Recalls are year/make/model-level, not VIN-confirmed.** NHTSA has no public no-auth VIN open-recall API (VIN-style paths on api.nhtsa.gov return 403 "Missing Authentication Token"). Check nhtsa.gov/recalls with the VIN or the dealer to confirm if a recall is open on a specific vehicle.
- `recallsByVehicle` `ReportReceivedDate` is **DD/MM/YYYY**; the tool also emits a derived `reportReceivedDateIso`.
- api.nhtsa.gov answers **HTTP 400 with `{Count:0, results:[]}`** when nothing matches; the tool treats that as a valid zero.
- Model names differ between vPIC and the recalls/complaints data (e.g. 2013 Ford: recalls use `F-150`, complaints use `F-150 SUPER CREW` / `SUPERCAB` / `REGULAR CAB`). The tool tries the given name, a hyphenated spelling (`F150`→`F-150`), and matching catalog names, dedupes (campaign number / ODI number), and reports every query in `queries`.
