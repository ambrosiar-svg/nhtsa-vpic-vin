---
name: decode-vin
description: >-
  WHEN to call: identify a vehicle from a VIN for Diag Desk diagnostics, shop
  repair orders (RO), parts lookup, or Ambrosia's Automotive intake. Use the
  decode_vin MCP tool against NHTSA vPIC. Never invent year/make/model or other
  API fields — only report what decode_vin returns.
---

# Decode VIN (NHTSA vPIC)

## When to use

Call this skill whenever you have (or the user provides) a Vehicle Identification
Number and need structured vehicle identity for:

- Diag Desk / diagnostic sessions
- Shop repair orders (RO) and intake
- Confirming year / make / model / trim before parts or TSB lookup
- Partial VINs (use `*` for unknown characters)

## How

1. Collect the VIN string (17 characters preferred; partial VINs with `*` allowed).
2. Optionally pass `modelYear` when the user knows the year — improves decode of
   ambiguous / incomplete VINs.
3. Call the MCP tool **`decode_vin`** with `{ "vin": "<VIN>", "modelYear": <optional number> }`.
4. Present the returned **VinDecode** fields. Do **not** invent, guess, or fill
   missing year/make/model/trim from memory or training data.
5. If `errorCode` / `errorText` indicate a problem, surface that honestly. Error
   code `0` means a clean decode; other codes may still include usable fields —
   report both the identity fields and the error text.

## VinDecode shape (tool output)

- `vin`, `year`, `make`, `model`
- optional: `trim`, `bodyClass`, `driveType`, `fuelType`, `plantCity`, `plantState`, `plantCountry`
- `errorCode`, `errorText`
- other useful non-empty NHTSA fields may appear when cheap to include

## Rules

- **Never invent API data.** If the tool fails or returns empty make/model, say so.
- Public API, no auth: NHTSA vPIC `DecodeVinValues`.
- Do not claim Marketplace / published status unless Ryan has approved publishing.
