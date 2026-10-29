# 顾客自助改址

## 状态与安装

功能由服务端配置启用，缺配置时默认关闭。店铺主题需另外安装嵌入片段。公网客服登录保持原有要求，新增接口只在显式配置后启用。

在服务数据目录创建 `customer-address.json`（0600）：

```json
{
  "enabled": true,
  "stores": {
    "2392762": {
      "subdomain": "shutiaoes",
      "origins": ["https://www.corachice.com", "https://corachice.com"]
    }
  }
}
```

不再发送验证码，不需要 SMTP 或发件邮箱配置。复用现有 `order-address-writer-credentials.json` 和 PG 六参数改址函数。无需添加店铺 token 到主题。缺配置时入口不公开；无凭据时不降级成直接 API 写入。

1. 部署新模块及 `scripts/start-server.cjs`、网关接入变更，先保持未启用。
2. 配置一间测试店铺和原订单邮箱，在未发货且 48 小时内的测试订单验收。不能用真实顾客订单试写。
3. 在店匠主题副本新建 snippet `customer-address`，粘贴 `storefront/customer-address.liquid`。在用户提供的订单详情模板 `</spz-order-detail>` 后、`{% schema %}` 前加入 `{% include 'customer-address' %}`。片段自动读取 shop.id，配置中的 store key 必须使用对应数字店铺 ID；兼容别名可另外保留。
4. 主题预览完成后发布。订单确认邮件继续使用默认 View Your Order 按钮；顾客用订单号与邮箱经店匠原查询流程打开详情，展开改址区域后直接编辑。主题通过限定目标域的 postMessage 自动传入 order.order_info.order_no 与 order.customer.email；邮箱不出现在 URL 中。若主题缺少邮箱字段，表单回退到邮箱和订单号查询，不发送验证码。不要把示例订单地址写死进邮件。

## 边界

- 查找精确匹配店铺及订单 ID / 编号，从 PG 原始订单 email（缺失时 customer_email）核对邮箱。两项完全匹配后才建立本订单的改址会话；不信任前端的“已查询”标记。
- 未匹配不返回地址；会话三十分钟有效，绑定店铺、订单和原邮箱。按用户要求，知道订单号和原邮箱即可访问并修改符合条件的订单，不再要求邮箱验证码或证明持有该邮箱。这个接口不代表已验证店匠账号登录态。
- 邮箱/订单/IP 分别限流，记录存 SQLite；默认忽略 X-Forwarded-For。反向代理部署需在配置顶层设置 `trustedProxyAddresses` 为实际直连 nginx 的 IP（不是任意网段），并确认 nginx 使用 `$proxy_add_x_forwarded_for` 或覆盖为 `$remote_addr`；此时只信任最右侧实际客户端地址。未配置时访客共用代理 IP 的保守限额（60 次/小时），不会接受伪造 IP 绕过。
- 仅允许 48 小时内、订单状态明确允许且未发货的新申请；共享 worker 执行前再次确认店匠状态。
- 国家支持搜索选择，州／省支持搜索及自由填写。匹配项自动携带编码；未知州名清空旧编码。后台验证国家与州编码一致性。电话国际前缀可识别区号，区号也可手动填写。税号等字段不开放。
- 完整旧地址来自服务器，写入冲突由共享队列处理；客户端不能伪造 expected、actor 或请求 UUID。
- 发起申请前持久保存请求 UUID 和内容，网络异常重试复用相同请求。pending/processing/uncertain 不能显示成功；只有 succeeded 才显示已更新。
- 页面刷新后自动重新核对详情页传来的订单号和邮箱。同店铺、同订单、同原邮箱可以恢复本入口发起的活动请求或未知结果，并使用原 UUID 继续核验。不会返回客服员工或其他入口发起的请求详情。
- 地址变更通过 PG worker 回写店匠；客服系统会通过原有缓存刷新看到新地址。独立入口不直接清理客服地址备注。

## 验收

测试使用模拟队列和内存 SQLite，包含邮箱/订单不匹配、会话过期与查询限流、跨订单请求、过期订单、部分发货、幂等重试、接口来源验证。浏览器本地预览不会发送真实邮件。

上线前还需真实测试订单验收：订单号和邮箱查询 → 进入详情 → 直接修改 → 等待 worker 核验 → 店匠后台核对；以及实际已发货、已取消、超过 48 小时订单拒绝。用户提供的 LQBXSC91577 已发货，只适合验证拒绝流程。

字段来源：[order](https://www.shoplazza.dev/docs/theme/references/liquid/objects/order)、[order_info](https://www.shoplazza.dev/docs/theme/references/liquid/objects/order_info)、[customer](https://www.shoplazza.dev/docs/theme/references/liquid/objects/customer)。店匠 placed 状态为正常已下单状态，仍需未发货并在 48 小时内。
