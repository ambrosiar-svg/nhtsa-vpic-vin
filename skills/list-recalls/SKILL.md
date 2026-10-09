---
name: list-recalls
description: >-
  WHEN to call: Ryan or a tech asks for recalls (or "recalls, complaints, etc.")
  on a vehicle — at intake, on a repair order, before quoting work, or when a
  symptom might be a known recall. Use the list_recalls MCP tool (NHTSA public
  recallsByVehicle) with a VIN or year/make/model; optionally list_complaints
  for owner-complaint trends. Never invent recalls, counts or remedies.
---

# List recalls (NHTSA)

## When to use

- Customer vehicle on the lift / at intake: "any recalls on this?"
- Symptom matches a possible safety defect (air bags, brakes, transmission, fuel leak)
- Before quoting a repair that a free recall remedy might cover
- "Pull from NHTSA, etc." → `list_recalls`, and `list_complaints` for the "etc."

## How

1. Call **`list_recalls`** with `{ "vin": "<VIN>" }` (preferred — decoded via vPIC),
   or `{ "make", "model", "modelYear" }`. Explicit make/model/year override the decode.
2. The tool tries the given model name plus matching NHTSA catalog names
   (e.g. `F150` → `F-150`, cab variants) and lists every query in `queries`.
3. Optionally call **`list_complaints`** (same inputs, optional `top`) for complaint
   count, crash/fire/injury/death totals and top components.

## How to present

One line per recall, newest first:

`<campaignNumber> · <component> — <plain-English one-line summary>. Remedy: <short remedy>.`

Example shape (fill only from tool output):
`19V075000 · POWER TRAIN:AUTOMATIC TRANSMISSION:CONTROL MODULE — transmission may suddenly downshift into 1st. Remedy: dealer reprograms the PCM, free.`

- Lead with the vehicle (year make model) and the count.
- Call out `parkIt: true` / `parkOutside: true` loudly (do-not-drive / park-outside fire risk).
- Note `overTheAirUpdate: true` (remedy is an OTA update, not a shop visit).
- If `count` is 0, say NHTSA returned 0 for the queried names — do not claim the
  vehicle has no recalls; show the `queries` used.
- Complaints: give total, crash/fire counts, top 3–5 components. Complaints are
  unverified owner reports, not recalls.

## Required caveat (always include)

These recalls are for the model year/make/model, **not confirmed open on this
exact vehicle**. NHTSA has no public, no-auth VIN-specific open-recall API.
**Check nhtsa.gov/recalls with the VIN or the dealer to confirm if it is open on
this specific vehicle.**

## RecallItem shape (tool output)

`campaignNumber`, `reportReceivedDate` (NHTSA's DD/MM/YYYY string),
`reportReceivedDateIso` (derived YYYY-MM-DD), `component`, `summary`,
`consequence`, `remedy`, `manufacturer`; when NHTSA provides them: `parkIt`,
`parkOutside`, `overTheAirUpdate`, `nhtsaActionNumber`, `nhtsaModel`.

## Rules

- Never invent recalls, campaign numbers, counts, dates or remedies.
- Public API, no auth: `api.nhtsa.gov/recalls/recallsByVehicle`,
  `api.nhtsa.gov/complaints/complaintsByVehicle`.
