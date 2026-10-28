# Maildesk 改址队列

Maildesk 不再直接向店匠 PUT 地址，也不直接 UPDATE PG 快照。服务端通过专用 `order_address_writer` 连接调用 `public.support_submit_shipping_address_change(text,text,jsonb,jsonb,text,text)`，共用系统的 worker 完成店匠写入、读回核验及所有邮箱快照更新。

## 配置

在服务的数据目录放置 `order-address-writer-credentials.json`，只包含 host、port、database、user、password。文件仅由服务用户读取，权限 0600，不得放入仓库。生产容器读取 `/data/order-address-writer-credentials.json`。连接池最大 4，TLS 开启，按交付约定不验证服务端证书，不混用 connectionString。原订单 reader 池最大 3，保持只读。

缺少配置会禁用改址，不会退回直接店匠写入。旧客户端提交地址备注也会被拒绝，需刷新页面。

## 接口

沿用受认证与邮箱权限保护的 `POST /api/desk/order`：

- `action=read-address`，传 customerId/orderId：读取完整 PG 原地址及最新请求（活动请求优先）。
- `action=update-address`：额外传 patch、完整 expected、idempotencyKey。客服身份取服务器登录身份，不接受客户端 actor。只包含变化字段的 patch 不允许 email。
- `action=address-status`：额外传字符串 requestId，查询时同时绑定店铺和店匠订单 ID。

每个操作都验证客户、订单和邮箱可见范围。数据库业务身份使用快照原值 store_subdomain/order_id，不使用邮箱或展示订单号。提交使用自动提交和参数化 SQL，不持有事务等待 worker。

页面每 3 秒查询活动请求；关闭页面、切换顾客或隐藏页面停止查询。编辑窗口关闭后仍可在订单区域看到状态，刷新后可恢复。提交原参数和 UUID 保存在当前账号对应的浏览器会话存储；网络错误时继续同一请求，不生成新 UUID。

仅 succeeded 显示同步成功；conflict 显示 after_address_json 并由客服核对后重新编辑；failed 重新读取后可创建新请求；uncertain 禁止新请求并等待后台只读核验。发货状态、写权限、特殊税号地址等由共用 worker 执行前实时检查。

成功后清除该订单各 PG 快照及已知旧库别名的本地地址覆盖，保留商品备注、手工运单等其他字段；记录请求号和结果，并清除短时顾客订单缓存。不得修改邮件、付款或物流状态。

## 查询优化

- 订单增量仍为访问触发的 60 秒刷新，水位为成功刷新的开始时间减 60 秒；失败不推进。
- 全量校验间隔改为 6 小时（访问触发），保留删除清理。缓存超过 10 分钟未成功刷新时等待刷新。
- 邮箱反查 Map 覆盖四处归一化邮箱，增量移除旧映射，全量删除失效映射。匹配后仍按 ID 读取详情。
- 同顾客的订单匹配在服务端共享最多 5 秒、上限 100 位顾客；返回独立副本。关联、手工刷新及备注修改会清除缓存；实际发信重新匹配，权限和发件关系仍在服务端验证。
- 管理员可通过已有认证 API `POST /api/desk/order-refresh` 提交 `{"fullIndex":true}` 强制全量重建。普通客服拒绝该操作。不会执行 PG DDL。

## 多运单

解析 fulfillments 的 tracking_number、tracking_items 及 tracking_number_history，去重后当前单号优先。历史号仍可搜索、关联和查看 17TRACK，界面标为历史；回复模板仅使用当前单号。真正拆包的多个当前单号全部保留。

## 验收限制

使用模拟数据库/店匠结果测试提交、冲突、权限、幂等及不确定状态。生产只执行连接检查、元数据和订单只读查询；真实改址验收需指定测试订单，不能用真实顾客订单试写。

## 改址时限

新申请只允许在实际下单后 48 小时内（包含恰好 48 小时）提交。服务端重新读取 PG 原始订单 placed_at / created_at，按带时区时间计算；不使用快照更新时间或浏览器时间。缺少有效时间、未来时间或超过期限均拒绝新申请。已有请求仍可查询；原 UUID 重试仍由共享函数验证输入并返回原请求，不能借此创建新请求。原有未发货、未取消、未完成等实时校验继续由改址 worker 执行。
