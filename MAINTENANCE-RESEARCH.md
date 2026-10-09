# Maintenance-due data source research (research only — nothing built, no signups)

Researched 2026-10-09. Free NHTSA APIs have no maintenance schedules. No candidate below was called; response shapes are from the vendors' own docs.

| Source | What it returns | Lookup | Auth | Pricing (published) | Terms notes |
|---|---|---|---|---|---|
| **Vehicle Databases** — Vehicle Maintenance API | OEM schedule: list of `{mileage:{miles,km}, service_items:[...]}` intervals, resolved to trim, up to 200k+ mi; US 1983+ | VIN (`GET https://api.vehicledatabases.com/vehicle-maintenance/v4/{vin}`) or year/make/model. Full schedule; "due now" = filter by mileage client-side | API key | https://vehicledatabases.com/pricing — testing $50 one-time/200 credits, $100/450; monthly from $100/mo (500 credits, $0.20/credit, up to 3 APIs) to $2,500/mo; pay-as-you-go packs. Credits-per-maintenance-call not stated on the page. | https://vehicledatabases.com/terms-and-conditions — non-sublicensable license; may not "cache or otherwise store any Vehicle Databases content", no bulk download, no making the API available to third parties. |
| **CarMD / CarScan** — `/v3.0/maint`, `/maintlist`, `/upcoming` | Items due within ±10,000 mi of given mileage: `desc`, `due_mileage`, `is_oem`, repair `{repair_difficulty, repair_hours, labor_rate_per_hour, part_cost, labor_cost, total_cost}`, `parts[]`. Includes non-OEM items (flagged `is_oem:false`). `/upcoming` = predicted repairs w/ probability. US/NA 1996+ | VIN + mileage, or year/make/model + mileage | partner token + auth key | https://api.carmd.com/member/docs — per-request credits, buy any amount; free tier historically 10 credits/day (python-carmd docs). No public $/credit or per-endpoint credit cost → **quote/console required**. | Not reviewed in full (terms page not reachable by fetch). |
| **DataOne Software** — OEM Service Schedules | Normal + Premium/Severe/High-mileage OEM schedules, time + mileage intervals, maintenance-code interpretation | VIN / DataOne VehicleID; API or daily SFTP flat file (US light duty 2000+) | Licensed | **Quote required** (https://www.dataonesoftware.com/vehicle-data-vin-decoding/vehicle-service-data) | Enterprise license. |
| **MOTOR** — DaaS Maintenance Schedules | OEM schedules with labor time per operation, normal/severe, indicator-based, 1985+ LD | YMME, ACES, VIN; REST XML/JSON | Public/private key pair from MOTOR | **Quote required** ("contact MOTOR sales", https://www.motor.com/products-services/data-products/maintenance-schedules/). Public sandbox exists (docs at https://www.motor.com/developer-hub/). | Licensed product. |
| **Edmunds** — Service: Maintenance | (Archived) OEM schedule by model-year ID | — | — | **Not available**: open API retired; access disabled Feb 15, 2018; partners/dealers only (https://developer.edmunds.com/faq.html) | — |
| **Autodata (Solera)** | Service schedules inside its workshop software | — | Subscription | Quote required; no public developer API found | — |
| **OEM owner's manuals** | Authoritative schedules (PDF/HTML on OEM owner sites) | Manual per model | none | Free to read | Not an API; scraping OEM sites raises ToS issues; no consistent format. |

## Recommendation

**Vehicle Databases Vehicle Maintenance API**, $50 one-time testing package first (200 credits) — the only option with public pricing, VIN lookup, a documented clean OEM-only JSON shape, and self-serve signup. "Due now" would be computed by the tool from the returned intervals and the given mileage (labeled as such).

Runner-up: CarMD/CarScan (mileage-native ±10k window and cost estimates, free daily credits) — but mixes non-OEM items and pricing isn't public.

**Ryan must approve:** (1) creating a Vehicle Databases account in his/shop name, (2) spending $50 (testing) and later possibly $100+/mo, (3) storing the API key (env var, not committed), (4) accepting the no-cache/no-store/no-third-party terms — this affects whether Side Lane (customer-facing) may show results; confirm with their account manager.
