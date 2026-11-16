import importlib.util
import pathlib
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location('cleanup', pathlib.Path(__file__).with_name('maildesk-raw-mail-cleanup.py'))
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)

class CleanupTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript('''
        CREATE TABLE mail_raw_archive(inbox_id TEXT,provider_id TEXT,source BLOB,created_at TEXT);
        CREATE TABLE large_mail_jobs(inbox_id TEXT,provider_id TEXT,status TEXT,updated_at INTEGER);
        CREATE TABLE messages(id TEXT,inbox_id TEXT,provider_id TEXT);
        CREATE TABLE mime_imports(message_id TEXT);
        CREATE TABLE attachments(message_id TEXT,storage_key TEXT,size_bytes INTEGER);
        CREATE TABLE file_contents(id TEXT,content BLOB);
        ''')
        self.now = 1794787200000

    def add(self, key, status='done', age=10, imported=True, attachment=True):
        at = self.now - age * 86400000
        self.db.execute('INSERT INTO mail_raw_archive VALUES(?,?,?,?)', ('i',key,b'original',cleanup.iso(at)))
        self.db.execute('INSERT INTO large_mail_jobs VALUES(?,?,?,?)', ('i',key,status,at))
        self.db.execute('INSERT INTO messages VALUES(?,?,?)',(key,'i',key))
        if imported:
            self.db.execute('INSERT INTO mime_imports VALUES(?)',(key,))
        self.db.execute('INSERT INTO attachments VALUES(?,?,?)',(key,key,4))
        if attachment:
            self.db.execute('INSERT INTO file_contents VALUES(?,?)',(key,b'file'))
        self.db.commit()

    def test_delete_only_old_complete_import_one_per_run(self):
        self.add('old');self.add('old2')
        self.add('recent',age=2);self.add('failed',status='archived')
        self.add('incomplete',imported=False);self.add('missing-file',attachment=False)
        result=cleanup.run(self.db,self.now,apply=True)
        self.assertEqual(result['deleted'],1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM messages').fetchone()[0],6)
        self.assertEqual(self.db.execute('SELECT count(*) FROM file_contents').fetchone()[0],5)
        remaining={r[0] for r in self.db.execute('SELECT provider_id FROM mail_raw_archive')}
        self.assertTrue({'recent','failed','incomplete','missing-file'}.issubset(remaining))

    def test_dry_run_does_not_delete(self):
        self.add('old')
        self.assertEqual(cleanup.run(self.db,self.now,apply=False)['eligible_batch'],1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM mail_raw_archive').fetchone()[0],1)

    def test_recent_completion_and_corrupt_attachment_preserved(self):
        self.add('recent-completion');self.add('bad-file')
        self.db.execute('UPDATE large_mail_jobs SET updated_at=? WHERE provider_id=?',(self.now,'recent-completion'))
        self.db.execute("UPDATE file_contents SET content=x'00' WHERE id='bad-file'")
        self.db.commit()
        self.assertEqual(cleanup.run(self.db,self.now,apply=True)['deleted'],0)

if __name__ == '__main__':
    unittest.main()
