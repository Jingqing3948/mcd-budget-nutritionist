import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildRecommendations, parseCoupons, parseMenu, parseNutrition, parseStores, unwrapMcpPayload } from "./recommendation.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
  const envPath = path.join(ROOT, "..", ".env");
  try {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {
    // .env is optional; callers may provide normal process environment variables.
  }
}

loadLocalEnv();
const PORT = Number(process.env.PORT || 8787);
const MCP_URL = process.env.MCD_MCP_URL || "https://mcp.mcd.cn";
const TOKEN = process.env.MCD_MCP_TOKEN || "";
const REQUEST_TIMEOUT_MS = 25_000;

function parseStreamableHttp(text, contentType) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return {};
  try { return JSON.parse(trimmed); } catch { /* Streamable HTTP may return SSE */ }
  const messages = [];
  let eventData = [];
  const flush = () => {
    if (!eventData.length) return;
    const candidate = eventData.join("\n").trim();
    eventData = [];
    try { messages.push(JSON.parse(candidate)); } catch { /* ignore keep-alive or explanatory SSE events */ }
  };
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith("data:")) eventData.push(line.slice(5).trimStart());
    else if (line === "" || line.startsWith("event:")) flush();
  }
  flush();
  if (messages.length) return messages[messages.length - 1];
  throw new Error(`MCP 返回格式无法解析（${contentType || "unknown"}）`);
}

class McdMcpClient {
  constructor(url, token) { this.url = url; this.token = token; this.requestId = 0; }
  get configured() { return Boolean(this.token && this.token !== "YOUR_MCP_TOKEN"); }

  async call(name, args = {}) {
    if (!this.configured) throw new Error("MCD_MCP_TOKEN 未配置");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++this.requestId,
          method: "tools/call",
          params: { name, arguments: args }
        }),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`MCP ${name} HTTP ${response.status}`);
      const payload = parseStreamableHttp(text, response.headers.get("content-type"));
      if (payload?.error) throw new Error(`MCP ${name} 调用失败`);
      if (payload?.result?.isError || payload?.isError) throw new Error(`MCP ${name} 返回业务错误`);
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`MCP ${name} 请求超时`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

const mcp = new McdMcpClient(MCP_URL, TOKEN);

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function bodyOf(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { throw new Error("请求体不是有效 JSON"); }
}

function normaliseStoreQuery(input) {
  return {
    searchType: 2,
    city: String(input.city || "北京市"),
    keyword: String(input.keyword || "望京"),
    beType: 1
  };
}

function normaliseCalculateInput(input) {
  const items = Array.isArray(input.items) ? input.items.map(item => ({
    productCode: String(item.productCode || item.code || ""),
    quantity: Math.max(1, Number(item.quantity) || 1)
  })).filter(item => item.productCode) : [];
  if (!input.storeCode || !items.length) throw new Error("价格校验需要门店编码和至少一个实时餐品 productCode");
  return {
    ...input,
    storeCode: String(input.storeCode),
    orderType: Number(input.orderType || 1),
    beType: Number(input.beType || 1),
    items,
    needTableware: Boolean(input.needTableware)
  };
}

async function recommend(input) {
  const nutritionTask = mcp.configured ? mcp.call("list-nutrition-foods", {}) : Promise.reject(new Error("not configured"));
  const couponTask = mcp.configured ? mcp.call("available-coupons", {}) : Promise.reject(new Error("not configured"));
  const [nutritionResult, couponResult] = await Promise.allSettled([nutritionTask, couponTask]);
  const nutritionRows = nutritionResult.status === "fulfilled" ? parseNutrition(nutritionResult.value) : [];
  const coupons = couponResult.status === "fulfilled" ? parseCoupons(couponResult.value) : [];

  let stores = [];
  let menuItems = [];
  let storeCoupons = [];
  let store = null;
  const attemptedTools = ["list-nutrition-foods", "available-coupons"];
  const queryLocation = input.city || input.keyword;
  if (queryLocation && mcp.configured) {
    attemptedTools.push("query-nearby-stores");
    try {
      const storeResult = await mcp.call("query-nearby-stores", normaliseStoreQuery(input));
      stores = parseStores(storeResult);
      store = stores.find(item => item.businessStatus !== false && item.storeCode) || stores.find(item => item.storeCode) || null;
      if (store) {
        const [menuResult, couponResult] = await Promise.allSettled([
          mcp.call("query-meals", { storeCode: store.storeCode, orderType: 1, beType: 1 }),
          mcp.call("query-store-coupons", { storeCode: store.storeCode, orderType: 1, beType: 1 })
        ]);
        attemptedTools.push("query-meals", "query-store-coupons");
        if (menuResult.status === "fulfilled") menuItems = parseMenu(menuResult.value);
        if (couponResult.status === "fulfilled") storeCoupons = parseCoupons(couponResult.value);
      }
    } catch {
      // A location or upstream failure must never prevent demo recommendations.
      store = null;
      stores = [];
      menuItems = [];
    }
  }

  const live = Boolean(store?.storeCode && menuItems.length);
  const result = buildRecommendations({
    ...input,
    menuItems,
    nutritionRows,
    live,
    store,
    coupons: [...coupons, ...storeCoupons]
  });
  return {
    ...result,
    telemetry: {
      tools: attemptedTools,
      storeCount: stores.length,
      menuCount: menuItems.length,
      nutritionCount: nutritionRows.length,
      mode: live ? "live" : "demo"
    }
  };
}

async function staticFile(res, fileName, contentType) {
  const content = await readFile(path.join(ROOT, "public", fileName), "utf8");
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, mcpConfigured: mcp.configured, endpoint: MCP_URL });
    }
    if (req.method === "POST" && url.pathname === "/api/recommend") {
      return json(res, 200, await recommend(await bodyOf(req)));
    }
    if (req.method === "POST" && url.pathname === "/api/calculate") {
      const input = normaliseCalculateInput(await bodyOf(req));
      const result = await mcp.call("calculate-price", input);
      return json(res, 200, { ok: true, result: unwrapMcpPayload(result) });
    }
    if (req.method === "GET" && url.pathname === "/api/nutrition") {
      return json(res, 200, { data: parseNutrition(await mcp.call("list-nutrition-foods", {})) });
    }
    if (req.method === "GET" && url.pathname === "/api/coupons") {
      return json(res, 200, { data: parseCoupons(await mcp.call("available-coupons", {})) });
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return staticFile(res, "index.html", "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/app.js") return staticFile(res, "app.js", "text/javascript; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/styles.css") return staticFile(res, "styles.css", "text/css; charset=utf-8");
    return json(res, 404, { error: "Not Found" });
  } catch (error) {
    return json(res, 502, { error: error.message, hint: "请检查 MCD_MCP_TOKEN、网络和 MCP 服务状态。推荐接口在 MCP 不可用时会自动展示演示数据。" });
  }
}

http.createServer(route).listen(PORT, () => {
  console.log(`麦麦预算营养师 running at http://localhost:${PORT} (${mcp.configured ? "MCP live" : "demo mode"})`);
});
