const DEMO_ITEMS = [
  { code: "demo-1", name: "原味板烧鸡腿堡", price: 22, kcal: 246, protein: 15, fat: 9, carbs: 25, sodium: 611, category: "主食" },
  { code: "demo-2", name: "薯条（小）", price: 12, kcal: 213, protein: 12, fat: 12, carbs: 13, sodium: 422, category: "小食" },
  { code: "demo-3", name: "小玉米杯", price: 7, kcal: 53, protein: 2, fat: 1, carbs: 7, sodium: 1, category: "小食" },
  { code: "demo-4", name: "零度可口可乐小杯", price: 6, kcal: 0, protein: 0, fat: 0, carbs: 1, sodium: 35, category: "饮品" },
  { code: "demo-5", name: "苹果片", price: 6, kcal: 32, protein: 0, fat: 0, carbs: 7, sodium: 0, category: "小食" },
  { code: "demo-6", name: "麦辣鸡翅", price: 14, kcal: 289, protein: 4, fat: 12, carbs: 38, sodium: 165, category: "小食" },
  { code: "demo-7", name: "麦香鸡", price: 29, kcal: 513, protein: 27, fat: 26, carbs: 42, sodium: 961, category: "主食" }
];

function asNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number.parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function priceInYuan(value, fieldName = "") {
  if (value && typeof value === "object") {
    const amount = value.amount ?? value.value ?? value.price;
    return priceInYuan(amount, value.unit || value.currencyUnit || fieldName);
  }
  const n = asNumber(value);
  if (/fen|cent|分/i.test(fieldName)) return Number((n / 100).toFixed(2));
  // Some menu responses expose integer cents without naming the unit.
  if (Number.isInteger(n) && n > 200 && n < 100000) return Number((n / 100).toFixed(2));
  return Number(n.toFixed(2));
}

function firstValue(object, names, fallback = "") {
  if (!object || typeof object !== "object") return fallback;
  for (const name of names) {
    if (object[name] !== undefined && object[name] !== null && object[name] !== "") return object[name];
  }
  return fallback;
}

function parseTextBlock(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { /* explanatory text around JSON */ }
  const starts = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter(index => index >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (end <= start) continue;
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* try the next candidate */ }
  }
  return null;
}

export function unwrapMcpPayload(payload) {
  let current = payload?.result ?? payload;
  if (current?.structuredContent !== undefined) return unwrapMcpPayload(current.structuredContent);
  if (Array.isArray(current?.content)) {
    for (const block of current.content) {
      if (block?.structuredContent !== undefined) return unwrapMcpPayload(block.structuredContent);
      const parsed = typeof block?.text === "string" ? parseTextBlock(block.text) : null;
      if (parsed !== null) return unwrapMcpPayload(parsed);
    }
  }
  return current;
}

function arrayFromRoot(root, names = []) {
  const candidates = [root, root?.data, root?.data?.data, ...names.map(name => root?.[name]), ...names.map(name => root?.data?.[name])];
  for (const candidate of candidates) if (Array.isArray(candidate)) return candidate;
  return [];
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const parsed = parseTextBlock(value);
  return parsed ?? value;
}

export function parseNutrition(payload) {
  const root = unwrapMcpPayload(payload);
  const raw = parseMaybeJson(root?.data ?? root);
  const rows = Array.isArray(raw) ? raw : arrayFromRoot(raw, ["foods", "items", "list"]);
  if (rows.length) {
    return rows.map(row => ({
      name: String(firstValue(row, ["productName", "foodName", "name", "mealName", "餐品名称"], "未命名餐品")),
      kcal: asNumber(firstValue(row, ["energy", "kcal", "calorie", "calories", "能量", "热量"])),
      protein: asNumber(firstValue(row, ["protein", "proteinContent", "蛋白质"])),
      fat: asNumber(firstValue(row, ["fat", "fatContent", "脂肪"])),
      carbs: asNumber(firstValue(row, ["carbohydrate", "carbs", "carbohydrates", "碳水化合物"])),
      sodium: asNumber(firstValue(row, ["sodium", "钠"])),
      calcium: asNumber(firstValue(row, ["calcium", "钙"]))
    })).filter(row => row.name !== "未命名餐品");
  }
  if (typeof raw !== "string") return [];
  const result = [];
  for (const rawLine of raw.split(/\\n|\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("[") || line.includes("productName")) continue;
    const parts = line.split(",").map(value => value.trim());
    if (parts.length < 8 || !parts[0]) continue;
    result.push({
      name: parts[0], kcal: asNumber(parts[3]), protein: asNumber(parts[4]),
      fat: asNumber(parts[5]), carbs: asNumber(parts[6]), sodium: asNumber(parts[7]), calcium: asNumber(parts[8])
    });
  }
  return result;
}

function menuEntry(code, meal) {
  const productCode = String(firstValue(meal, ["productCode", "mealCode", "spuCode", "code", "id"], code));
  const name = String(firstValue(meal, ["name", "mealName", "productName", "title", "商品名称"], `餐品 ${productCode}`));
  const currentPriceKey = ["currentPrice", "sellingPrice", "salePrice", "price", "priceFen"].find(key => meal?.[key] !== undefined);
  const originalPriceKey = ["originalPrice", "marketPrice", "originalPriceFen"].find(key => meal?.[key] !== undefined);
  return {
    code: productCode,
    productCode,
    name,
    price: priceInYuan(meal?.[currentPriceKey], currentPriceKey),
    originalPrice: priceInYuan(meal?.[originalPriceKey], originalPriceKey),
    image: firstValue(meal, ["image", "imageUrl", "picUrl"], ""),
    discountType: firstValue(meal, ["discountType", "tag", "label"], ""),
    category: firstValue(meal, ["categoryName", "category", "type"], "实时菜单")
  };
}

export function parseMenu(payload) {
  const root = unwrapMcpPayload(payload);
  const menuRoot = root?.data?.data ?? root?.data ?? root;
  const meals = menuRoot?.meals ?? menuRoot?.products ?? menuRoot?.items ?? menuRoot;
  let parsed = [];
  if (Array.isArray(meals)) parsed = meals.map((meal, index) => menuEntry(String(meal?.productCode || index), meal));
  else if (meals && typeof meals === "object") parsed = Object.entries(meals).map(([code, meal]) => menuEntry(code, meal || {}));
  return parsed.filter(item => item.code && item.name && item.price > 0);
}

export function parseStores(payload) {
  const root = unwrapMcpPayload(payload);
  const list = arrayFromRoot(root, ["stores", "storeList", "shops", "list"]);
  return list.length ? list : (Array.isArray(root?.data) ? root.data : []);
}

export function parseCoupons(payload) {
  const root = unwrapMcpPayload(payload);
  const list = arrayFromRoot(root, ["coupons", "couponList", "items", "list"]);
  return list.map(item => ({
    name: String(firstValue(item, ["couponName", "name", "title", "券名称"], "优惠券")),
    status: String(firstValue(item, ["label", "couponStatus", "status", "说明"], "")),
    couponId: firstValue(item, ["couponId", "id"], "")
  }));
}

function normaliseName(name) {
  return String(name || "").toLowerCase().replace(/[\s()（）·・-]/g, "");
}

function enrich(menuItems, nutritionRows) {
  const nutritionMap = new Map(nutritionRows.map(row => [normaliseName(row.name), row]));
  return menuItems.map(item => {
    const exact = nutritionMap.get(normaliseName(item.name));
    const partial = exact || nutritionRows.find(row => {
      const a = normaliseName(item.name); const b = normaliseName(row.name);
      return a.includes(b) || b.includes(a);
    });
    return { ...item, ...(partial || { kcal: 0, protein: 0, fat: 0, carbs: 0, sodium: 0 }) };
  });
}

function fallbackItems(nutritionRows) {
  const byName = new Map(nutritionRows.map(row => [normaliseName(row.name), row]));
  return DEMO_ITEMS.map(item => ({ ...item, ...(byName.get(normaliseName(item.name)) || {}) }));
}

function itemScore(item, kcalTarget, mode) {
  if (mode === "budget") return -item.price;
  if (mode === "energy") return item.protein * 4 + item.kcal / 50 - item.price / 10;
  return -Math.abs(item.kcal - kcalTarget) - item.price / 10;
}

function choose(items, budgetPerPerson, kcalTarget, mode, people) {
  const sorted = [...items].filter(item => item.price > 0).sort((a, b) => itemScore(b, kcalTarget, mode) - itemScore(a, kcalTarget, mode));
  const groups = mode === "budget"
    ? ["省钱优先", "均衡优先", "满足感优先"]
    : mode === "energy"
      ? ["满足感优先", "均衡优先", "省钱优先"]
      : ["均衡优先", "省钱优先", "满足感优先"];
  const reasons = {
    "均衡优先": "尽量贴近每人的热量目标，同时控制预算和营养结构。",
    "省钱优先": "优先选择价格较低的组合，把总预算留出更多余量。",
    "满足感优先": "优先提高蛋白质和热量密度，适合更看重饱腹感的场景。"
  };
  return groups.map((title, index) => {
    const picked = [];
    const limit = Math.max(8, budgetPerPerson * (index === 0 ? 0.96 : index === 1 ? 1.02 : 1.1));
    for (const item of sorted) {
      if (picked.some(existing => existing.name === item.name)) continue;
      if (picked.length >= (index === 1 ? 3 : 2)) break;
      const next = picked.reduce((sum, current) => sum + current.price, 0) + item.price;
      if (next <= limit || picked.length === 0) picked.push(item);
    }
    if (!picked.length && sorted[0]) picked.push(sorted[0]);
    const perPerson = picked.reduce((sum, item) => sum + item.price, 0);
    return {
      title,
      items: picked,
      servings: people,
      estimatedPerPerson: Number(perPerson.toFixed(2)),
      estimatedTotal: Number((perPerson * people).toFixed(2)),
      kcal: Math.round(picked.reduce((sum, item) => sum + item.kcal, 0)),
      protein: Number(picked.reduce((sum, item) => sum + item.protein, 0).toFixed(1)),
      reason: reasons[title]
    };
  });
}

export function buildRecommendations({ menuItems = [], nutritionRows = [], budget = 40, people = 1, calories = 700, mode = "balanced", live = false, store = null, coupons = [] }) {
  const safePeople = Math.max(1, Number(people) || 1);
  const safeBudget = Math.max(0, Number(budget) || 0);
  const items = enrich(menuItems, nutritionRows);
  const usable = items.length ? items : fallbackItems(nutritionRows);
  const plans = choose(usable, safeBudget / safePeople, Number(calories) || 0, mode, safePeople);
  return {
    live,
    source: live ? "实时 MCP 门店、菜单与营养数据" : "演示数据：未成功读取实时 MCP 菜单",
    store: store ? {
      name: store.storeName || store.name || "麦当劳门店",
      address: store.address || store.storeAddress || "",
      storeCode: store.storeCode || store.code || "",
      distance: store.distance ?? store.distanceMeter ?? ""
    } : null,
    coupons,
    plans,
    constraints: { budget: safeBudget, people: safePeople, calories: Number(calories) || 0, mode }
  };
}

export { asNumber, priceInYuan };
