const form = document.querySelector("#planner-form");
const statusEl = document.querySelector("#status");
const notice = document.querySelector("#notice");
const result = document.querySelector("#result");
const plans = document.querySelector("#plans");
const sourceBadge = document.querySelector("#source-badge");
const storeLine = document.querySelector("#store-line");
const telemetry = document.querySelector("#telemetry");

function money(value) { return `¥${Number(value || 0).toFixed(2)}`; }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
function showNotice(text, error = false) { notice.textContent = text; notice.className = `notice${error ? " error" : ""}`; }
function hideNotice() { notice.className = "notice hidden"; }

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

async function checkHealth() {
  try {
    const data = await fetchJson("/api/health");
    statusEl.textContent = data.mcpConfigured ? "MCP 已配置" : "演示模式";
    if (data.mcpConfigured) statusEl.classList.add("ok");
  } catch { statusEl.textContent = "本地服务未启动"; }
}

function renderPlan(plan, live, storeCode) {
  const items = plan.items.map(item => ({ productCode: item.productCode || item.code, quantity: plan.servings || 1 }));
  const encodedItems = encodeURIComponent(JSON.stringify(items));
  const verifyButton = live && storeCode
    ? `<button class="verify" data-store="${escapeHtml(storeCode)}" data-items="${encodedItems}">校验官方价格</button>`
    : "";
  const itemHtml = plan.items.map(item => `<li><span>${escapeHtml(item.name)}</span><span>${money(item.price)}</span></li>`).join("");
  return `<article class="card"><h3>${escapeHtml(plan.title)}</h3><div class="price">${money(plan.estimatedTotal)} <small>/ 全部</small></div><div class="sub-price">${money(plan.estimatedPerPerson)} / 人 · ${plan.servings || 1} 人</div><div class="metrics"><span class="metric">${plan.kcal} kcal / 人</span><span class="metric">蛋白质 ${plan.protein}g / 人</span></div><ul class="items">${itemHtml}</ul><p class="reason">${escapeHtml(plan.reason)}</p>${verifyButton}</article>`;
}

async function verifyPrice(button) {
  button.disabled = true; button.textContent = "校验中…";
  try {
    const payload = await fetchJson("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeCode: button.dataset.store,
        orderType: 1,
        beType: 1,
        items: JSON.parse(decodeURIComponent(button.dataset.items)),
        needTableware: false
      })
    });
    const compact = JSON.stringify(payload.result || {}).slice(0, 420);
    showNotice(`官方价格校验已返回：${compact}${compact.length >= 420 ? "…" : ""}`);
  } catch (error) { showNotice(`价格校验失败：${error.message}`, true); }
  finally { button.disabled = false; button.textContent = "校验官方价格"; }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  data.budget = Number(data.budget); data.people = Number(data.people); data.calories = Number(data.calories);
  const button = form.querySelector("button");
  button.disabled = true; button.textContent = "正在读取 MCP 数据…"; hideNotice(); result.classList.add("hidden");
  try {
    const payload = await fetchJson("/api/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    sourceBadge.textContent = payload.live ? "● 实时 MCP 数据" : "○ 演示数据";
    sourceBadge.style.color = payload.live ? "var(--green)" : "#9b6b00";
    if (payload.store) {
      const distance = payload.store.distance ? ` · ${escapeHtml(payload.store.distance)}m` : "";
      storeLine.textContent = `已选择可营业门店：${payload.store.name}${distance} · ${payload.store.address || "地址未返回"}`;
    } else {
      storeLine.textContent = "未锁定实时门店：当前展示演示算法结果，请检查位置关键词、Token 或 MCP 服务状态。";
    }
    plans.innerHTML = (payload.plans || []).map(plan => renderPlan(plan, payload.live, payload.store?.storeCode)).join("");
    plans.querySelectorAll(".verify").forEach(button => button.addEventListener("click", () => verifyPrice(button)));
    const couponText = payload.coupons?.length ? `发现 ${payload.coupons.length} 张可用/可领取优惠` : "未读取到优惠券";
    telemetry.innerHTML = `<b>本次调用</b> ${payload.telemetry.tools.map(escapeHtml).join(" · ")} · <span>${payload.telemetry.menuCount} 个实时商品 · ${couponText}</span>`;
    result.classList.remove("hidden");
    showNotice(payload.live ? "已根据当前门店实时菜单生成方案；只有点击“校验官方价格”才会调用价格计算，不会自动下单。" : "当前为演示模式：推荐仍可体验，但价格和供应不可视为实时结果。配置 MCD_MCP_TOKEN 后可读取实时门店与菜单。", !payload.live);
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { showNotice(error.message, true); }
  finally { button.disabled = false; button.innerHTML = "生成我的三套方案 <span>→</span>"; }
});

checkHealth();
