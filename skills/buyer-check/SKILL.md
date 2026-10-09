---
name: buyer-check
description: Used-car buyer's check from a VIN (Side Lane bot). Use when someone is looking at buying a used vehicle and gives a VIN (and maybe mileage) and wants to know what to watch out for or inspect.
---

# Buyer check (`buyer_check`)

Call the MCP tool `buyer_check` with `{ "vin": "<17 chars>", "mileage": <optional number> }`.

It decodes the VIN (NHTSA vPIC), then pulls NHTSA recalls and owner complaints for that year/make/model and returns:

- `vehicle` — decoded year/make/model/trim/body/drive/fuel.
- `recalls` — `count`, up to 5 most recent (`campaignNumber`, `date`, `component`, `summary`), and `caveat`.
- `complaints` — totals (count, crashes, fires, injuries, deaths) and `topComponents` (top 5).
- `whatToInspect` — inspection steps ONLY for component categories that appear in this vehicle's top complaints or its recalls; each item says `why` (complaint count or recall number).
- `unmappedAreas` — categories present in the data with no canned steps (e.g. UNKNOWN OR OTHER).
- `genericBaseline` — a generic pre-purchase checklist, clearly labeled GENERIC (not from this vehicle's data).

## How to present it

1. Vehicle line, then "N recalls on record for this year/make/model" + top recalls.
2. Always say: recalls are year/make/model-level, **not confirmed open on this VIN** — check nhtsa.gov/recalls with the VIN or a dealer.
3. Complaint totals and top components; complaints are unverified owner reports.
4. The vehicle-specific inspection list, then the generic baseline under its own heading.
5. Mileage is echoed only. There is no maintenance-schedule data source in this plugin; don't invent "due at this mileage" items.

Never add recalls, complaints, or inspection areas that the tool did not return.
