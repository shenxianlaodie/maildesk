# 参与贡献

感谢改进 Maildesk。请向 [shenxianlaodie/maildesk](https://github.com/shenxianlaodie/maildesk) 的 `main` 分支提交 Pull Request。修正文档和小范围问题可以直接提交；新功能或数据结构变更请先开 Issue 说明使用场景。

## 本地准备

需要 Node.js 24 或更新版本。本次验证使用 Node.js 24.22.0 和 pnpm 10.34.7。

```sh
git clone https://github.com/shenxianlaodie/maildesk.git
cd maildesk
npm install --global pnpm@10.34.7
pnpm install --frozen-lockfile --ignore-scripts
pnpm start
```

打开 `http://127.0.0.1:4174/`。演示环境自动生成 8 位虚构顾客，演示回复只保存在本地。停止终端进程即可停止服务。

`pnpm run start:business` 在 `127.0.0.1:4175` 启动独立业务环境。仅在需要验证真实服务、且明确了解发信范围时配置自己的测试账号。提交前不要把 `.demo-data/`、`.preview-data/`、`.maildesk/`、访问码或任何授权文件加入 Git。

## 代码与验证

- 后端采用 CommonJS、Node.js HTTP 和 SQLite；前端使用原生 HTML/CSS/JavaScript，沿用邻近代码风格。
- 一次变更聚焦一个问题。修改数据库时说明旧数据如何兼容；保持邮件去重、草稿并发保护、发件邮箱路由和演示隔离。
- 修复逻辑或权限问题时添加可复现的回归测试。不要在测试中连接真实邮箱、店铺或 AI 服务。
- 界面变更检查桌面和窄屏，附上实际运行截图，使用演示数据并说明截图对应版本。

```sh
pnpm test
node scripts/audit-licenses.cjs --check
git diff --check
```

需要修改依赖时，使用相同 pnpm 版本同步提交 `package.json`、`pnpm-lock.yaml` 和第三方清单。不要混入另一个包管理器的锁文件。`dist/core.js` 和 `dist/metrics.js` 当前是仓库直接维护的业务模块，相关行为变更也需要相应测试。

## Issue 与 Pull Request

问题报告请提供 Node.js/操作系统版本、复现步骤、预期与实际结果，以及移除敏感内容后的错误信息。不要粘贴客户邮件、地址、手机号、Cookie、API Key 或邮箱授权码。

PR 描述应说明：解决的问题、改动范围、验证方法，以及数据兼容性或已知限制。面向使用者的变更补充到 [CHANGELOG.md](CHANGELOG.md) 的 `Unreleased` 部分；未发布的功能不要写成已上线。

发现会暴露凭据或客户数据的安全问题时，请使用仓库 **Security → Report a vulnerability**（如已启用）向维护者私下报告；若不可用，先提交不含漏洞细节的联系请求，不要公开密钥或可利用的客户数据。

## 许可证与第三方来源

提交贡献即表示你有权贡献该内容，并同意按项目 [MIT License](LICENSE) 提供。复制或改编第三方代码时，注明来源、确切版本、许可证及修改内容，保留所要求的版权声明，并更新 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。不要提交来源不明、禁止再分发或与项目分发方式不兼容的素材。

## 版本记录

维护者发布时应先完成上述验证，再按实际变更确定版本、更新版本号和变更记录，并创建对应 Git 标签和 GitHub Release。没有标签或 Release 的源码快照不能写成既有正式发行版。`scripts/build-handoff.cjs` 是私有数据迁移工具，不应用于公开发布。
