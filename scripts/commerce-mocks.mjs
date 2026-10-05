// ─── COMMERCE MOCKS ──────────────────────────────────────────────────────────
//
// Four small HTTP servers that stand in for the money path's third parties so
// scripts/verify-commerce.mjs can drive the REAL production build of the site
// end to end without a single real key:
//
//   Stripe     POST/GET /v1/checkout/sessions, plus markPaid() to "complete"
//              a session the way Hosted Checkout would.
//   PostgREST  /rest/v1/{orders,order_items,order_events}: exactly the subset
//              of PostgREST that src/lib/commerce/orders.ts and fulfilment.ts
//              use through supabase-js (upsert with on_conflict +
//              ignore-duplicates, return=representation vs minimal, Accept
//              application/vnd.pgrst.object+json → 406 PGRST116 unless one row,
//              eq/in/is filters, order, limit, PATCH by filter — including the
//              fulfilment claim, PATCH ...?id=eq.X&pod_order_id=is.null
//              &pod_provider=is.null with return=representation + select=id,
//              which answers the matched rows as an array, [] when none).
//   Printful   API v1 envelope { code, result, error }: POST /orders (draft),
//              POST /orders/{id}/confirm, GET /orders/{id} and /orders/@{ext}.
//   Printify   /v1/shops/{shop}/orders.json, …/send_to_production.json,
//              GET …/orders/{id}.json.
//
// The two print mocks take control requests that make them misbehave once:
//   POST /__fail/next          next POST /orders answers 500 (nothing stored)
//   POST /__fail/after-store   next POST /orders stores the order, then 500s
//   POST /__429/next           next POST /orders answers 429, Retry-After: 1
//   POST /__confirm/fails      (Printful) POST /orders/{id}/confirm → 400 until
//                              POST /__confirm/ok
//   GET  /__requests           everything recorded (auth headers removed)
//   POST /__reset              forget orders and recorded requests
// The PostgREST mock takes one of its own:
//   POST /__db/fail-next-patch the next PATCH /rest/v1/orders whose body
//                              carries processed_at answers 500 once (the
//                              webhook's final "done" update), so the harness
//                              can prove a redelivery resumes the order
//
// Node only (node:http); binds 127.0.0.1. Nothing here is ever reached from
// a deployment: the app only talks to these when STRIPE_API_BASE,
// NEXT_PUBLIC_SUPABASE_URL, PRINTFUL_API_URL or PRINTIFY_API_URL point at them.

import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const DEFAULTS = {
  stripeKey: "sk_test_mockkey",
  supabaseKey: "mock-service-role",
  printful: { token: "mock-token", storeId: "1001" },
  printify: { token: "mock", shopId: "777" },
};

// ─── plumbing ────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body, headers = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, { "Content-Length": 0, ...headers });
  res.end();
}

/** Stripe's application/x-www-form-urlencoded with bracket keys → nested object/arrays. */
export function parseForm(text) {
  const out = {};
  for (const [key, value] of new URLSearchParams(text)) {
    const path = key.replace(/\]/g, "").split("[");
    let node = out;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i];
      if (i === path.length - 1) {
        node[seg] = value;
        break;
      }
      if (node[seg] === undefined || typeof node[seg] !== "object") {
        node[seg] = /^\d+$/.test(path[i + 1]) ? [] : {};
      }
      node = node[seg];
    }
  }
  return out;
}

function parseBody(contentType, text) {
  if (!text) return null;
  if (/application\/x-www-form-urlencoded/i.test(contentType ?? "")) return parseForm(text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** A recorded request: headers without credentials, plus whether the credentials were right. */
function recordRequest(list, req, url, body, authOk) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (k === "authorization" || k === "apikey") continue;
    headers[k] = v;
  }
  const entry = {
    at: new Date().toISOString(),
    method: req.method,
    path: decodeURIComponent(url.pathname),
    query: Object.fromEntries(url.searchParams),
    headers,
    auth: { present: Boolean(req.headers.authorization || req.headers.apikey), ok: authOk },
    body,
  };
  list.push(entry);
  return entry;
}

function bearerOk(req, token) {
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${token}`;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

// ─── Stripe ──────────────────────────────────────────────────────────────────

function stripeError(res, status, message, extra = {}) {
  sendJson(res, status, { error: { type: "invalid_request_error", message, ...extra } });
}

function createStripeMock(state, requests, key) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://stripe.mock");
    const text = await readBody(req);
    const body = parseBody(req.headers["content-type"], text);
    const authOk = bearerOk(req, key);
    recordRequest(requests, req, url, body, authOk);

    if (url.pathname.startsWith("/pay/")) {
      const id = url.pathname.slice("/pay/".length);
      const session = state.sessions.get(id);
      res.writeHead(session ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        session
          ? `<!doctype html><title>Mock Stripe Checkout</title><h1>Mock Checkout ${id}</h1><p>payment_status: ${session.payment_status}</p>`
          : "<!doctype html><title>Not found</title>",
      );
      return;
    }
    if (!url.pathname.startsWith("/v1/")) {
      stripeError(res, 404, `Unrecognized request URL (${req.method}: ${url.pathname}).`);
      return;
    }
    if (!authOk) {
      stripeError(res, 401, "Invalid API Key provided", { type: "invalid_request_error" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const lineItems = Array.isArray(body?.line_items) ? body.line_items : [];
      const subtotal = lineItems.reduce(
        (sum, li) => sum + Number(li?.price_data?.unit_amount ?? 0) * Number(li?.quantity ?? 1),
        0,
      );
      const shippingAmount = Number(body?.shipping_options?.[0]?.shipping_rate_data?.fixed_amount?.amount ?? 0);
      state.counter += 1;
      const id = state.longIds ? `cs_test_${randomBytes(29).toString("hex").slice(0, 58)}` : `cs_test_${state.counter}`;
      const session = {
        id,
        object: "checkout.session",
        url: `${state.baseUrl}/pay/${id}`,
        payment_status: "unpaid",
        status: "open",
        livemode: false,
        mode: body?.mode ?? "payment",
        submit_type: body?.submit_type ?? null,
        locale: body?.locale ?? null,
        currency: (lineItems[0]?.price_data?.currency ?? "gbp").toLowerCase(),
        amount_subtotal: subtotal,
        amount_total: subtotal + shippingAmount,
        metadata: body?.metadata ?? {},
        client_reference_id: body?.client_reference_id ?? null,
        customer_details: null,
        customer_email: null,
        collected_information: null,
        payment_intent: null,
        shipping_cost: shippingAmount
          ? { amount_subtotal: shippingAmount, amount_tax: 0, amount_total: shippingAmount, shipping_rate: null }
          : null,
        success_url: body?.success_url ?? null,
        cancel_url: body?.cancel_url ?? null,
        created: Math.floor(Date.now() / 1000),
      };
      state.sessions.set(id, session);
      sendJson(res, 200, session, { "request-id": `req_mock_${state.counter}` });
      return;
    }

    const m = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && m) {
      const session = state.sessions.get(decodeURIComponent(m[1]));
      if (!session) {
        stripeError(res, 404, `No such checkout.session: '${m[1]}'`, { code: "resource_missing", param: "id" });
        return;
      }
      sendJson(res, 200, session);
      return;
    }
    stripeError(res, 404, `Unrecognized request URL (${req.method}: ${url.pathname}).`);
  });
}

/** What Hosted Checkout does when the customer pays: contact + shipping details, a PaymentIntent. */
function markPaid(state, id, details = {}) {
  const session = state.sessions.get(id);
  if (!session) throw new Error(`mock Stripe: no session ${id}`);
  const address = details.address ?? {};
  state.counter += 1;
  session.payment_status = "paid";
  session.status = "complete";
  session.payment_intent = `pi_test_${state.counter}`;
  session.customer_details = {
    email: details.email ?? null,
    name: details.name ?? null,
    phone: details.phone ?? null,
    address: null,
    tax_exempt: "none",
    tax_ids: [],
  };
  session.collected_information = {
    shipping_details: {
      name: details.name ?? null,
      address: {
        line1: address.line1 ?? null,
        line2: address.line2 ?? null,
        city: address.city ?? null,
        state: address.state ?? null,
        postal_code: address.postal_code ?? null,
        country: address.country ?? null,
      },
    },
  };
  return session;
}

// ─── PostgREST ───────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

const SCHEMA = {
  orders: {
    columns: [
      "id",
      "stripe_session_id",
      "stripe_payment_intent",
      "kind",
      "status",
      "email",
      "name",
      "phone",
      "address",
      "amount_pence",
      "currency",
      "pod_provider",
      "pod_order_id",
      "tracking",
      "processed_at",
      "created_at",
      "updated_at",
    ],
    required: ["stripe_session_id", "kind", "amount_pence"],
    unique: ["stripe_session_id"],
    defaults: () => ({
      id: randomUUID(),
      stripe_payment_intent: null,
      status: "paid",
      email: null,
      name: null,
      phone: null,
      address: null,
      currency: "gbp",
      pod_provider: null,
      pod_order_id: null,
      tracking: null,
      processed_at: null,
      created_at: now(),
      updated_at: now(),
    }),
    onUpdate: (row) => {
      row.updated_at = now();
    },
  },
  order_items: {
    columns: ["id", "order_id", "product_id", "variant_id", "quantity", "unit_pence"],
    required: ["order_id", "product_id", "variant_id", "quantity", "unit_pence"],
    unique: [],
    identity: "id",
    defaults: () => ({}),
  },
  order_events: {
    columns: ["id", "order_id", "type", "payload", "created_at"],
    required: ["type"],
    unique: [],
    identity: "id",
    defaults: () => ({ order_id: null, payload: {}, created_at: now() }),
  },
};

const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function pgError(res, status, code, message, details = null, hint = null) {
  sendJson(res, status, { code, details, hint, message });
}

function prefers(req) {
  return String(req.headers.prefer ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function wantsObject(req) {
  return String(req.headers.accept ?? "").includes("application/vnd.pgrst.object+json");
}

function matches(row, filters) {
  for (const { column, op, value } of filters) {
    const actual = row[column];
    switch (op) {
      case "eq":
        if (String(actual) !== value) return false;
        break;
      case "neq":
        if (String(actual) === value) return false;
        break;
      case "in": {
        const list = value
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((v) => v.trim().replace(/^"|"$/g, ""));
        if (!list.includes(String(actual))) return false;
        break;
      }
      case "is":
        if (value === "null" ? actual !== null && actual !== undefined : String(actual) !== value) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

function parseFilters(url) {
  const filters = [];
  for (const [key, raw] of url.searchParams) {
    if (RESERVED_PARAMS.has(key)) continue;
    const dot = raw.indexOf(".");
    if (dot === -1) continue;
    filters.push({ column: key, op: raw.slice(0, dot), value: raw.slice(dot + 1) });
  }
  return filters;
}

function sortRows(rows, orderParam) {
  if (!orderParam) return rows;
  const terms = orderParam.split(",").map((t) => {
    const [column, dir] = t.split(".");
    return { column, desc: dir === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const { column, desc } of terms) {
      const x = a[column];
      const y = b[column];
      if (x === y) continue;
      if (x === null || x === undefined) return desc ? -1 : 1;
      if (y === null || y === undefined) return desc ? 1 : -1;
      const cmp = x < y ? -1 : 1;
      return desc ? -cmp : cmp;
    }
    return 0;
  });
}

function project(rows, select) {
  if (!select || select === "*") return rows.map((r) => ({ ...r }));
  const cols = select.split(",").map((c) => c.trim());
  if (cols.includes("*")) return rows.map((r) => ({ ...r }));
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
}

/** 200 + array, or the single object / 406 PGRST116 when the client asked for an object. */
function respondRows(req, res, rows, status = 200) {
  if (wantsObject(req)) {
    if (rows.length !== 1) {
      pgError(
        res,
        406,
        "PGRST116",
        "JSON object requested, multiple (or no) rows returned",
        `Results contain ${rows.length} rows, application/vnd.pgrst.object+json requires 1 row`,
      );
      return;
    }
    sendJson(res, status, rows[0]);
    return;
  }
  sendJson(res, status, rows, { "Content-Range": `0-${Math.max(0, rows.length - 1)}/*` });
}

function createPostgrestMock(state, requests, key) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://supabase.mock");
    const text = await readBody(req);
    const body = parseBody(req.headers["content-type"], text);
    const authOk = req.headers.apikey === key && req.headers.authorization === `Bearer ${key}`;
    recordRequest(requests, req, url, body, authOk);

    if (url.pathname.startsWith("/__")) {
      if (req.method === "POST" && url.pathname === "/__db/fail-next-patch") state.flags.failNextProcessedPatch = true;
      else if (req.method === "POST" && url.pathname === "/__reset") state.flags.failNextProcessedPatch = false;
      else {
        sendJson(res, 404, { error: `unknown control endpoint ${req.method} ${url.pathname}` });
        return;
      }
      sendJson(res, 200, { ok: true, flags: { ...state.flags } });
      return;
    }

    if (!authOk) {
      sendJson(res, 401, { message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." });
      return;
    }
    const m = /^\/rest\/v1\/([A-Za-z_]+)$/.exec(url.pathname);
    if (!m) {
      pgError(res, 404, "PGRST125", `Could not find route ${req.method} ${url.pathname}`);
      return;
    }
    const table = m[1];
    const schema = SCHEMA[table];
    const rows = state.tables[table];
    if (!schema || !rows) {
      pgError(res, 404, "PGRST205", `Could not find the table 'public.${table}' in the schema cache`);
      return;
    }
    const filters = parseFilters(url);
    const prefer = prefers(req);
    const representation = prefer.includes("return=representation");

    if (req.method === "GET" || req.method === "HEAD") {
      let out = rows.filter((r) => matches(r, filters));
      out = sortRows(out, url.searchParams.get("order"));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = url.searchParams.get("limit");
      out = out.slice(offset, limit ? offset + Number(limit) : undefined);
      respondRows(req, res, project(out, url.searchParams.get("select")));
      return;
    }

    if (req.method === "POST") {
      const incoming = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : null;
      if (!incoming) {
        pgError(res, 400, "PGRST102", "Empty or invalid json");
        return;
      }
      const onConflict = url.searchParams.get("on_conflict");
      const resolution = prefer.find((p) => p.startsWith("resolution="))?.slice("resolution=".length);
      const inserted = [];
      for (const values of incoming) {
        for (const col of Object.keys(values)) {
          if (!schema.columns.includes(col)) {
            pgError(res, 400, "PGRST204", `Could not find the '${col}' column of '${table}' in the schema cache`);
            return;
          }
        }
        const row = { ...schema.defaults(), ...values };
        if (schema.identity) row[schema.identity] = (state.identity[table] = (state.identity[table] ?? 0) + 1);
        for (const col of schema.required) {
          if (row[col] === undefined || row[col] === null) {
            pgError(res, 400, "23502", `null value in column "${col}" of relation "${table}" violates not-null constraint`);
            return;
          }
        }
        let conflict = null;
        for (const col of schema.unique) {
          const existing = rows.find((r) => r[col] === row[col]);
          if (existing) conflict = { col, existing };
        }
        if (conflict) {
          if (onConflict === conflict.col && resolution === "ignore-duplicates") continue;
          if (onConflict === conflict.col && resolution === "merge-duplicates") {
            Object.assign(conflict.existing, values);
            schema.onUpdate?.(conflict.existing);
            inserted.push(conflict.existing);
            continue;
          }
          pgError(
            res,
            409,
            "23505",
            `duplicate key value violates unique constraint "${table}_${conflict.col}_key"`,
            `Key (${conflict.col})=(${row[conflict.col]}) already exists.`,
          );
          return;
        }
        for (const col of schema.columns) if (row[col] === undefined) row[col] = null;
        rows.push(row);
        inserted.push(row);
      }
      if (representation) {
        respondRows(req, res, project(inserted, url.searchParams.get("select")), 201);
        return;
      }
      sendEmpty(res, 201);
      return;
    }

    if (req.method === "PATCH") {
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        pgError(res, 400, "PGRST102", "Empty or invalid json");
        return;
      }
      for (const col of Object.keys(body)) {
        if (!schema.columns.includes(col)) {
          pgError(res, 400, "PGRST204", `Could not find the '${col}' column of '${table}' in the schema cache`);
          return;
        }
      }
      if (state.flags.failNextProcessedPatch && table === "orders" && Object.hasOwn(body, "processed_at")) {
        state.flags.failNextProcessedPatch = false;
        pgError(res, 500, "XX000", "mock: failing this PATCH on purpose (processed_at)");
        return;
      }
      const updated = [];
      for (const row of rows) {
        if (!matches(row, filters)) continue;
        Object.assign(row, body);
        schema.onUpdate?.(row);
        updated.push(row);
      }
      if (representation) {
        respondRows(req, res, project(updated, url.searchParams.get("select")));
        return;
      }
      sendEmpty(res, 204);
      return;
    }

    pgError(res, 405, "PGRST105", `Method ${req.method} is not allowed here`);
  });
}

// ─── Printful ────────────────────────────────────────────────────────────────

function pfError(res, status, reason, message) {
  sendJson(res, status, { code: status, result: message, error: { reason, message } });
}

/** Control endpoints shared by the two print mocks. Returns true when handled. */
function controlEndpoint(req, res, url, flags, requests, resetFn) {
  if (!url.pathname.startsWith("/__")) return false;
  if (req.method === "POST" && url.pathname === "/__fail/next") flags.failNext = true;
  else if (req.method === "POST" && url.pathname === "/__fail/after-store") flags.failAfterStore = true;
  else if (req.method === "POST" && url.pathname === "/__429/next") flags.rateLimitNext = true;
  else if (req.method === "POST" && url.pathname === "/__confirm/fails") flags.confirmFails = true;
  else if (req.method === "POST" && url.pathname === "/__confirm/ok") flags.confirmFails = false;
  else if (req.method === "POST" && url.pathname === "/__reset") resetFn();
  else if (req.method === "GET" && url.pathname === "/__requests") {
    sendJson(res, 200, requests);
    return true;
  } else {
    sendJson(res, 404, { error: `unknown control endpoint ${req.method} ${url.pathname}` });
    return true;
  }
  sendJson(res, 200, { ok: true, flags: { ...flags } });
  return true;
}

/** The once-only misbehaviours for a POST that creates an order. Returns true when it answered. */
function misbehave(flags, res, store) {
  if (flags.rateLimitNext) {
    flags.rateLimitNext = false;
    sendJson(res, 429, { code: 429, result: "Too Many Requests", error: { reason: "TooManyRequests", message: "Rate limit exceeded" } }, { "Retry-After": "1" });
    return true;
  }
  if (flags.failNext) {
    flags.failNext = false;
    sendJson(res, 500, { code: 500, result: "Internal Server Error", error: { reason: "InternalServerError", message: "mock: failing this request on purpose" } });
    return true;
  }
  if (flags.failAfterStore) {
    flags.failAfterStore = false;
    store();
    sendJson(res, 500, { code: 500, result: "Internal Server Error", error: { reason: "InternalServerError", message: "mock: stored the order, then failed on purpose" } });
    return true;
  }
  return false;
}

function createPrintfulMock(state, requests, cfg) {
  const reset = () => {
    state.orders.clear();
    state.flags.failNext = state.flags.failAfterStore = state.flags.rateLimitNext = state.flags.confirmFails = false;
    requests.length = 0;
  };
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://printful.mock");
    const text = await readBody(req);
    const body = parseBody(req.headers["content-type"], text);
    const authOk = bearerOk(req, cfg.token);
    recordRequest(requests, req, url, body, authOk);
    if (controlEndpoint(req, res, url, state.flags, requests, reset)) return;

    if (!authOk) {
      pfError(res, 401, "Unauthorized", "Unauthorized");
      return;
    }
    const storeHeader = req.headers["x-pf-store-id"];
    if (String(storeHeader ?? "") !== String(cfg.storeId)) {
      pfError(res, 400, "BadRequest", storeHeader ? `Store ${storeHeader} does not belong to this token` : "Missing X-PF-Store-Id header");
      return;
    }

    const findByExternal = (ext) => [...state.orders.values()].find((o) => o.external_id === ext) ?? null;
    const lookup = (segment) => (segment.startsWith("@") ? findByExternal(segment.slice(1)) : state.orders.get(Number(segment)) ?? null);

    if (req.method === "POST" && url.pathname === "/orders") {
      if (!body || typeof body !== "object") {
        pfError(res, 400, "BadRequest", "Invalid JSON body");
        return;
      }
      if (!Array.isArray(body.items) || !body.items.length) {
        pfError(res, 400, "BadRequest", "Order must contain at least one item");
        return;
      }
      if (body.external_id && !/^[A-Za-z0-9_-]{1,32}$/.test(body.external_id)) {
        pfError(res, 400, "BadRequest", "External ID is too long or contains invalid characters");
        return;
      }
      if (body.external_id && findByExternal(body.external_id)) {
        pfError(res, 400, "BadRequest", "An order with this external id already exists");
        return;
      }
      const store = () => {
        state.counter += 1;
        const order = {
          id: state.counter,
          external_id: body.external_id ?? null,
          store: Number(cfg.storeId),
          status: "draft",
          shipping: body.shipping ?? "STANDARD",
          created: Math.floor(Date.now() / 1000),
          updated: Math.floor(Date.now() / 1000),
          recipient: body.recipient ?? null,
          items: body.items.map((item, i) => ({ id: state.counter * 100 + i, ...item })),
          shipments: [],
        };
        state.orders.set(order.id, order);
        return order;
      };
      if (misbehave(state.flags, res, store)) return;
      sendJson(res, 200, { code: 200, result: store() });
      return;
    }

    const confirm = /^\/orders\/([^/]+)\/confirm$/.exec(url.pathname);
    if (req.method === "POST" && confirm) {
      const order = lookup(decodeURIComponent(confirm[1]));
      if (!order) {
        pfError(res, 404, "NotFound", "Order not found");
        return;
      }
      if (state.flags.confirmFails) {
        pfError(res, 400, "BadRequest", "Please add a billing method to your account before confirming orders");
        return;
      }
      order.status = "pending";
      order.updated = Math.floor(Date.now() / 1000);
      sendJson(res, 200, { code: 200, result: order });
      return;
    }

    const one = /^\/orders\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && one) {
      const order = lookup(decodeURIComponent(one[1]));
      if (!order) {
        pfError(res, 404, "NotFound", "Order not found");
        return;
      }
      sendJson(res, 200, { code: 200, result: order });
      return;
    }
    if (req.method === "GET" && url.pathname === "/orders") {
      sendJson(res, 200, { code: 200, result: [...state.orders.values()], paging: { total: state.orders.size, offset: 0, limit: 100 } });
      return;
    }
    pfError(res, 404, "NotFound", `Unknown endpoint ${req.method} ${url.pathname}`);
  });
}

// ─── Printify ────────────────────────────────────────────────────────────────

function createPrintifyMock(state, requests, cfg) {
  const reset = () => {
    state.orders.clear();
    state.flags.failNext = state.flags.failAfterStore = state.flags.rateLimitNext = false;
    requests.length = 0;
  };
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://printify.mock");
    const text = await readBody(req);
    const body = parseBody(req.headers["content-type"], text);
    const authOk = bearerOk(req, cfg.token);
    recordRequest(requests, req, url, body, authOk);
    if (controlEndpoint(req, res, url, state.flags, requests, reset)) return;

    if (!authOk) {
      sendJson(res, 401, { message: "Unauthenticated." });
      return;
    }
    // PRINTIFY_API_URL replaces the whole "https://api.printify.com/v1" base,
    // so the harness points it at <mock>/v1; accept bare paths too.
    const path = url.pathname.replace(/^\/v1(?=\/)/, "");
    const shopMatch = /^\/shops\/([^/]+)(\/.*)$/.exec(path);
    if (!shopMatch) {
      sendJson(res, 404, { message: "Not found" });
      return;
    }
    if (decodeURIComponent(shopMatch[1]) !== String(cfg.shopId)) {
      sendJson(res, 403, { message: "This action is unauthorized." });
      return;
    }
    const rest = shopMatch[2];

    if (req.method === "POST" && rest === "/orders.json") {
      if (!body || typeof body !== "object" || !Array.isArray(body.line_items) || !body.line_items.length) {
        sendJson(res, 422, { message: "The given data was invalid.", errors: { line_items: ["The line items field is required."] } });
        return;
      }
      const store = () => {
        const order = {
          id: randomBytes(12).toString("hex"),
          external_id: body.external_id ?? null,
          label: body.label ?? null,
          status: "pending",
          shipping_method: body.shipping_method ?? 1,
          send_shipping_notification: Boolean(body.send_shipping_notification),
          address_to: body.address_to ?? null,
          line_items: body.line_items.map((li) => ({ ...li, status: "pending" })),
          shipments: [],
          created_at: now(),
        };
        state.orders.set(order.id, order);
        return order;
      };
      if (misbehave(state.flags, res, store)) return;
      sendJson(res, 200, { id: store().id });
      return;
    }

    const send = /^\/orders\/([^/]+)\/send_to_production\.json$/.exec(rest);
    if (req.method === "POST" && send) {
      const order = state.orders.get(decodeURIComponent(send[1]));
      if (!order) {
        sendJson(res, 404, { message: "Order not found" });
        return;
      }
      order.status = "sending-to-production";
      sendJson(res, 200, { ...order });
      return;
    }

    const one = /^\/orders\/([^/]+)\.json$/.exec(rest);
    if (req.method === "GET" && one) {
      const order = state.orders.get(decodeURIComponent(one[1]));
      if (!order) {
        sendJson(res, 404, { message: "Order not found" });
        return;
      }
      sendJson(res, 200, order);
      return;
    }
    if (req.method === "GET" && rest === "/orders.json") {
      sendJson(res, 200, { current_page: 1, data: [...state.orders.values()] });
      return;
    }
    sendJson(res, 404, { message: "Not found" });
  });
}

// ─── entry ───────────────────────────────────────────────────────────────────

/**
 * Start all four mocks. Ports default to 3291–3294; pass 0 for an ephemeral
 * port. Returns { urls, ports, state, requests, markPaid, reset, stop }.
 */
export async function startMocks(options = {}) {
  const cfg = {
    stripeKey: options.stripeKey ?? DEFAULTS.stripeKey,
    supabaseKey: options.supabaseKey ?? DEFAULTS.supabaseKey,
    printful: { ...DEFAULTS.printful, ...(options.printful ?? {}) },
    printify: { ...DEFAULTS.printify, ...(options.printify ?? {}) },
  };
  const requests = { stripe: [], supabase: [], printful: [], printify: [] };
  const state = {
    stripe: { sessions: new Map(), counter: 0, longIds: false, baseUrl: "" },
    supabase: { tables: { orders: [], order_items: [], order_events: [] }, identity: {}, flags: { failNextProcessedPatch: false } },
    printful: { orders: new Map(), counter: 11000, flags: { failNext: false, failAfterStore: false, rateLimitNext: false, confirmFails: false } },
    printify: { orders: new Map(), flags: { failNext: false, failAfterStore: false, rateLimitNext: false } },
  };
  // What assertions read: state.tables.orders / order_items / order_events.
  state.tables = state.supabase.tables;

  const servers = {
    stripe: createStripeMock(state.stripe, requests.stripe, cfg.stripeKey),
    supabase: createPostgrestMock(state.supabase, requests.supabase, cfg.supabaseKey),
    printful: createPrintfulMock(state.printful, requests.printful, cfg.printful),
    printify: createPrintifyMock(state.printify, requests.printify, cfg.printify),
  };
  const ports = {
    stripe: await listen(servers.stripe, options.stripePort ?? 3291),
    supabase: await listen(servers.supabase, options.supabasePort ?? 3292),
    printful: await listen(servers.printful, options.printfulPort ?? 3293),
    printify: await listen(servers.printify, options.printifyPort ?? 3294),
  };
  const urls = Object.fromEntries(Object.entries(ports).map(([k, p]) => [k, `http://127.0.0.1:${p}`]));
  state.stripe.baseUrl = urls.stripe;

  return {
    urls,
    ports,
    cfg,
    state,
    requests,
    markPaid: (id, details) => markPaid(state.stripe, id, details),
    /** Forget every session, row, order and recorded request (ports stay up). */
    reset() {
      state.stripe.sessions.clear();
      state.stripe.longIds = false;
      state.supabase.tables.orders.length = 0;
      state.supabase.tables.order_items.length = 0;
      state.supabase.tables.order_events.length = 0;
      state.supabase.identity = {};
      state.printful.orders.clear();
      state.printify.orders.clear();
      for (const flags of [state.supabase.flags, state.printful.flags, state.printify.flags]) for (const k of Object.keys(flags)) flags[k] = false;
      for (const list of Object.values(requests)) list.length = 0;
    },
    async stop() {
      await Promise.all(Object.values(servers).map(closeServer));
    },
  };
}
