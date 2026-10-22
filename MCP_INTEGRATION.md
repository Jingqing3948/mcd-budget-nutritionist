# MCP 集成说明

## 服务与协议

- Server：`mcd-mcp`
- Endpoint：`https://mcp.mcd.cn`
- Transport：Streamable HTTP
- 认证：`Authorization: Bearer ${MCD_MCP_TOKEN}`
- Token 来源：仅从环境变量读取，不进入前端和仓库

官方文档说明 MCP Server 使用 Streamable HTTP，并要求在请求头携带 Bearer Token。服务端发送 JSON-RPC 2.0 的 `tools/call` 请求：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "query-meals",
    "arguments": {
      "storeCode": "REAL_STORE_CODE",
      "orderType": 1,
      "beType": 1
    }
  }
}
```

客户端声明 `Accept: application/json, text/event-stream`，普通 JSON 和 SSE 响应都能处理。MCP 结果解析兼容以下结构：

- `result.structuredContent`；
- `result.content[].structuredContent`；
- `result.content[].text` 中直接返回的 JSON 或被说明文字包裹的 JSON。

## 实际使用的 Tool

| Tool | 业务用途 | 调用时机 |
| --- | --- | --- |
| `query-nearby-stores` | 根据城市、位置关键词查询附近门店并获取 `storeCode` | 用户生成方案时 |
| `query-meals` | 查询指定门店实时在售商品、价格和商品编码 | 找到门店后 |
| `query-store-coupons` | 查询指定门店和订单类型下可使用的优惠券 | 找到门店后 |
| `list-nutrition-foods` | 获取餐品热量、蛋白质、脂肪、碳水、钠等信息 | 生成方案时 |
| `available-coupons` | 查询用户可领取的麦麦省优惠券 | 生成方案时 |
| `calculate-price` | 对用户选中的方案进行官方价格计算 | 用户显式点击按钮后 |

## 调用链

```text
用户输入总预算 / 人数 / 每人热量 / 城市 / 位置 / 偏好
        ↓
list-nutrition-foods + available-coupons
        ↓
query-nearby-stores
        ↓
query-meals + query-store-coupons
        ↓
实时菜单与营养匹配 → 均衡 / 省钱 / 满足感三套方案
        ↓
用户点击“校验官方价格”
        ↓
calculate-price（使用 query-meals 返回的 productCode）
```

## 价格与商品编码

菜单解析器优先读取 `productCode`、`mealCode`、`spuCode` 或对象键作为商品编码，并原样保存在方案的 `productCode` 字段。价格解析支持带有 `fen`、`cent` 或“分”标识的字段；对未标明单位但明显是整数分值的价格也会转换为元。前端不会用演示商品编码调用 `calculate-price`。

## 降级行为

- 未配置 Token：直接进入演示模式；
- 附近门店查询失败：保留页面和推荐流程，显示演示数据；
- 附近门店为空：不调用菜单和门店优惠，显示演示数据；
- 实时菜单为空或解析失败：不崩溃，显示演示数据且不显示价格校验按钮；
- 单个营养或优惠接口失败：其他已成功返回的数据仍可使用。

页面会明确显示“实时 MCP 数据”或“演示数据”，不会把演示结果伪装成实时结果。

## 安全边界

本项目只使用查询和价格计算能力，不调用 `create-order`、支付、取消订单或自动领券工具。`calculate-price` 只有用户显式点击后才会执行，且服务端会校验门店编码和实时 `productCode` 不为空。
