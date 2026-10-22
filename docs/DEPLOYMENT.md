# 独立容器部署

当前状态：chat.thinkpro.top 根路径保留原 Chatwoot；新 Maildesk 通过 https://chat.thinkpro.top/maildesk/ 访问。容器仅发布服务器本机 4175（SSH 入口）及 4182（登录网关），Nginx 仅为 /maildesk/ 分流。

应用容器内置 Node.js 24，使用 SQLite 保存邮件、附件、草稿、客服设置、授权和本地订单备注，无须单独数据库容器。外部 PostgreSQL 仅提供订单只读查询。

服务器专用目录 `/opt/maildesk`，持久数据 `/opt/maildesk/data`，连接配置 `/opt/maildesk/.env`（权限 600）。数据目录归容器 UID 1000 所有，权限 700，容器升级时保留该目录及加密密钥。镜像不包含 `.env`、SSH 密钥或业务数据。

构建：`docker build -t maildesk:local /opt/maildesk/app`

首次启动（已存在同名容器时先检查，勿直接覆盖）：

```sh
docker run -d --name maildesk --restart unless-stopped \
  --memory=512m --memory-reservation=128m --memory-swap=512m --cpus=0.5 --pids-limit=100 \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  --cap-drop=ALL --security-opt=no-new-privileges \
  --log-driver=json-file --log-opt max-size=10m --log-opt max-file=3 \
  --env-file /opt/maildesk/.env -e MAILDESK_PUBLIC_ORIGIN=https://chat.thinkpro.top -e MAILDESK_BASE_PATH=/maildesk \
  --mount type=bind,source=/opt/maildesk/data,target=/data \
  -p 127.0.0.1:4175:4175 -p 127.0.0.1:4182:4182 maildesk:path
```

容器网关仅发布到服务器本机 4182，由 Nginx 提供 HTTPS 公网入口。后端 4175 也仅发布到宿主机 127.0.0.1，供 SSH 隧道访问。网站配置见 `deploy/maildesk.nginx.conf`，现有证书由宿主机管理。

部署地址：https://chat.thinkpro.top/maildesk/ 。工作台使用 `/data/access.json` 的 `business` 访问码；`/maildesk/config` 转到独立管理登录，使用 `admin` 访问码。访问码文件保存在服务器 `/opt/maildesk/data/access.json`，权限 600，容器重建后保留。会话仅在内存中保留 8 小时，重启后需重新登录。Cookie 设置 HttpOnly、Secure 和 SameSite=Strict，公网请求必须匹配配置域名。当前是共享访问码登录，不是逐人账号密码系统；客服分配记录仍保存在本地 SQLite。

管理员可通过管理配置页手动同步邮箱；普通工作台访问码不能读写连接授权或触发同步。首次上线邮箱未配置，不会读取或发送真实邮件。

本次域名切换前的旧 Chatwoot Nginx 配置保存在 `/opt/maildesk/chatwoot-nginx-before-maildesk.conf`，旧容器与数据库仍保留。回退时先恢复该文件到 `/etc/nginx/sites-available/chatwoot`，运行 `nginx -t` 确认后再 reload Nginx。

检查：`docker inspect --format '{{.State.Health.Status}}' maildesk`、`docker stats --no-stream maildesk`。手动同步邮箱和实际发送前需自行配置授权；默认发件仍限定测试收件人。暂停自动同步的启动方式不执行定时备份，部署目录应安排独立备份，复制 SQLite 时应停服或使用 SQLite backup API。

路径分流上线前完整 Nginx 配置：`/opt/maildesk/chatwoot-nginx-before-path-1792475855.conf`。本次仅插入 deploy/maildesk.nginx.conf 的 location 片段，旧站点其他内容逐字保留。

## 钉钉登录（服务器）

`/opt/maildesk/.env` 配置 `DINGTALK_APP_KEY`、`DINGTALK_APP_SECRET`、`DINGTALK_CORP_ID`、`DINGTALK_REDIRECT_URI`。回调地址必须为 `https://chat.thinkpro.top/maildesk/auth/dingtalk/callback`，并在钉钉应用安全设置中追加注册；保留其他系统的回调地址。应用需开通个人信息权限 `Contact.User.Read`。

使用 `openid corpid` 授权码流程；后端严格匹配令牌响应中的 CorpId，缺失或不匹配均拒绝登录。OAuth state 有效期 5 分钟、一次性使用，并绑定浏览器 HttpOnly/Secure/SameSite=Lax cookie。业务和管理会话保持 7 天 HttpOnly/Secure/SameSite=Strict cookie；会话保存在本地数据目录 login-sessions.json（0600），重启后仍有效，过期或退出后失效。访问令牌和刷新令牌不落盘。

用户身份和角色保存在本地数据目录 `dingtalk-users.json`。新身份仅有客服权限；首次管理员绑定：先用钉钉登录，再通过管理访问码进入 `/maildesk/config`，点击底部“将当前钉钉账号绑定为管理员”。后续钉钉登录即可获得管理会话。保留共享访问码作为备用入口。此改动仅接入网关身份认证，业务操作记录目前仍沿用原有本机操作员模型。
