import importlib.util
import io
import json
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('collector',pathlib.Path(__file__).with_name('maildesk-performance.py'))
collector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

def record():
 return (json.dumps({'log':json.dumps({'type':'maildesk_performance','kind':'slow_sql'})})+'\n').encode()

class CollectorTests(unittest.TestCase):
 def test_large_record_does_not_block_later_records(self):
  source=io.BytesIO(b'x'*150000+b'\n'+record());out=io.StringIO()
  offset,discard=collector.copy_application_records(source,out,0,budget=65536)
  self.assertTrue(discard)
  offset,discard=collector.copy_application_records(source,out,offset,discard=discard)
  self.assertFalse(discard)
  self.assertEqual(json.loads(out.getvalue())['kind'],'slow_sql')
  self.assertEqual(offset,len(source.getvalue()))

 def test_partial_record_waits_for_complete_write(self):
  data=record();out=io.StringIO();source=io.BytesIO(data[:-2])
  offset,discard=collector.copy_application_records(source,out,0)
  self.assertEqual(offset,0);self.assertFalse(discard);self.assertEqual(out.getvalue(),'')
  source=io.BytesIO(data)
  offset,discard=collector.copy_application_records(source,out,offset)
  self.assertEqual(offset,len(data));self.assertEqual(len(out.getvalue().splitlines()),1)

 def test_unrelated_and_invalid_records_are_not_copied(self):
  source=io.BytesIO(b'bad json\n'+json.dumps({'log':'customer content'}).encode()+b'\n'+record());out=io.StringIO()
  collector.copy_application_records(source,out,0)
  self.assertEqual(len(out.getvalue().splitlines()),1)
  self.assertNotIn('customer',out.getvalue())

if __name__=='__main__':unittest.main()
