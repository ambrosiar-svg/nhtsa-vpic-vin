---
name: fuel-economy
description: EPA fuel economy and fuel cost for a vehicle by VIN or year/make/model, from fueleconomy.gov. Use when asked about MPG, MPGe, EV range, annual fuel cost, CO2, or "how much will it cost to fuel".
---

# Fuel economy (`fuel_economy`)

Call `fuel_economy` with `{ "vin": "..." }` or `{ "year": 2013, "make": "Ford", "model": "F-150" }`. If a previous call listed options, call again with `{ "option": "<epaId>" }`.

Source: EPA/DOE web services `https://www.fueleconomy.gov/ws/rest/` (menu/make → menu/model → menu/options → vehicle/{id}, plus /fuelprices). Free, no key. EPA has **no VIN lookup**; the VIN is decoded via NHTSA vPIC to year/make/model, then matched to EPA model names (e.g. `F-150` → `F150 Pickup 2WD/4WD/FFV`).

## Output

- `selected` (only when EPA has exactly one option, or you passed `option`) or `options[]` (every trim/engine/drive EPA lists, each with its own figures) with `selected: null`.
- Per vehicle: `mpg {city, highway, combined}` (gas) or `mpge` + `kWhPer100mi` + `rangeMiles` (EV), `annualFuelCostUSD`, `youSaveSpend5yrUSD` (positive = saves vs average new vehicle over 5 years), `co2TailpipeGramsPerMile`, `fuelType`, `drive`, `engine`, `transmission`.
- `consistentWithVinDecode` — hint comparing only cylinders/displacement/drive that vPIC decoded. Not a match; don't pick based on it alone — say "likely" and ask.
- `assumptions` (15,000 mi/yr, 55% city) and `fuelPricesUsed` (EPA's current $/gal, $/kWh).

## Rules

- Multiple options: list them; never silently pick one. Ask for engine/drive/trim.
- Cost-to-own: only EPA fuel cost and 5-year save/spend. Depreciation, insurance, maintenance, repairs: say **not available from this source**.
