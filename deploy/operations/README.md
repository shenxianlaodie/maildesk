# 服务器运行、监控与保留规则

## 原始邮件副本清理

`maildesk-raw-mail-cleanup.py` 默认只预览，`--apply` 才删除。仅删除归档创建和大邮件任务完成均超过 7 天、任务为 `done`、存在对应邮件和 `mime_imports` 标记、全部已记录附件的文件及长度均有效的原始 MIME 副本。失败、复核、重试、尚未完整导入的记录保留。正文、附件、邮箱服务商邮件不改动。

安装脚本到 `/usr/local/sbin/maildesk-raw-mail-cleanup.py`（0755），对应 service/timer 到 `/etc/systemd/system/`。先运行 `python3 test_raw_mail_cleanup.py` 及不带 `--apply` 的预览，再验证 unit 并启用 timer。服务以数据目录所属 UID/GID 1000 运行，每天北京时间凌晨 03:00—05:59 每分钟触发，每次最多删除一份，独立于客服进程，数据库锁等待最多一秒。失败会回滚事务并由下次定时重试。服务通过私有挂载路径访问数据，避免放宽宿主机父目录权限。独立进程仍会短暂持有 SQLite 写锁，因此安排在凌晨执行。日志只含计数，不输出邮件原文或客户信息。

删除释放的是 SQLite 内部可复用页，不自动执行 VACUUM，数据库文件不会立即缩小。停止自动清理使用 `systemctl disable --now maildesk-raw-mail-cleanup.timer`；这不会恢复已删除的冗余原文，仍保留的正文和附件不受影响。

这些文件记录当前 Maildesk Linux/Docker 部署配置。它们不会随应用启动自动安装；修改宿主机配置前应备份目标文件，并核对域名、路径、容器名和用户组。不要用于其他服务器而不调整配置。

## 应用运行

`Dockerfile` 使用直接执行 Node 的健康检查，并在 3 秒内取消未完成的请求。`deploy/update-maildesk.sh` 使用 Docker init 回收子进程，内存及内存加交换上限为 1 GiB、CPU 上限为 1 核、进程上限为 100。这是当前机器的部署参数，不代表通用最低配置。

应用记录超过 2 秒的请求、超过 100 毫秒的 SQLite 操作、超过 1 秒的事件循环延迟。请求仅记录路由分类；SQL 仅记录摘要，不记录参数、正文、邮箱地址或密钥。

## 宿主机监控

将 `maildesk-performance.py` 安装为 `/usr/local/sbin/maildesk-performance.py`，权限 0750；创建 `/var/log/maildesk-performance`，权限 0750。将对应 `systemd/maildesk-performance.*` 放入 `/etc/systemd/system/`。

将 `nginx/maildesk-performance.conf` 放入 `/etc/nginx/conf.d/`，并在现有 `/maildesk/` location 中增加：

```nginx
access_log /var/log/nginx/maildesk-performance.jsonl maildesk_performance;
access_log /var/log/nginx/access.log combined;
```

第二行保留原有访问日志。不要复制整个站点配置覆盖其他项目。执行 `nginx -t` 后再 reload。将 `logrotate/maildesk-performance` 安装至 `/etc/logrotate.d/` 并以 `logrotate --debug /etc/logrotate.conf` 验证。

执行 `systemctl daemon-reload` 和 `systemctl enable --now maildesk-performance.timer`。每 30 秒采样 CPU、内存、进程、磁盘压力和内部 HTTP 延迟，并收集应用性能记录。`incident` 是排查标记，不是根因判断，也不会自动发送通知。进程 I/O 计数可能包含已回收子进程；判断实际磁盘忙碌程度应结合 `root_disk_io`。

日志按日轮转，保留最多 14 份/14 天，10 MiB 触发提前轮转。采样器还对资源和应用日志设置 16 MiB 单文件保护，另保留一个 overflow 文件。

## 定期清理

将 `maildesk-maintenance.py` 安装为 `/usr/local/sbin/maildesk-maintenance.py`，权限 0750。先运行不带 `--apply` 的 `npm`、`extensions`、`releases` 模式查看候选；带 `--apply` 才会删除。`logs --apply` 执行 journald 保留规则。

- npm 下载缓存：每周一 03:10，仅 `/root/.npm/_cacache`。
- 插件安装包缓存：每月 1 日 03:20，仅 VS Code/Cursor 的 `CachedExtensionVSIXs`，保留已安装插件。
- 发布版本：每 15 分钟检查；当前服务健康且运行至少 5 分钟时，保留当前容器和最近两个回滚容器，只清理更旧的已停止回滚容器、未引用的旧 Maildesk 镜像及受限构建目录，不删除数据卷。
- 系统日志：每日 03:00 vacuum，保留最近 14 天且总量不超过 512 MiB。时间使用服务器时区，当前为 Asia/Shanghai。

将 `systemd/maildesk-maintenance-*` 放入 `/etc/systemd/system/`，验证后启用四个 timer。发布与清理须共同持有 `/run/maildesk-maintenance.lock`；部署时不要并行清理。当前运维发布流程已使用此锁。

`journald/60-maildesk-retention.conf` 安装至 `/etc/systemd/journald.conf.d/` 后需重启 journald。`logrotate/maildesk-maintenance` 用于指定系统任务日志。已有 nginx/rsyslog 轮转规则应原地设置 `daily`、`rotate 14`、`maxage 14`、`maxsize 20M`，不要新增重复匹配规则。logrotate timer 可设为每小时检查，以及时执行大小限制。

这些系统日志设置影响同机其他项目，按服务器运维变更管理。不要启用旧的 `docker system prune --volumes` 清理任务；替换旧任务前备份 crontab，只停用已确认被本规则替代的任务。

## 验证与回滚

检查 `systemctl list-timers`、服务 journal、监控 JSONL 和 `docker inspect` 的健康状态；正常探测均应为 HTTP 200。配置回滚使用修改前备份，应用回滚使用保留的容器/镜像。不要在回滚过程中删除数据目录或 Docker 数据卷。仓库不保存凭据、数据库、运行日志或服务器备份。
