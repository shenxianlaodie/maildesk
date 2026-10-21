# 真实运行截图

这些截图是公开仓库源码实际运行后的浏览器截图，不是效果图或由图片生成工具创建的界面。顾客、邮件、商品、订单和物流使用 `scripts/seed-desk-demo.cjs` 的虚构演示数据；AI 配置页来自另一个空白业务环境，没有填写 API Key。

| 图片 | 场景 | 视口 |
|---|---|---|
| [workbench-desktop.png](workbench-desktop.png) | 桌面工作台、演示邮件与关联订单 | 1600 × 1000 |
| [conversation-mobile.png](conversation-mobile.png) | 手机宽度的邮件沟通视图 | 390 × 844 |
| [ai-settings.png](ai-settings.png) | AI 配置表单，未连接外部 AI | 1440 × 1080 |

截图时间、浏览器版本和完整源码基线记录在 [capture.json](capture.json)。截图基于公开提交 `9148e8cae58a42ce70ffd8d84308373e5828e4e8`，叠加本次文档和许可声明；没有为截图修改页面内容、伪造 API 响应或接入真实业务数据库。Node.js 为 24.22.0，时区为 Asia/Shanghai，语言为 zh-CN。

## 复现

在单独的开发目录安装依赖后运行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm start
```

1. 打开 `http://127.0.0.1:4174/`，等待第一位演示顾客的邮件与订单加载，按 1600 × 1000 视口截图。
2. 将浏览器视口调整为 390 × 844，点击移动导航的“沟通”，截取会话。
3. 在一个没有业务数据或授权的开发环境另开终端执行 `pnpm run start:business`，打开 `http://127.0.0.1:4175/config`，点击“AI 服务”，按 1440 × 1080 视口截图。不要保存或验证真实服务授权。

本次采集为避开机器已有服务，通过 `createPilot` 的 `port` 参数使用本地 4176/4177 端口，并将两套临时数据库放在隔离容器内。截图期间网络请求只到这两个本地服务，未调用邮件、店铺或 AI 服务。

演示脚本按启动时间生成日期，因此重新运行时显示的时间可能不同。修改界面后应重新运行并替换截图，同时更新 capture.json；不要直接编辑截图来表示尚未实现的功能。
