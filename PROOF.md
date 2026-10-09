# PROOF — nhtsa-vpic-vin (Agent Plugin)

**Date:** 2026-10-06 (America/New_York)  
**Scaffold:** `/workspace/nhtsa-vpic-vin-plugin/`  
**Local install:** `/home/box/.cursor/plugins/local/nhtsa-vpic-vin/` (real directory, not a symlink)

## Checklist (prove-plugin-local)

| Step | Result |
|------|--------|
| 1. Validate `plugin.json` vs agent-plugins 1.0.0 plugin.schema.json (Ajv) | **PASS** |
| 1. Validate `mcp.json` vs agent-plugins 1.0.0 mcp.schema.json (Ajv) | **PASS** |
| 2. `node --check server/index.js` | **PASS** |
| 2. Live MCP: `initialize` + `tools/list` + `tools/call decode_vin` × 3 VINs | **PASS** |
| 3. Copy into `~/.cursor/plugins/local/nhtsa-vpic-vin` (real dir) | **PASS** |
| 4. `@anysphere/cursor-plugins` `loadUserLocalPlugins` | **SKIPPED** — package not available in this environment |
| 5. Cursor IDE Customize / Reload Window | **NOT PROVEN** — Grok Bot / box environment; no Cursor IDE UI here |

## Tools exposed

| Tool | One-liner |
|------|-----------|
| `decode_vin` | Decode a VIN via public NHTSA vPIC `DecodeVinValues`; returns compact VinDecode (year/make/model/…) |

## MCP smoke summaries

### `1HGCM82633A004352` (Honda Accord-class classic)

- **year / make / model:** 2003 HONDA Accord  
- **trim:** EX-V6  
- **bodyClass:** Coupe · **fuelType:** Gasoline  
- **plant:** MARYSVILLE, OHIO, UNITED STATES (USA)  
- **errorCode:** `0` — VIN decoded clean. Check Digit (9th position) is correct  
- **PASS**

### `5YJ3E1EA1KF131548` (Tesla)

- **year / make / model:** 2019 TESLA Model 3  
- **bodyClass:** Sedan/Saloon · **fuelType:** Electric  
- **plant:** FREMONT, CALIFORNIA, UNITED STATES (USA)  
- **errorCode:** `1` — Check Digit (9th position) does not calculate properly *(NHTSA still returns usable identity fields)*  
- **PASS** (identity fields present)

### `1FTFW1ET5DFC10312` (Ford F-150)

- **year / make / model:** 2013 FORD F-150  
- **bodyClass:** Pickup · **driveType:** 4WD/4-Wheel Drive/4x4 · **fuelType:** Gasoline  
- **plant:** DEARBORN, MICHIGAN, UNITED STATES (USA)  
- **errorCode:** `1` — Check Digit (9th position) does not calculate properly *(same note as Tesla sample)*  
- **PASS** (identity fields present)

Raw tool outputs saved under scaffold as `proof-<VIN>.json` (not required in the local install copy).

## What this environment cannot prove

1. **Grok Bot does not load local plugins from `~/.cursor/plugins/local/`.** Grok Bot loads plugins from the Cursor dashboard / marketplace only. The local install is still present for Cursor IDE hosts that support local plugin imports.
2. **Cursor IDE UI** (Reload Window / Customize → confirm components) was not run here.
3. **`@anysphere/cursor-plugins` loader** is not installed on the box, so programmatic `loadUserLocalPlugins` was skipped.
4. **Org gate:** Teams/Enterprise may require “Allow Local Plugin Imports” — not tested.
5. **Publishing / Marketplace** intentionally not done (per task: do not publish or ask Ryan about affiliation).

## Layout

```text
nhtsa-vpic-vin-plugin/
├── plugin.json          # Agent Plugins 1.0.0 manifest
├── mcp.json             # stdio MCP → node server/index.js, cwd ${PLUGIN_ROOT}
├── server/index.js      # zero-dep JSON-RPC MCP + fetch → NHTSA vPIC
├── skills/decode-vin/SKILL.md
├── schemas/             # cached agent-plugins schemas used for validation
└── PROOF.md             # this file
```

## Ready to ask Ryan about publishing?

**No** — local scaffold + MCP smoke are proven, but Marketplace / dashboard publish was explicitly out of scope, and Grok Bot cannot load this from the local plugins path. Ask Ryan about publishing only after he wants Marketplace distribution or a dashboard-managed install.

---

## v0.2.0 — Recalls + complaints (2026-10-08, America/New_York)

| Step | Result |
|------|--------|
| Ajv: `plugin.json` / `mcp.json` vs agent-plugins 1.0.0 schemas | **PASS** / **PASS** |
| `node --check server/index.js` | **PASS** |
| Live MCP `tools/list` | **PASS** — decode_vin, list_recalls, list_complaints |
| Live MCP `tools/call list_recalls` + `list_complaints` × 3 VINs | **PASS** (raw: `proof-recalls-<VIN>.json`) |
| Edge: `list_recalls {make:ford, model:F150, modelYear:2013}` | **PASS** — `F150`→0, fallback `F-150`→3 |
| Edge: bogus model / empty args | **PASS** — count 0 with honest note / explicit input error |

**VIN-specific open recalls:** NHTSA documents no public no-auth VIN recall endpoint; probed `api.nhtsa.gov/recalls/recallsByVin`, `/vehicles/byVin`, `/recalls/vin/{vin}`, `/products/vehicle/vin/{vin}` → all HTTP 403 "Missing Authentication Token". `recallsByVehicle` is year/make/model-level; output `note` tells the user to check nhtsa.gov/recalls with the VIN or the dealer.

### `1HGCM82633A004352` (2003 Honda Accord)

- **Decoded vehicle:** 2003 HONDA Accord
- **Recall queries:** `Accord` → HTTP 200, 24
- **Recalls:** 24
  - `19E068000` · VEHICLE SPEED CONTROL:ACCELERATOR PEDAL — Dorman Products, Inc.  (Dorman) is recalling certain Accelerator Pedal Assemblies part numbers 699-114 and 825-5029-1, sold as replacement parts for 2003-2006 Acura MDX, 2004-2008 Acura TL and TSX, 20…
  - `19V499000` · AIR BAGS:FRONTAL:DRIVER SIDE:INFLATOR MODULE — Honda (American Honda Motor Co.) is recalling certain 2003 Acura 3.2CL, 2002-2003 3.2TL, 2003-2006 MDX, 2001-2007 Honda Accord, 2001-2005 Civic, 2003-2005 Civic Hybrid, 2001-2005 Civic GX NGV, 2002-20…
- **Complaints:** 2013 (crashes 158, fires 19, injuries 157, deaths 1); top: POWER TRAIN (926); AIR BAGS (324); SERVICE BRAKES, HYDRAULIC (146); ELECTRICAL SYSTEM (143); ENGINE AND ENGINE COOLING (95)

### `5YJ3E1EA1KF131548` (2019 Tesla Model 3)

- **Decoded vehicle:** 2019 TESLA Model 3
- **Recall queries:** `Model 3` → HTTP 200, 22
- **Recalls:** 22
  - `26V507000` · EXTERIOR LIGHTING:HEADLIGHTS — Tesla, Inc. (Tesla) is recalling certain 2017-2023 Model 3 and 2020-2023 Model Y vehicles. The headlight low beams may be too bright and exceed the maximum light output. As such, these vehicles fail t…
  - `24V935000` · TIRES:PRESSURE MONITORING AND REGULATING SYSTEMS — Tesla, Inc. (Tesla) is recalling certain 2024 Cybertruck, 2017-2025 Model 3, and 2020-2025 Model Y vehicles.  The tire pressure monitoring system (TPMS) warning light may not remain illuminated betwee…
- **Complaints:** 616 (crashes 60, fires 5, injuries 30, deaths 4); top: FORWARD COLLISION AVOIDANCE (169); ELECTRICAL SYSTEM (91); AIR BAGS (86); SUSPENSION (82); UNKNOWN OR OTHER (78)

### `1FTFW1ET5DFC10312` (2013 Ford F-150)

- **Decoded vehicle:** 2013 FORD F-150
- **Recall queries:** `F-150` → HTTP 200, 3; `F-150 REGULAR CAB` → HTTP 400, 0; `F-150 SUPER CREW` → HTTP 400, 0; `F-150 SUPERCAB` → HTTP 400, 0
- **Recalls:** 3
  - `19V433000` · POWER TRAIN:AUTOMATIC TRANSMISSION — Ford Motor Company (Ford) is recalling certain 2013 F-150 vehicles equipped with 5.0L or 6.2L gasoline engines, that previously had the powertrain control module (PCM) software reprogrammed under reca…
  - `19V075000` · POWER TRAIN:AUTOMATIC TRANSMISSION:CONTROL MODULE (TCM/PCM/TECM) — Ford Motor Company (Ford) is recalling certain 2011-2013 F-150 vehicles equipped with a 6-speed automatic transmission.  The transmission may unexpectedly downshift into first gear, regardless of vehi…
- **Complaints:** 2796 (crashes 74, fires 31, injuries 60, deaths 1); top: POWER TRAIN (1212); ENGINE (531); SERVICE BRAKES (309); ELECTRICAL SYSTEM (306); VEHICLE SPEED CONTROL (275)

### Observed API quirks

- `ReportReceivedDate` in recalls is DD/MM/YYYY (e.g. `27/01/2022`); tool adds derived `reportReceivedDateIso`.
- Zero matches return HTTP 400 with `{Count:0, results:[]}`; treated as a valid 0.
- 2013 Ford: recalls only match `F-150` (cab variants → 0); complaints only match cab variants (`F-150` → 0), and all three variants return the same 2796 ODI numbers (deduped).
- Complaint `components` joins names with a bare comma; names can contain `, ` (e.g. `SERVICE BRAKES, HYDRAULIC`), so the split is on `,` not followed by a space.
- Count of 3 recalls for the 2013 F-150 is what NHTSA's API returned for `F-150`; it was not cross-checked against the nhtsa.gov website.

Local install re-synced to `~/.cursor/plugins/local/nhtsa-vpic-vin/`. Nothing pushed to GitHub or published.
