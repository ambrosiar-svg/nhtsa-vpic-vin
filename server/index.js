#!/usr/bin/env node
/**
 * Zero-dependency stdio MCP server for NHTSA vPIC VIN decode.
 * Node 18+ (uses global fetch). Hand-rolled JSON-RPC over stdin/stdout.
 */
"use strict";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "nhtsa-vpic-vin", version: "0.1.0" };
const VPIC_BASE =
  "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";

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
    if (name !== "decode_vin") {
      okResult(id, {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      });
      return;
    }
    try {
      const decoded = await decodeVin(args.vin, args.modelYear);
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
