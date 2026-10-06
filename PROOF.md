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
