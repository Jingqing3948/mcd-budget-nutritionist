# 麦麦预算营养师

给定总预算、人数、每人热量目标、城市和位置关键词，调用麦当劳 MCP 的实时门店、菜单、营养数据与优惠信息，生成三套可解释的点餐方案。用户选定方案后，点击“校验官方价格”才调用 `calculate-price`；项目不会自动下单、支付或取消订单。

## 项目介绍

普通推荐无法回答“当前门店有没有货、现在多少钱、这笔预算够不够”。麦麦预算营养师把“找门店 → 读实时菜单 → 匹配营养数据 → 生成方案 → 官方价格校验”拆成清晰的 MCP 调用链，并在 MCP 暂时不可用时保留可操作的演示模式。

## 目标用户

- 想控制一桌总预算的个人或小组；
- 希望按每人热量目标快速搭配餐品的人；
- 需要比较省钱、均衡和满足感取向的人；
- 想在提交订单前先确认官方价格的人。

## 技术架构

```text
浏览器（原生 HTML/CSS/JavaScript）
          ↓ JSON HTTP
Node.js 原生 HTTP 服务
          ↓ Streamable HTTP + JSON-RPC tools/call
麦当劳 MCP Server（https://mcp.mcd.cn）
```

项目不依赖第三方 npm 包。服务端负责 Token、MCP 请求、JSON/SSE 响应解析、降级和推荐计算；浏览器只接收脱敏后的结果，永远不会接触 `MCD_MCP_TOKEN`。

## MCP Tool 使用说明

| Tool | 用途 | 调用时机 |
| --- | --- | --- |
| `query-nearby-stores` | 根据城市和位置关键词查找可用门店 | 生成方案时 |
| `query-meals` | 查询指定门店实时在售餐品、价格和商品编码 | 找到门店后 |
| `query-store-coupons` | 查询指定门店和订单类型下的优惠券 | 找到门店后 |
| `list-nutrition-foods` | 查询热量、蛋白质、脂肪、碳水、钠等营养信息 | 生成方案时 |
| `available-coupons` | 查询用户可领取的麦麦省优惠券 | 生成方案时 |
| `calculate-price` | 用实时菜单返回的 `productCode` 校验选中方案价格 | 用户显式点击按钮后 |

MCP 请求使用官方要求的 `Authorization: Bearer ${MCD_MCP_TOKEN}`，请求体为 JSON-RPC `tools/call`。响应同时兼容普通 JSON 和 `text/event-stream`；MCP 的 `result.structuredContent`、`content[].structuredContent` 和 `content[].text` JSON 均可解析。

## 安装方法

要求 Node.js 18 或更高版本。项目没有额外依赖，克隆后直接运行即可。

```powershell
cd C:\Users\a\Desktop\Proj\mcd-budget-nutritionist
npm install
```

## 运行方法

### 实时模式

仅通过环境变量提供 Token，不要把真实 Token 写入文件：

```powershell
$env:MCD_MCP_TOKEN = "YOUR_MCP_TOKEN"
$env:PORT = "8787"
npm start
```

然后打开 <http://localhost:8787>。

### 演示模式

不设置 `MCD_MCP_TOKEN` 也可以启动。页面会明确显示“演示模式”，使用内置示例商品生成三套方案；演示价格、库存和供应状态不代表实时结果，价格校验按钮不会出现。

## 演示步骤

1. 打开页面，默认参数为“北京市 / 望京”、总预算 40 元、1 人、每人 700 千卡。
2. 点击“生成我的三套方案”。
3. 展示“均衡优先、省钱优先、满足感优先”三套结果，以及门店、价格、热量、蛋白质和餐品明细。
4. 修改预算、人数、热量目标或偏好，再次生成方案。
5. 在实时模式下点击任一方案的“校验官方价格”，查看 `calculate-price` 返回结果。该操作只做价格计算，不创建订单、不支付。

## 接口自测

```powershell
Invoke-RestMethod http://localhost:8787/api/health

Invoke-RestMethod http://localhost:8787/api/recommend `
  -Method Post -ContentType "application/json" `
  -Body '{"budget":40,"people":1,"calories":700,"city":"北京市","keyword":"望京","mode":"balanced"}'
```

`/api/calculate` 应使用页面从实时菜单中拿到的 `productCode`，示例结构如下：

```json
{
  "storeCode": "REAL_STORE_CODE",
  "orderType": 1,
  "beType": 1,
  "items": [{ "productCode": "REAL_PRODUCT_CODE", "quantity": 1 }],
  "needTableware": false
}
```

## 安全说明

- 真实 Token 只从 `MCD_MCP_TOKEN` 环境变量读取；
- Token 不写入源码、配置示例、日志、页面或接口响应；
- `/api/health` 只返回是否已配置，不返回 Token；
- `CONTEST_DECLARATION.md` 保持官方原文；
- 项目不调用 `create-order`、支付、取消订单或自动领券工具。

## 免责声明

本项目是麦当劳程序员节创意开发大赛参赛作品，非麦当劳官方产品。推荐结果仅供点餐决策参考，不构成医疗、营养或其他专业建议；餐品信息、价格、优惠和供应状态以麦当劳官方实时渠道为准。

## 文件说明

```text
src/server.js              # 原生 HTTP 服务、MCP 客户端和接口
src/recommendation.js      # MCP 响应解析、营养匹配和方案生成
src/public/index.html      # 页面结构
src/public/app.js          # 页面交互和价格校验
src/public/styles.css      # 页面样式
MCP_INTEGRATION.md         # MCP 调用链和协议说明
CONTEST_DECLARATION.md     # 官方参赛声明，内容不可修改
mcp-config.example.json    # 官方 MCP 配置示例
CONTEST_SUBMISSION.md      # Issue 报名模板和参赛准备清单
```
