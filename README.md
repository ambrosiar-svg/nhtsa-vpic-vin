# nhtsa-vpic-vin

Agent Plugin (not `.cursor-plugin`) wrapping the public NHTSA vPIC VIN decode API for Diag Desk / Ambrosia's Automotive.

- **Manifest:** `plugin.json` (Agent Plugins 1.0.0)
- **MCP:** `mcp.json` → stdio `node server/index.js`
- **Tool:** `decode_vin` `{ vin, modelYear? }` → VinDecode
- **Skill:** `skills/decode-vin/SKILL.md`
- **Proof:** see `PROOF.md`

API: `GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json` (optional `modelyear`). No auth.
