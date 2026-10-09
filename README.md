# nhtsa-vpic-vin

Agent Plugin (not `.cursor-plugin`) wrapping free public APIs (no auth) for Diag Desk / Side Lane / Ambrosia's Automotive: NHTSA VIN decode, safety recalls, owner-complaint summaries, a used-car buyer's check, and EPA fueleconomy.gov fuel economy. Version 0.3.0.

- **Manifest:** `plugin.json` (Agent Plugins 1.0.0)
- **MCP:** `mcp.json` → stdio `node server/index.js` (zero dependencies, Node 18+ global `fetch`)
- **Tools:**
  - `decode_vin` `{ vin, modelYear? }` → VinDecode
  - `list_recalls` `{ vin?, make?, model?, modelYear? }` → `{ vehicle, source, queries, count, recalls:[RecallItem], note }`
  - `list_complaints` `{ vin?, make?, model?, modelYear?, top? }` → `{ vehicle, source, queries, count, crashes, fires, injuries, deaths, topComponents, note }`
  - `buyer_check` `{ vin, mileage? }` → `{ vehicle, recalls{count,top,caveat}, complaints{count,…,topComponents}, whatToInspect[{area,why,steps}], unmappedAreas?, genericBaseline{label,items}, sources, note }`
  - `fuel_economy` `{ vin? | year, make, model, option? }` → `{ assumptions, fuelPricesUsed, costToOwnNote, optionCount, selected | options[], note }` (MPG or MPGe/kWh/range, annual fuel cost, 5-yr save/spend, CO2)
- **Skills:** `skills/decode-vin`, `skills/list-recalls`, `skills/buyer-check`, `skills/fuel-economy` (each `SKILL.md`)
- **Proof:** see `PROOF.md`, `proof-<VIN>.json`, `proof-recalls-<VIN>.json`, `proof-buyer-<VIN>.json`, `proof-fuel-<VIN>.json`, `proof-tools-list.json`
- **Maintenance-due research (not built):** `MAINTENANCE-RESEARCH.md`

## APIs

- VIN decode: `GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json` (optional `modelyear`)
- Recalls: `GET https://api.nhtsa.gov/recalls/recallsByVehicle?make=&model=&modelYear=`
- Complaints: `GET https://api.nhtsa.gov/complaints/complaintsByVehicle?make=&model=&modelYear=`
- EPA fuel economy: `GET https://www.fueleconomy.gov/ws/rest/vehicle/menu/{make|model|options}?year=&make=&model=`, `/vehicle/{id}`, `/fuelprices` (JSON via `Accept: application/json`)
- Model-name fallbacks: `GET https://api.nhtsa.gov/products/vehicle/models?modelYear=&make=&issueType=r|c`

## Important caveats

- **Recalls are year/make/model-level, not VIN-confirmed.** NHTSA has no public no-auth VIN open-recall API (VIN-style paths on api.nhtsa.gov return 403 "Missing Authentication Token"). Check nhtsa.gov/recalls with the VIN or the dealer to confirm if a recall is open on a specific vehicle.
- `recallsByVehicle` `ReportReceivedDate` is **DD/MM/YYYY**; the tool also emits a derived `reportReceivedDateIso`.
- api.nhtsa.gov answers **HTTP 400 with `{Count:0, results:[]}`** when nothing matches; the tool treats that as a valid zero.
- Model names differ between vPIC and the recalls/complaints data (e.g. 2013 Ford: recalls use `F-150`, complaints use `F-150 SUPER CREW` / `SUPERCAB` / `REGULAR CAB`). The tool tries the given name, a hyphenated spelling (`F150`→`F-150`), and matching catalog names, dedupes (campaign number / ODI number), and reports every query in `queries`.
- **buyer_check** inspection areas come only from this vehicle's top-5 complaint categories and its recall components; the generic baseline is labeled GENERIC. Mileage is echoed only.
- **fuel_economy:** EPA has no VIN lookup. Model names are prefix-matched (`F-150` → `F150 Pickup 2WD/4WD/FFV`). With >1 EPA option nothing is picked; all options (first 12 with figures) are listed with a `consistentWithVinDecode` hint. Cost figures are EPA's only (15,000 mi/yr, 55% city, EPA's current fuel prices); no depreciation/insurance/maintenance. When EPA returns a single option, `menuItem` is an object, not an array (handled).
