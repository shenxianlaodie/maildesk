# 邮件补拉与诊断记录

邮件下载、附件和 mime_imports 入库优先于订单关联与 AI 后处理。普通下载失败会转入后台队列；旧 MESSAGE_REQUIRES_REVIEW、MESSAGE_PARSE_REVIEW 和新 MESSAGE_DOWNLOAD_RETRY 均会入队。用户要求补齐的旧 review 邮件允许早于常规同步起始时间；常规同步仍保持原有日期范围。

- 普通自动同步总预算为 5 分钟；单封直接下载预算为 30 秒，超时转后台分段下载。
- 后台 MIME 下载继续使用 50 MiB 共享内存预算、最多两个不同邮箱任务；单封超过预算仍标记 SIZE_REVIEW，避免内存耗尽。当前已查到的七封历史超限邮件均为约 24–27 MiB，可进入该通道。
- 网络等暂时失败持续退避重试，最长间隔 15 分钟，不再三次后永久停掉。
- 原始 MIME 完整下载并校验长度后写入 mail_raw_archive，再进行解析；只有解析阶段失败且原文已持久化时才标记 archived。
- archived 表示邮件原文已拉到本地，但尚未转成正常会话；不能统计成已导入。不能确定发件人或多个收件人时不自动猜测客户。
- done 表示已完成邮件/附件和 mime_imports 导入。日志、订单关联或 AI 后处理失败不阻断该结果。

## 后续后台日志的数据来源

mail_sync_events 字段：id、created_at（UTC ISO）、inbox_id、provider_id、run_id、stage、code、attempt。通过 inboxes 获取邮箱名称，通过 sync_runs 对应同步轮次。日志只保存结构化错误码，不写凭据、邮件正文或未经筛选的服务器响应。

阶段包括 connect、list、open_folder、search、metadata、download、archive、parse、persist、post_import。错误包括 IMAP_AUTH_FAILED、IMAP_CONNECT_TIMEOUT、IMAP_DOWNLOAD_TIMEOUT、IMAP_SYNC_DEADLINE、IMAP_ECONNRESET、IMAP_ENOTFOUND、IMAP_TLS_FAILED、IMAP_LARGE_INCOMPLETE、IMAP_PARSE_FAILED、IMAP_AMBIGUOUS_SENDER、IMAP_MULTIPLE_RECIPIENTS_REVIEW、IMAP_INVALID_MESSAGE_DATE、IMAP_POST_IMPORT_FAILED。

large_mail_jobs 保存当前任务状态、次数、下次执行时间与最后错误。mail_raw_archive 保存完整 MIME 二进制；这不是公开接口，不应在普通日志列表返回原文。后续下载/重处理入口必须验证邮箱权限。

部署后历史通用错误码不会自动变成精确原因，下一次执行才产生细分记录。诊断写入失败输出 MAIL_DIAGNOSTIC_WRITE_FAILED，不影响任务状态迁移；原文持久化失败则必须重试，不能宣称已经归档。
