#!/usr/bin/env python3
"""Remove one redundant raw MIME copy; never remove messages or attachments."""
import argparse
import datetime
import json
import pathlib
import sqlite3
import time

RETENTION_DAYS = 7

def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def run(db, now_ms, apply=False):
    cutoff_ms = now_ms - RETENTION_DAYS * 86400000
    db.execute('BEGIN IMMEDIATE' if apply else 'BEGIN')
    try:
        # Require both durable MIME import and a completed job; preserve all review/retry work.
        # Read only metadata, never fetch the raw BLOB into Python memory.
        row = db.execute('''
        SELECT a.inbox_id,a.provider_id FROM mail_raw_archive a
        JOIN large_mail_jobs j ON j.inbox_id=a.inbox_id AND j.provider_id=a.provider_id
        WHERE a.created_at < ? AND j.status='done' AND j.updated_at < ?
        AND EXISTS (
          SELECT 1 FROM messages m JOIN mime_imports i ON i.message_id=m.id
          WHERE m.inbox_id=a.inbox_id AND m.provider_id=a.provider_id
          AND NOT EXISTS (
            SELECT 1 FROM attachments t LEFT JOIN file_contents f ON f.id=t.storage_key
            WHERE t.message_id=m.id AND (f.id IS NULL OR t.size_bytes IS NULL OR length(f.content)<>t.size_bytes)
          )
        ) LIMIT 1
        ''', (iso(cutoff_ms), cutoff_ms)).fetchone()
        deleted = 0
        if row and apply:
            deleted = db.execute('DELETE FROM mail_raw_archive WHERE inbox_id=? AND provider_id=?', row).rowcount
        db.commit()
        return {'retention_days': RETENTION_DAYS, 'eligible_batch': int(row is not None), 'deleted': deleted}
    except BaseException:
        db.rollback()
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', default='/opt/maildesk/data/maildesk.sqlite')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    path = pathlib.Path(args.database).resolve(strict=True)
    # mode=rw refuses to create an empty database after a path/configuration mistake.
    db = sqlite3.connect(path.as_uri() + ('?mode=rw' if args.apply else '?mode=ro'), uri=True, timeout=1)
    try:
        db.execute('PRAGMA cache_size=-2048')
        db.execute('PRAGMA busy_timeout=1000')
        print(json.dumps(run(db, int(time.time()*1000), args.apply)), flush=True)
    finally:
        db.close()

if __name__ == '__main__':
    main()
