# 第三方代码与再分发声明

核查日期：2026-10-21。范围为本公开仓库、`pnpm-lock.yaml` 锁定的 59 个 npm 包及随源码内嵌的 SVG 图标。核查依据是按锁文件安装后各包的 `package.json` 和实际许可证文件，不是仅按包名推断许可证。

## 核查结论

本次核查的依赖均允许在遵守其许可证条件的前提下使用、修改和再分发，未发现必须将本项目整体改为强 copyleft 许可证的依赖。项目自身代码采用 [MIT](LICENSE)；第三方组件保留各自许可证，项目 MIT 声明不替代它们。

| 许可证声明 | 锁定包数量 | 再分发处理 |
|---|---:|---|
| MIT | 37 | 保留版权与许可声明 |
| MIT-0 | 1 | 允许再分发；仍随本项目保留原文 |
| BSD-2-Clause | 5 | 源码和二进制分发均保留指定声明及免责条款 |
| BSD-3-Clause | 1 | 同上；不得用作者名称为衍生产品背书 |
| ISC | 1 | 保留版权与许可声明 |
| MIT OR EUPL-1.1+ | 1 | `@zone-eu/mailsplit@5.4.17` 明确选用 MIT 选项 |

直接依赖：`imapflow@2.0.5`（MIT）、`mailparser@3.9.28`（MIT）、`nodemailer@10.0.10`（MIT-0）。双许可包实际同时提供 `LICENSE.MIT` 与 `LICENSE.EUPL-1.2`；两份原文均保留在清单中，本项目选择 MIT，不以 MIT 重新许可其上游代码。

- [完整版本、许可证、来源和许可证文件校验值](docs/third-party/dependencies.json)
- [59 个包随附的许可证原文](docs/third-party/npm-licenses.txt)（仅统一换行及行尾空白；清单校验值对应上游原始文件）

这份结论适用于上述锁定版本。升级、增加依赖或引入其他源码后必须重新核查，不应推导为对所有未来版本或所有历史源码来源的保证。

## 内嵌 SVG 图标

`backend/public/desk/app.js`、`backend/public/settings/app.js` 和 `backend/public/v1/data.js` 的线框图标包含经过路径合并、简化或坐标写法调整的 Feather 图形（如 mail、message-circle、paperclip、send、copy、truck、external-link）。保留 Feather 的 MIT 声明：

- 上游：[Feather v4.29.2](https://github.com/feathericons/feather/tree/v4.29.2)
- 版权：Copyright (c) 2013-2023 Cole Bemis
- [随仓库保存的完整许可证](docs/third-party/feather-LICENSE.txt)

本仓库没有打包第三方字体、商品照片或图标字体；界面使用系统字体和内嵌 SVG。文档截图由本仓库真实运行生成，内容使用仓库自带的虚构演示数据。

## 分发范围与运行时

公开源码包不包含 Node.js 二进制、`node_modules`、客户数据库、附件原件或服务商凭据。用户自行安装的 Node.js 及其内嵌组件适用 [Node.js 自身的许可证集合](https://github.com/nodejs/node/blob/main/LICENSE)。如果另外制作带运行时的安装包，必须携带**与该运行时版本对应的完整 Node.js LICENSE**，不能只附上一个网页链接。

私有迁移脚本 `scripts/build-handoff.cjs` 会读取真实业务数据库，不是公开发行包生成器；其输入数据与原始交接资料不属于本开源许可授权范围。使用该脚本时必须通过 `MAILDESK_NODE_LICENSE_FILE` 提供所打包 Node.js 版本的完整 LICENSE 文件，脚本会将其连同本项目和第三方声明一起复制。公开发布请使用 GitHub 的源码归档，排除运行时数据。

第三方邮箱、店铺和 AI 服务是外部服务；本项目源码许可不授予其商标、服务、账号或客户数据的使用权。当前公开版本不打包 17TRACK 客户端或线上定制版本的钉钉实现。

## 复查

```sh
pnpm install --frozen-lockfile --ignore-scripts
node scripts/audit-licenses.cjs --check
```

升级依赖后先人工审查新的许可证，再运行 `node scripts/audit-licenses.cjs` 更新清单并提交差异。脚本遇到新许可证、缺失许可原文或安装图与锁文件不一致时会失败，不会静默视为可分发。
