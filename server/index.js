#!/usr/bin/env node
/**
 * Zero-dependency stdio MCP server for NHTSA vPIC VIN decode + NHTSA recalls/complaints.
 * Node 18+ (uses global fetch). Hand-rolled JSON-RPC over stdin/stdout.
 */
"use strict";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "nhtsa-vpic-vin", version: "0.2.0" };
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
