PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shops(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inboxes(
 id TEXT PRIMARY KEY, address TEXT NOT NULL UNIQUE, provider TEXT NOT NULL CHECK(provider='zoho'),
 account_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inbox_shops(
 inbox_id TEXT NOT NULL REFERENCES inboxes(id), shop_id TEXT NOT NULL REFERENCES shops(id),
 PRIMARY KEY(inbox_id,shop_id)
);
CREATE TABLE IF NOT EXISTS customers(
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS staff(
 id TEXT PRIMARY KEY, display_name TEXT NOT NULL, ding_user_id TEXT UNIQUE,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS messages(
 id TEXT PRIMARY KEY, inbox_id TEXT NOT NULL REFERENCES inboxes(id), provider_id TEXT NOT NULL,
 customer_id TEXT NOT NULL REFERENCES customers(id), direction TEXT NOT NULL CHECK(direction IN('inbound','outbound')),
 rfc_message_id TEXT, in_reply_to TEXT, subject TEXT NOT NULL DEFAULT '', body_text TEXT NOT NULL DEFAULT '',
 from_address TEXT NOT NULL, to_addresses TEXT NOT NULL, sent_at TEXT NOT NULL,
 replied_by TEXT REFERENCES staff(id), category TEXT NOT NULL DEFAULT '待确认', subcategory TEXT NOT NULL DEFAULT '订单待核实',
 provider_folder_id TEXT, synced_at TEXT NOT NULL, UNIQUE(inbox_id,provider_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_customer_sent ON messages(customer_id,sent_at);
CREATE INDEX IF NOT EXISTS idx_messages_rfc ON messages(rfc_message_id);
CREATE TABLE IF NOT EXISTS attachments(
 id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id), provider_id TEXT NOT NULL,
 filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER CHECK(size_bytes>=0),
 storage_key TEXT, UNIQUE(message_id,provider_id)
);
CREATE TABLE IF NOT EXISTS orders(
 id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shops(id), provider_id TEXT NOT NULL,
 order_number TEXT NOT NULL, customer_id TEXT REFERENCES customers(id), currency TEXT NOT NULL,
 total_amount TEXT NOT NULL, paid_amount TEXT, refunded_amount TEXT,
 payment_method TEXT, financial_status TEXT NOT NULL DEFAULT 'unknown', fulfillment_status TEXT NOT NULL DEFAULT 'unknown',
 placed_at TEXT, provider_updated_at TEXT, synced_at TEXT NOT NULL,
 dissatisfaction TEXT NOT NULL DEFAULT '待核实', UNIQUE(shop_id,provider_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
CREATE TABLE IF NOT EXISTS shipments(
 order_id TEXT NOT NULL REFERENCES orders(id), tracking_number TEXT NOT NULL, carrier TEXT,
 PRIMARY KEY(order_id,tracking_number)
);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_number);
CREATE TABLE IF NOT EXISTS order_links(
 customer_id TEXT NOT NULL REFERENCES customers(id), order_id TEXT NOT NULL REFERENCES orders(id),
 message_id TEXT REFERENCES messages(id), linked_by TEXT NOT NULL REFERENCES staff(id), created_at TEXT NOT NULL,
 PRIMARY KEY(customer_id,order_id)
);
CREATE TABLE IF NOT EXISTS customer_work(
 customer_id TEXT PRIMARY KEY REFERENCES customers(id), assignee_id TEXT REFERENCES staff(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','done')),
 draft TEXT NOT NULL DEFAULT '', reply_inbox_id TEXT REFERENCES inboxes(id), revision INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS labels(
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, tone TEXT NOT NULL CHECK(tone IN('light','medium','strong'))
);
CREATE TABLE IF NOT EXISTS customer_labels(
 customer_id TEXT NOT NULL REFERENCES customers(id), label_id TEXT NOT NULL REFERENCES labels(id), PRIMARY KEY(customer_id,label_id)
);
CREATE TABLE IF NOT EXISTS templates(
 id TEXT PRIMARY KEY, title TEXT NOT NULL, keywords TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refund_proposals(
 order_id TEXT PRIMARY KEY REFERENCES orders(id), percent TEXT NOT NULL, basis TEXT NOT NULL CHECK(basis IN('paid','remaining')),
 calculated_amount TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES staff(id), updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_runs(
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, source_id TEXT NOT NULL, status TEXT NOT NULL,
 started_at TEXT NOT NULL, completed_at TEXT, processed INTEGER NOT NULL DEFAULT 0,
 error_code TEXT
);
CREATE TABLE IF NOT EXISTS audit_events(
 id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES staff(id), action TEXT NOT NULL,
 entity_id TEXT NOT NULL, created_at TEXT NOT NULL, metadata TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS imap_skips(inbox_id TEXT NOT NULL REFERENCES inboxes(id),provider_id TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(inbox_id,provider_id));

CREATE TABLE IF NOT EXISTS outgoing(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),parent_id TEXT NOT NULL REFERENCES messages(id),recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES staff(id),created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS message_reads(message_id TEXT PRIMARY KEY REFERENCES messages(id),read_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assignment_rules(inbox_id TEXT PRIMARY KEY REFERENCES inboxes(id),staff_id TEXT NOT NULL REFERENCES staff(id));

CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS file_contents(id TEXT PRIMARY KEY,content BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS outgoing_files(outgoing_id TEXT NOT NULL REFERENCES outgoing(id),file_index INTEGER NOT NULL,filename TEXT NOT NULL,content BLOB NOT NULL,PRIMARY KEY(outgoing_id,file_index));
CREATE TABLE IF NOT EXISTS mime_imports(message_id TEXT PRIMARY KEY REFERENCES messages(id));

CREATE TABLE IF NOT EXISTS ai_jobs(message_id TEXT PRIMARY KEY REFERENCES messages(id),status TEXT NOT NULL DEFAULT 'pending',reason TEXT,confidence REAL,error_code TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_at TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS outgoing_routes(outgoing_id TEXT PRIMARY KEY REFERENCES outgoing(id),inbox_id TEXT NOT NULL REFERENCES inboxes(id),from_address TEXT NOT NULL,shop_id TEXT,order_id TEXT);

CREATE TABLE IF NOT EXISTS order_feedback(order_id TEXT PRIMARY KEY REFERENCES orders(id),reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES staff(id),updated_at TEXT NOT NULL);
