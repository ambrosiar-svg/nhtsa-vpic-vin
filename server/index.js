#!/usr/bin/env node
/**
 * Zero-dependency stdio MCP server: NHTSA vPIC VIN decode, NHTSA recalls/complaints,
 * used-car buyer check, and EPA fueleconomy.gov fuel economy.
 * Node 18+ (uses global fetch). Hand-rolled JSON-RPC over stdin/stdout.
 */
"use strict";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "nhtsa-vpic-vin", version: "0.3.0" };
const VPIC_BASE =
  "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";
const NHTSA_API = "https://api.nhtsa.gov";
const VIN_CONFIRM_NOTE =
  "These are recalls NHTSA lists for this model year/make/model, NOT confirmed open on this specific vehicle. NHTSA has no public no-auth VIN-specific open-recall API. Check nhtsa.gov/recalls with the VIN or the dealer to confirm if it is open on this specific vehicle.";

/** Canonical VinDecode field map from DecodeVinValues flat keys. */
const CORE_MAP = {
  VIN: "vin",
  ModelYear: "year",
  Make: "make",
  Model: "model",
  Trim: "trim",
  BodyClass: "bodyClass",
  DriveType: "driveType",
  FuelTypePrimary: "fuelType",
  PlantCity: "plantCity",
  PlantState: "plantState",
  PlantCountry: "plantCountry",
  ErrorCode: "errorCode",
  ErrorText: "errorText",
};

/** Extra useful NHTSA keys to include when non-empty (cheap). */
const EXTRA_KEYS = [
  "Series",
  "Series2",
  "VehicleType",
  "Doors",
  "EngineCylinders",
  "DisplacementL",
  "EngineModel",
  "TransmissionStyle",
  "ElectrificationLevel",
  "GVWR",
  "Manufacturer",
  "ManufacturerId",
  "PlantCompanyName",
  "DestinationMarket",
];

function nonempty(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return s.length > 0;
}

function mapVinDecode(row) {
  const out = {};
  for (const [src, dest] of Object.entries(CORE_MAP)) {
    const v = row[src];
    if (dest === "vin" || dest === "errorCode" || dest === "errorText") {
      if (v != null && String(v).length > 0) out[dest] = String(v).trim();
    } else if (nonempty(v)) {
      out[dest] = String(v).trim();
    }
  }
  // Year as number when parseable
  if (out.year && /^\d{4}$/.test(out.year)) {
    out.year = Number(out.year);
  }
  for (const key of EXTRA_KEYS) {
    if (nonempty(row[key]) && out[key] === undefined && !(key in CORE_MAP)) {
      // camelCase-ish extras under extras bag to keep VinDecode clean
      if (!out.extras) out.extras = {};
      out.extras[key] = String(row[key]).trim();
    }
  }
  return out;
}

async function decodeVin(vin, modelYear) {
  const cleaned = String(vin || "").trim().toUpperCase();
  if (!cleaned) {
    return {
      errorCode: "client",
      errorText: "vin is required",
    };
  }
  let url = `${VPIC_BASE}/${encodeURIComponent(cleaned)}?format=json`;
  if (modelYear != null && modelYear !== "") {
    const y = Number(modelYear);
    if (!Number.isFinite(y) || y < 1980 || y > 2100) {
      return {
        vin: cleaned,
        errorCode: "client",
        errorText: "modelYear must be a number between 1980 and 2100",
      };
    }
    url += `&modelyear=${encodeURIComponent(String(y))}`;
  }
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    return {
      vin: cleaned,
      errorCode: "http",
      errorText: `NHTSA vPIC HTTP ${res.status} ${res.statusText}`,
    };
  }
  const body = await res.json();
  const row =
    body && Array.isArray(body.Results) && body.Results.length
      ? body.Results[0]
      : null;
  if (!row) {
    return {
      vin: cleaned,
      errorCode: "empty",
      errorText: "NHTSA vPIC returned no Results",
    };
  }
  return mapVinDecode(row);
}


/* ------------------------------------------------------------------ */
/* Recalls / complaints (api.nhtsa.gov, public, no auth)               */
/* ------------------------------------------------------------------ */

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  // NOTE: api.nhtsa.gov answers HTTP 400 with {"Count":0,"results":[]} when
  // nothing matches; treat a parseable body with a results array as valid.
  if (body && Array.isArray(body.results)) return { ok: true, status: res.status, body };
  return { ok: false, status: res.status, body };
}

function normModel(m) {
  return String(m || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Convert NHTSA DD/MM/YYYY (recalls) to YYYY-MM-DD; null if not that shape. */
function ddmmyyyyToIso(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || "").trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** RecallItem: only fields NHTSA returns; optional flags only when present. */
function mapRecall(r) {
  const out = {
    campaignNumber: r.NHTSACampaignNumber,
    reportReceivedDate: r.ReportReceivedDate,
  };
  const iso = ddmmyyyyToIso(r.ReportReceivedDate);
  if (iso) out.reportReceivedDateIso = iso;
  out.component = r.Component;
  out.summary = r.Summary;
  out.consequence = r.Consequence;
  out.remedy = r.Remedy;
  out.manufacturer = r.Manufacturer;
  if (typeof r.parkIt === "boolean") out.parkIt = r.parkIt;
  if (typeof r.parkOutSide === "boolean") out.parkOutside = r.parkOutSide;
  if (typeof r.overTheAirUpdate === "boolean")
    out.overTheAirUpdate = r.overTheAirUpdate;
  if (nonempty(r.NHTSAActionNumber)) out.nhtsaActionNumber = r.NHTSAActionNumber;
  if (nonempty(r.Model)) out.nhtsaModel = r.Model;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/**
 * Resolve {make, model, year} from args (VIN decode via vPIC if vin given).
 * Explicit make/model/modelYear override decoded values.
 */
async function resolveVehicle(args) {
  let decoded = null;
  let make = nonempty(args.make) ? String(args.make).trim() : null;
  let model = nonempty(args.model) ? String(args.model).trim() : null;
  let year =
    args.modelYear != null && args.modelYear !== "" ? Number(args.modelYear) : null;
  if (nonempty(args.vin)) {
    decoded = await decodeVin(args.vin, year != null ? year : undefined);
    if (!make && decoded.make) make = decoded.make;
    if (!model && decoded.model) model = decoded.model;
    if (year == null && typeof decoded.year === "number") year = decoded.year;
  }
  return { make, model, year, decoded };
}

/**
 * Candidate model names: the given model first, then NHTSA product-catalog
 * models for that year/make whose normalized name equals or starts with the
 * normalized given model (e.g. "F150" -> "F-150 SUPER CREW").
 */
async function candidateModels(make, model, year, issueType) {
  const base = normModel(model);
  const baseNoSpace = base.replace(/ /g, "");
  const cands = [model];
  const add = (m) => {
    if (m && !cands.some((c) => String(c).toUpperCase() === String(m).toUpperCase())) cands.push(m);
  };
  // Cheap spelling fallback: "F150" -> "F-150", "CX5" -> "CX-5".
  const hy = /^([A-Za-z]+)(\d+)$/.exec(String(model).trim());
  if (hy) add(`${hy[1]}-${hy[2]}`);
  const url = `${NHTSA_API}/products/vehicle/models?modelYear=${encodeURIComponent(
    String(year)
  )}&make=${encodeURIComponent(make)}&issueType=${issueType}`;
  try {
    const r = await getJson(url);
    if (r.ok) {
      const seen = new Set([base]);
      for (const row of r.body.results) {
        const n = normModel(row.model);
        if (seen.has(n)) continue;
        const nNoSpace = n.replace(/ /g, "");
        const firstTok = n.split(" ")[0];
        // Catalog family name (e.g. "F-150" from "F-150 SUPER CREW").
        if (firstTok === baseNoSpace && n !== firstTok) add(String(row.model).split(" ")[0]);
        if (
          n === base ||
          n.startsWith(base + " ") ||
          nNoSpace === baseNoSpace ||
          (n.split(" ")[0] === baseNoSpace) // "F150" vs "F-150 ..." first token
        ) {
          seen.add(n);
          add(row.model);
        }
      }
    }
  } catch {
    /* catalog lookup is best-effort */
  }
  return cands;
}

function vehicleError(v, what) {
  return {
    vehicle: { year: v.year, make: v.make, model: v.model },
    source: NHTSA_API,
    count: 0,
    error: `Need make, model and modelYear (or a decodable vin) to look up ${what}.`,
    decodeError:
      v.decoded && v.decoded.errorText ? v.decoded.errorText : undefined,
  };
}

async function listRecalls(args) {
  const v = await resolveVehicle(args || {});
  if (!v.make || !v.model || !Number.isFinite(v.year)) return vehicleError(v, "recalls");
  const cands = await candidateModels(v.make, v.model, v.year, "r");
  const queries = [];
  const byCampaign = new Map();
  for (const m of cands) {
    const url = `${NHTSA_API}/recalls/recallsByVehicle?make=${encodeURIComponent(
      v.make
    )}&model=${encodeURIComponent(m)}&modelYear=${encodeURIComponent(String(v.year))}`;
    const r = await getJson(url);
    const n = r.ok ? r.body.results.length : null;
    queries.push({ model: m, url, httpStatus: r.status, count: n });
    if (r.ok)
      for (const row of r.body.results) {
        const item = mapRecall(row);
        if (item.campaignNumber && !byCampaign.has(item.campaignNumber))
          byCampaign.set(item.campaignNumber, item);
      }
  }
  const recalls = [...byCampaign.values()].sort((a, b) =>
    String(b.reportReceivedDateIso || "").localeCompare(String(a.reportReceivedDateIso || ""))
  );
  const out = {
    vehicle: { year: v.year, make: v.make, model: v.model },
    source: `${NHTSA_API}/recalls/recallsByVehicle`,
    queries,
    count: recalls.length,
    recalls,
    note:
      (recalls.length === 0
        ? "NHTSA returned 0 recalls for the queried year/make/model name(s). That is not proof the vehicle has none — model naming can differ. "
        : "") + VIN_CONFIRM_NOTE,
  };
  if (v.decoded) {
    out.vin = v.decoded.vin;
    if (v.decoded.errorCode && v.decoded.errorCode !== "0")
      out.decodeWarning = v.decoded.errorText;
  }
  return out;
}

async function listComplaints(args) {
  const v = await resolveVehicle(args || {});
  if (!v.make || !v.model || !Number.isFinite(v.year)) return vehicleError(v, "complaints");
  const topN = Number.isFinite(Number(args && args.top)) ? Math.max(1, Number(args.top)) : 10;
  const cands = await candidateModels(v.make, v.model, v.year, "c");
  const queries = [];
  const byOdi = new Map();
  for (const m of cands) {
    const url = `${NHTSA_API}/complaints/complaintsByVehicle?make=${encodeURIComponent(
      v.make
    )}&model=${encodeURIComponent(m)}&modelYear=${encodeURIComponent(String(v.year))}`;
    const r = await getJson(url);
    const n = r.ok ? r.body.results.length : null;
    queries.push({ model: m, url, httpStatus: r.status, count: n });
    if (r.ok) for (const row of r.body.results) if (row.odiNumber != null && !byOdi.has(row.odiNumber)) byOdi.set(row.odiNumber, row);
  }
  const comp = new Map();
  let crashes = 0, fires = 0, injuries = 0, deaths = 0;
  for (const c of byOdi.values()) {
    if (c.crash === true) crashes++;
    if (c.fire === true) fires++;
    injuries += Number(c.numberOfInjuries) || 0;
    deaths += Number(c.numberOfDeaths) || 0;
    // "components" joins names with a bare comma ("POWER TRAIN,ENGINE"); some
    // names contain ", " themselves ("SERVICE BRAKES, HYDRAULIC"), so split
    // only on commas NOT followed by a space.
    const parts = String(c.components || "").split(/,(?! )/).map((s) => s.trim()).filter(Boolean);
    for (const p of new Set(parts)) comp.set(p, (comp.get(p) || 0) + 1);
  }
  const topComponents = [...comp.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([component, count]) => ({ component, count }));
  return {
    vehicle: { year: v.year, make: v.make, model: v.model },
    source: `${NHTSA_API}/complaints/complaintsByVehicle`,
    queries,
    count: byOdi.size,
    crashes,
    fires,
    injuries,
    deaths,
    topComponents,
    note:
      "Owner complaints filed with NHTSA for this model year/make/model (deduplicated by ODI number). Complaints are unverified owner reports, not recalls or confirmed defects; one complaint can list several components.",
  };
}

/* ------------------------------------------------------------------ */
/* buyer_check: composes decode_vin + list_recalls + list_complaints   */
/* ------------------------------------------------------------------ */

/** Inspection steps keyed by NHTSA top-level component category. */
const INSPECT_MAP = {
  "POWER TRAIN": ["Test drive cold and hot: watch for harsh/late/flared shifts, slipping, unexpected downshifts or neutral.", "Scan PCM/TCM for stored and pending codes (incl. transmission adaptives if supported).", "Check transmission fluid level/condition where serviceable (burnt smell, dark, debris); look for leaks at pan/cooler lines."],
  "ENGINE": ["Cold start: listen for ticks, knocks, timing-chain rattle; check for smoke at startup and under load.", "Scan for engine codes and misfire counters; check readiness monitors (recently cleared codes?).", "Look for oil/coolant leaks, oil condition, coolant in oil or oil in coolant."],
  "ENGINE AND ENGINE COOLING": ["Cold start and full warm-up: watch temp gauge, listen for abnormal noises.", "Pressure-test cooling system; check for leaks at water pump, hoses, radiator.", "Scan for engine codes; check oil/coolant cross-contamination."],
  "SERVICE BRAKES": ["Measure pad thickness and rotor condition; check brake fluid level/condition.", "Test drive: pulsation, pulling, soft/long pedal, ABS warning light.", "Scan ABS/brake module for codes; inspect lines and hoses for leaks/corrosion."],
  "SERVICE BRAKES, HYDRAULIC": ["Check brake fluid level/condition and for leaks at master cylinder, lines, calipers.", "Test pedal feel (firm vs. sinking) with engine running and off."],
  "ELECTRICAL SYSTEM": ["Battery/charging-system test; scan all modules for codes (not just engine).", "Check every light, gauge, power window/lock, infotainment and charging ports.", "Look for aftermarket wiring, corrosion at grounds/connectors, water intrusion."],
  "AIR BAGS": ["Confirm SRS/airbag light comes on at key-on and then goes out.", "Scan SRS module for codes; ask for proof any airbag recall was completed (check VIN at nhtsa.gov/recalls)."],
  "STEERING": ["Test drive: play, wander, noise when turning lock-to-lock, warning lights for EPS.", "Inspect tie rods, rack boots, power steering fluid/leaks (if hydraulic); scan EPS module."],
  "SUSPENSION": ["Inspect struts/shocks for leaks, bushings, ball joints, control arms; bounce test.", "Test drive over bumps for clunks; check tire wear pattern for alignment issues."],
  "FUEL/PROPULSION SYSTEM": ["Check for fuel odor/leaks at lines, rails, tank; scan for fuel-system and EVAP codes.", "Test drive for hesitation/stalling under load."],
  "FUEL SYSTEM, GASOLINE": ["Check for fuel odor/leaks at lines, rails, tank; scan for fuel-system and EVAP codes.", "Test drive for hesitation/stalling under load."],
  "VEHICLE SPEED CONTROL": ["Test cruise control and throttle response; check for stuck/unintended acceleration complaints on the test drive.", "Scan for throttle/pedal-position codes."],
  "FORWARD COLLISION AVOIDANCE": ["Test drive on open road: watch for false automatic braking / phantom alerts.", "Check camera/radar area for damage or misalignment; scan ADAS module for codes."],
  "LANE DEPARTURE": ["Verify lane-keep/departure warnings function and camera windshield area is undamaged; scan ADAS codes."],
  "BACK OVER PREVENTION": ["Verify backup camera image, guidelines and rear sensors work."],
  "VISIBILITY": ["Check wipers, washers, defrost, mirrors, and backup camera; inspect windshield."],
  "VISIBILITY/WIPER": ["Check wiper operation all speeds, washer spray, wiper linkage."],
  "EXTERIOR LIGHTING": ["Check all exterior lamps: headlights low/high, DRL, brake, turn, reverse; look for moisture in housings."],
  "STRUCTURE": ["Inspect frame/unibody for rust, repairs, cracks, and accident damage; check door/hood/tailgate alignment."],
  "SEAT BELTS": ["Check every belt latches, retracts, and locks on a sharp tug; check belt warning light."],
  "SEATS": ["Check seat adjusters, tracks, latches and seat-mounted airbag/occupant-sensor warnings."],
  "LATCHES/LOCKS/LINKAGES": ["Open/close/lock every door, hood, liftgate/tailgate from inside and out; check child locks."],
  "TIRES": ["Check tread depth, DOT date codes, uneven wear, sidewall damage; confirm TPMS works."],
  "WHEELS": ["Inspect wheels for cracks/bends; check lug nuts/studs."],
  "PARKING BRAKE": ["Test parking brake holds on an incline; check electronic parking brake codes if equipped."],
  "EQUIPMENT": ["Check accessories and equipment listed in the complaints (e.g. trailer hitch, roof racks) for function and damage."],
  "HYBRID PROPULSION SYSTEM": ["Scan hybrid/HV battery system codes and battery health report if available; check for warning lights."],
  "ELECTRONIC STABILITY CONTROL (ESC)": ["Confirm ESC/traction lights go out after start; scan ABS/ESC codes."],
};
const GENERIC_BASELINE = [
  "Run the VIN at nhtsa.gov/recalls (or the OEM site) to confirm open recalls on THIS vehicle.",
  "Get a vehicle history report (title brands, accidents, odometer).",
  "Full-system scan of all modules; check readiness monitors.",
  "Cold-start check and 15+ minute test drive (city and highway).",
  "Lift inspection: leaks, frame/rust, suspension, exhaust, brakes, tires.",
  "Check all fluids, belts, hoses; battery/charging test.",
  "Verify odometer vs. history/service records; confirm title and VIN plates match.",
];

function categoryOf(component) {
  return String(component || "").split(":")[0].trim().toUpperCase();
}

async function buyerCheck(args) {
  const vin = String((args && args.vin) || "").trim().toUpperCase();
  if (!vin) return { errorCode: "client", errorText: "vin is required" };
  const decoded = await decodeVin(vin);
  const vehicleArgs = { vin };
  if (decoded && decoded.make) vehicleArgs.make = decoded.make;
  if (decoded && decoded.model) vehicleArgs.model = decoded.model;
  if (decoded && typeof decoded.year === "number") vehicleArgs.modelYear = decoded.year;
  const [rec, comp] = await Promise.all([listRecalls(vehicleArgs), listComplaints({ ...vehicleArgs, top: 5 })]);
  const out = {
    vin,
    vehicle: {
      year: decoded.year, make: decoded.make, model: decoded.model, trim: decoded.trim,
      bodyClass: decoded.bodyClass, driveType: decoded.driveType, fuelType: decoded.fuelType,
    },
  };
  for (const k of Object.keys(out.vehicle)) if (out.vehicle[k] === undefined) delete out.vehicle[k];
  if (decoded.errorCode && decoded.errorCode !== "0") out.decodeWarning = decoded.errorText;
  if (args.mileage != null && args.mileage !== "") {
    out.mileage = Number(args.mileage);
    out.mileageNote = "Mileage is echoed for context only. No free source here provides a factory maintenance schedule, so nothing is derived from mileage.";
  }
  out.recalls = {
    count: rec.count,
    top: (rec.recalls || []).slice(0, 5).map((r) => ({ campaignNumber: r.campaignNumber, date: r.reportReceivedDateIso || r.reportReceivedDate, component: r.component, summary: r.summary && r.summary.length > 200 ? r.summary.slice(0, 200) + "…" : r.summary })),
    caveat: VIN_CONFIRM_NOTE,
  };
  if (rec.error) out.recalls.error = rec.error;
  out.complaints = { count: comp.count, crashes: comp.crashes, fires: comp.fires, injuries: comp.injuries, deaths: comp.deaths, topComponents: comp.topComponents || [] };
  if (comp.error) out.complaints.error = comp.error;

  // Build inspection list ONLY from this vehicle's complaint + recall components.
  const sources = new Map(); // category -> reasons
  const note = (cat, why) => { if (!sources.has(cat)) sources.set(cat, []); sources.get(cat).push(why); };
  for (const c of out.complaints.topComponents) note(categoryOf(c.component), `${c.count} NHTSA complaints list ${c.component}`);
  for (const r of rec.recalls || []) note(categoryOf(r.component), `recall ${r.campaignNumber} (${r.component})`);
  const whatToInspect = [];
  const unmapped = [];
  for (const [cat, why] of sources) {
    if (INSPECT_MAP[cat]) whatToInspect.push({ area: cat, why, steps: INSPECT_MAP[cat] });
    else unmapped.push({ area: cat, why });
  }
  out.whatToInspect = whatToInspect;
  if (unmapped.length) out.unmappedAreas = { note: "Components seen in this vehicle's NHTSA data with no canned inspection steps; inspect these areas manually.", items: unmapped };
  out.genericBaseline = { label: "GENERIC pre-purchase baseline (applies to any used car; not derived from this vehicle's data)", items: GENERIC_BASELINE };
  out.sources = [VPIC_BASE, rec.source, comp.source].filter(Boolean);
  out.note = "Complaints are unverified owner reports for the model year/make/model, not confirmed defects on this vehicle. " + VIN_CONFIRM_NOTE;
  return out;
}

/* ------------------------------------------------------------------ */
/* fuel_economy: EPA fueleconomy.gov web services (public, no auth)    */
/* ------------------------------------------------------------------ */

const FEG = "https://www.fueleconomy.gov/ws/rest";
const EPA_ASSUMPTIONS = "EPA annual fuel cost is based on 15,000 miles/year, 55% city / 45% highway driving, and the fuel prices FuelEconomy.gov currently uses (fuelPricesUsed, $/gal or $/kWh for electric). youSaveSpend5yr compares 5 years of fuel cost to the EPA average new vehicle; positive = save, negative = spend more.";

async function fegJson(path) {
  const res = await fetch(`${FEG}${path}`, { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`fueleconomy.gov HTTP ${res.status} for ${path}`);
  if (!text.trim() || text.trim() === "null") return null;
  return JSON.parse(text);
}
function menuItems(body) {
  if (!body || body.menuItem == null) return [];
  return Array.isArray(body.menuItem) ? body.menuItem : [body.menuItem];
}
const alnum = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function summarizeEpaVehicle(v) {
  const isEV = v.atvType === "EV" || v.fuelType1 === "Electricity";
  const o = {
    epaId: num(v.id), year: num(v.year), make: v.make, model: v.model, baseModel: v.baseModel,
    vehicleClass: v.VClass, drive: v.drive, transmission: v.trany,
    engine: isEV ? (v.evMotor || undefined) : [v.cylinders && `${v.cylinders} cyl`, v.displ && `${v.displ} L`].filter(Boolean).join(", ") || undefined,
    fuelType: v.fuelType, fuelType1: v.fuelType1, atvType: v.atvType || undefined,
  };
  if (isEV) {
    o.mpge = { city: num(v.city08), highway: num(v.highway08), combined: num(v.comb08) };
    o.kWhPer100mi = num(v.combE);
    o.rangeMiles = num(v.range);
  } else {
    o.mpg = { city: num(v.city08), highway: num(v.highway08), combined: num(v.comb08) };
    if (v.fuelType2) {
      o.fuelType2 = v.fuelType2;
      o.mpgFuel2 = { city: num(v.cityA08), highway: num(v.highwayA08), combined: num(v.combA08) };
      if (num(v.fuelCostA08)) o.annualFuelCostFuel2 = num(v.fuelCostA08);
    }
    if (v.atvType === "Plug-in Hybrid") o.electricRangeMiles = num(v.rangeA) ?? undefined;
  }
  o.annualFuelCostUSD = num(v.fuelCost08);
  const yss = num(v.youSaveSpend);
  if (yss != null) o.youSaveSpend5yrUSD = yss;
  const co2 = num(v.co2TailpipeGpm);
  if (co2 != null && co2 >= 0) o.co2TailpipeGramsPerMile = co2;
  if (num(v.co2) != null && num(v.co2) >= 0) o.co2EpaGramsPerMile = num(v.co2);
  if (num(v.ghgScore) != null && num(v.ghgScore) >= 0) o.ghgScore = num(v.ghgScore);
  if (num(v.feScore) != null && num(v.feScore) >= 0) o.feScore = num(v.feScore);
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === "") delete o[k];
  return o;
}

function decodeConsistency(d, s) {
  // true/false/null: does the EPA record agree with the vPIC decode on what vPIC provided?
  if (!d) return null;
  const checks = [];
  if (d.extras && d.extras.EngineCylinders && s.engine && /cyl/.test(s.engine)) checks.push(s.engine.startsWith(`${d.extras.EngineCylinders} cyl`));
  if (d.extras && d.extras.DisplacementL && s.engine && /L$/.test(s.engine)) {
    const m = /([\d.]+) L$/.exec(s.engine); if (m) checks.push(Math.abs(Number(m[1]) - Number(d.extras.DisplacementL)) < 0.15);
  }
  if (d.driveType && s.drive) {
    const dd = d.driveType.toUpperCase(), ed = s.drive.toUpperCase();
    const k = (x) => (/4WD|4X4|FOUR/.test(x) ? "4" : /AWD|ALL/.test(x) ? "A" : /FWD|FRONT/.test(x) ? "F" : /RWD|REAR/.test(x) ? "R" : null);
    if (k(dd) && k(ed)) checks.push(k(dd) === k(ed) || (/4X2|2WD/.test(dd) && /2-WHEEL|REAR|2WD/.test(ed)));
  }
  if (!checks.length) return null;
  return checks.every(Boolean);
}

async function fuelEconomy(args) {
  args = args || {};
  const fuelPrices = await fegJson("/fuelprices").catch(() => null);
  const base = { source: "https://www.fueleconomy.gov/feg/ws/ (EPA/DOE, public, no auth)", assumptions: EPA_ASSUMPTIONS, fuelPricesUsed: fuelPrices,
    costToOwnNote: "Only EPA fuel-cost figures are reported. Full cost-to-own (depreciation, insurance, maintenance, repairs) is NOT available from this source." };
  if (args.option != null && /^\d+$/.test(String(args.option))) {
    const v = await fegJson(`/vehicle/${args.option}`);
    if (!v) return { ...base, error: `No EPA vehicle with id ${args.option}` };
    return { ...base, selected: summarizeEpaVehicle(v), selectedBy: "explicit EPA vehicle id (option)" };
  }
  let decoded = null, year = args.year != null ? Number(args.year) : null, make = args.make || null, model = args.model || null;
  if (args.vin) {
    decoded = await decodeVin(args.vin);
    if (year == null && typeof decoded.year === "number") year = decoded.year;
    if (!make) make = decoded.make; if (!model) model = decoded.model;
  }
  if (!year || !make || !model) return { ...base, error: "Need vin, or year + make + model.", decodeError: decoded && decoded.errorText };
  const out = { ...base, query: { vin: args.vin, year, make, model } };
  const makes = menuItems(await fegJson(`/vehicle/menu/make?year=${year}`));
  const epaMake = makes.find((m) => alnum(m.value) === alnum(make));
  if (!epaMake) { out.error = `EPA has no make matching "${make}" for ${year}.`; return out; }
  const models = menuItems(await fegJson(`/vehicle/menu/model?year=${year}&make=${encodeURIComponent(epaMake.value)}`));
  const want = alnum(model);
  let matched = models.filter((m) => alnum(m.value) === want);
  if (!matched.length) matched = models.filter((m) => alnum(m.value).startsWith(want));
  if (!matched.length) { out.error = `No EPA model for ${year} ${epaMake.value} matching "${model}".`; out.epaModelsForMake = models.map((m) => m.value); return out; }
  const options = [];
  for (const m of matched) {
    const opts = menuItems(await fegJson(`/vehicle/menu/options?year=${year}&make=${encodeURIComponent(epaMake.value)}&model=${encodeURIComponent(m.value)}`));
    for (const o of opts) options.push({ epaModel: m.value, option: o.text, epaId: Number(o.value) });
  }
  out.epaMake = epaMake.value;
  out.optionCount = options.length;
  const MAX = 12;
  const summaries = [];
  for (const o of options.slice(0, MAX)) {
    const v = await fegJson(`/vehicle/${o.epaId}`);
    if (!v) continue;
    const s = summarizeEpaVehicle(v);
    s.option = o.option;
    const c = decodeConsistency(decoded, s);
    if (c !== null) s.consistentWithVinDecode = c;
    summaries.push(s);
  }
  if (options.length > MAX) out.moreOptionsNotFetched = options.slice(MAX);
  if (summaries.length === 1) {
    out.selected = summaries[0];
    out.selectedBy = "only EPA option for this year/make/model";
  } else {
    out.options = summaries;
    out.selected = null;
    out.note = `EPA lists ${options.length} options for this vehicle and the VIN does not identify which one, so none was picked. Ask which trim/engine/drive it is, then call again with option=<epaId>.` +
      (decoded ? " consistentWithVinDecode compares only engine cylinders/displacement/drive that vPIC decoded; it is a hint, not a match." : "");
  }
  return out;
}

const TOOLS = [
  {
    name: "decode_vin",
    description:
      "Decode a vehicle VIN via the public NHTSA vPIC DecodeVinValues API. Returns a compact VinDecode object (vin, year, make, model, optional trim/body/drive/fuel/plant, errorCode/errorText). Partial VINs allowed; use * for unknown characters. Never invent fields — only what NHTSA returns.",
    inputSchema: {
      type: "object",
      properties: {
        vin: {
          type: "string",
          description:
            "Vehicle Identification Number. Full 17-char preferred; partial VINs allowed; * for unknown chars.",
        },
        modelYear: {
          type: "number",
          description:
            "Optional model year to disambiguate incomplete / partial VINs (query modelyear).",
        },
      },
      required: ["vin"],
      additionalProperties: false,
    },
  },
  {
    name: "list_recalls",
    description:
      "List NHTSA safety recalls for a vehicle's model year/make/model via the public api.nhtsa.gov recallsByVehicle API. Pass a vin (decoded via vPIC to year/make/model) and/or make, model, modelYear (explicit values override the decode). Tries the given model name plus matching NHTSA catalog model names (e.g. F-150 cab variants) and reports every query used. Returns {vehicle, source, queries, count, recalls:[RecallItem], note}. Results are for the year/make/model, NOT confirmed open on the exact VIN — check nhtsa.gov/recalls with the VIN or the dealer to confirm.",
    inputSchema: {
      type: "object",
      properties: {
        vin: { type: "string", description: "Optional VIN; decoded via NHTSA vPIC to get year/make/model." },
        make: { type: "string", description: "Vehicle make, e.g. HONDA. Overrides the decoded make." },
        model: { type: "string", description: "Vehicle model, e.g. Accord, F-150, Model 3. Overrides the decoded model." },
        modelYear: { type: "number", description: "Model year, e.g. 2013. Overrides the decoded year." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_complaints",
    description:
      "Summarize NHTSA owner complaints for a vehicle's model year/make/model via the public api.nhtsa.gov complaintsByVehicle API. Same inputs as list_recalls (vin and/or make/model/modelYear) plus optional top (default 10). Returns {vehicle, source, queries, count, crashes, fires, injuries, deaths, topComponents:[{component,count}], note}. Complaints are unverified owner reports, not recalls.",
    inputSchema: {
      type: "object",
      properties: {
        vin: { type: "string", description: "Optional VIN; decoded via NHTSA vPIC to get year/make/model." },
        make: { type: "string", description: "Vehicle make. Overrides the decoded make." },
        model: { type: "string", description: "Vehicle model. Overrides the decoded model." },
        modelYear: { type: "number", description: "Model year. Overrides the decoded year." },
        top: { type: "number", description: "How many top components to return (default 10)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "buyer_check",
    description:
      "Used-car buyer's check from a VIN: decodes it (NHTSA vPIC), pulls NHTSA recalls and owner-complaint totals for the year/make/model, and builds a what-to-inspect list derived ONLY from that vehicle's top complaint components and recall components, plus a separately labeled GENERIC pre-purchase baseline. Optional mileage is echoed only (no maintenance schedule source). Recalls are year/make/model-level — confirm open recalls with the VIN at nhtsa.gov/recalls.",
    inputSchema: {
      type: "object",
      properties: {
        vin: { type: "string", description: "17-character VIN." },
        mileage: { type: "number", description: "Optional odometer reading; echoed for context only." },
      },
      required: ["vin"],
      additionalProperties: false,
    },
  },
  {
    name: "fuel_economy",
    description:
      "EPA fuel economy from fueleconomy.gov web services (public, no auth): city/highway/combined MPG (MPGe, kWh/100mi and range for EVs), EPA annual fuel cost with EPA's assumptions and current fuel prices, tailpipe CO2, fuel type, and EPA's 5-year you-save/spend-vs-average figure. Input vin, or year+make+model; optional option = EPA vehicle id. When EPA has several trims/engines it lists them all (with figures) and picks none. Does NOT provide full cost-to-own beyond EPA fuel cost.",
    inputSchema: {
      type: "object",
      properties: {
        vin: { type: "string", description: "VIN; decoded via NHTSA vPIC to year/make/model (EPA has no VIN lookup)." },
        year: { type: "number", description: "Model year (overrides decode)." },
        make: { type: "string", description: "Make (overrides decode)." },
        model: { type: "string", description: "Model (overrides decode); prefix-matched against EPA model names, e.g. F-150 -> F150 Pickup 2WD/4WD." },
        option: { type: "string", description: "EPA vehicle id (epaId) from a previous options list; returns that exact vehicle." },
      },
      additionalProperties: false,
    },
  },
];

function send(msg) {
  const line = JSON.stringify(msg);
  process.stdout.write(line + "\n");
}

function okResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function errResult(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: "2.0", id, error });
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    okResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") {
    // notification — no response
    return;
  }
  if (method === "ping") {
    okResult(id, {});
    return;
  }
  if (method === "tools/list") {
    okResult(id, { tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const HANDLERS = {
      decode_vin: (a) => decodeVin(a.vin, a.modelYear),
      list_recalls: (a) => listRecalls(a),
      list_complaints: (a) => listComplaints(a),
      buyer_check: (a) => buyerCheck(a),
      fuel_economy: (a) => fuelEconomy(a),
    };
    if (!HANDLERS[name]) {
      okResult(id, {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      });
      return;
    }
    try {
      const decoded = await HANDLERS[name](args);
      okResult(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(decoded, null, 2),
          },
        ],
        structuredContent: decoded,
      });
    } catch (e) {
      okResult(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              errorCode: "exception",
              errorText: String(e && e.message ? e.message : e),
            }),
          },
        ],
        isError: true,
      });
    }
    return;
  }
  // Unknown method
  if (id !== undefined && id !== null) {
    errResult(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  // Support both Content-Length framed and newline-delimited JSON
  while (true) {
    if (buffer.startsWith("Content-Length:")) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const len = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + len) break;
      const body = buffer.slice(bodyStart, bodyStart + len);
      buffer = buffer.slice(bodyStart + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      Promise.resolve(handleRequest(msg)).catch((e) => {
        if (msg && msg.id != null) {
          errResult(msg.id, -32603, String(e && e.message ? e.message : e));
        }
      });
      continue;
    }
    // newline-delimited JSON fallback
    const nl = buffer.indexOf("\n");
    if (nl === -1) break;
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    Promise.resolve(handleRequest(msg)).catch((e) => {
      if (msg && msg.id != null) {
        errResult(msg.id, -32603, String(e && e.message ? e.message : e));
      }
    });
  }
});

process.stdin.on("end", () => process.exit(0));
