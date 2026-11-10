#!/usr/bin/env python3
import pathlib,json,time,subprocess,urllib.request,datetime,os
P=pathlib.Path

def read(path):return P(path).read_text().strip()
def pairs(path):return dict(l.split(None,1) for l in read(path).splitlines())
def pressure(kind):return {l.split()[0]:{k:float(v) for k,v in (x.split('=') for x in l.split()[1:])} for l in read('/proc/pressure/'+kind).splitlines()}
def processes():
 out={}
 for p in P('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   d=pairs(p/'io');out[p.name]={'name':read(p/'comm'),'read':int(d['read_bytes:']),'write':int(d['write_bytes:'])}
  except (OSError,ValueError,KeyError):pass
 return out
def copy_application_records(source,out,offset,discard=False,budget=1024*1024):
 source.seek(offset);used=0
 while used<budget:
  pos=source.tell();line=source.readline(65536)
  if not line:break
  if not line.endswith(b'\n'):
   if len(line)<65536 and not discard:source.seek(pos);break
   discard=True;used+=len(line);continue
  used+=len(line)
  if discard:discard=False;continue
  try:
   record=json.loads(json.loads(line)['log'])
   if isinstance(record,dict) and record.get('type')=='maildesk_performance':out.write(json.dumps(record,separators=(',',':'))+'\n')
  except (ValueError,KeyError,TypeError):pass
 return source.tell(),discard

def main():
 started=time.time();row={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'load':list(os.getloadavg()),'pressure':{k:pressure(k) for k in ['cpu','memory','io']}}
 mem=pairs('/proc/meminfo');row['memory_kb']={k:int(mem[k+':'].split()[0]) for k in ['MemTotal','MemAvailable','SwapTotal','SwapFree']};v=os.statvfs('/');row['disk_available_bytes']=v.f_bavail*v.f_frsize
 try:
  c=json.loads(subprocess.check_output(['docker','inspect','maildesk'],text=True,timeout=4))[0];row['container']={'id':c['Id'][:12],'health':c['State'].get('Health',{}).get('Status'),'restarts':c['RestartCount']}
  pid=c['State']['Pid'];cg=P('/sys/fs/cgroup')/read('/proc/'+str(pid)+'/cgroup').split(':',2)[2].lstrip('/')
  for name in ['cpu.stat','memory.events','pids.events']:
   row['container'][name]={k:int(v) for k,v in pairs(cg/name).items()}
  for name in ['memory.current','memory.max','memory.swap.current','pids.current','pids.max']:
   row['container'][name]=read(cg/name)
 except Exception as e:row['container_error']=type(e).__name__
 dev=os.stat('/').st_dev;disk={}
 for line in read('/proc/diskstats').splitlines():
  f=line.split()
  if int(f[0])==os.major(dev) and int(f[1])==os.minor(dev):disk={'device':f[2],'read_bytes':int(f[5])*512,'write_bytes':int(f[9])*512,'busy_ms':int(f[12])}
 current=processes();state=P('/run/maildesk-performance-state.json');prior={}
 try:prior=json.loads(state.read_text())
 except (OSError,ValueError):pass
 if prior:
  dt=max(.1,started-prior['at']);deltas=[]
  if disk and prior.get('disk',{}).get('device')==disk['device']:
   old=prior['disk'];row['root_disk_io']={'device':disk['device'],'read_Bps':round((disk['read_bytes']-old['read_bytes'])/dt),'write_Bps':round((disk['write_bytes']-old['write_bytes'])/dt),'busy_pct':round((disk['busy_ms']-old['busy_ms'])/dt/10,1)}
  for pid,p in current.items():
   old=prior['processes'].get(pid)
   if old and old['name']==p['name']:
    r=max(0,p['read']-old['read']);w=max(0,p['write']-old['write'])
    if r+w:deltas.append({'pid':int(pid),'name':p['name'],'read_Bps':round(r/dt),'write_Bps':round(w/dt)})
  row['top_io']=sorted(deltas,key=lambda p:p['read_Bps']+p['write_Bps'],reverse=True)[:5]
 app_cursor={}
 try:
  logpath=P(c['LogPath']);stat=logpath.stat();old=prior.get('app_cursor',{});offset=old.get('offset',0) if old.get('inode')==stat.st_ino and old.get('container')==c['Id'] and old.get('offset',0)<=stat.st_size else 0
  applog=P('/var/log/maildesk-performance/application.jsonl')
  if applog.exists() and applog.stat().st_size>16*1024*1024:applog.replace(applog.with_suffix('.jsonl.overflow'))
  with logpath.open('rb') as source,applog.open('a') as out:
   offset,discard=copy_application_records(source,out,offset,discard=bool(old.get('discard',False)) if offset else False)
   app_cursor={'inode':stat.st_ino,'container':c['Id'],'offset':offset,'discard':discard}
 except (OSError,KeyError,NameError):pass
 state.write_text(json.dumps({'at':started,'processes':current,'disk':disk,'app_cursor':app_cursor}))
 row['probes']=[]
 for name,url in [('app','http://127.0.0.1:4175/'),('gateway','http://127.0.0.1:4182/maildesk/')]:
  t=time.monotonic();p={'name':name}
  try:
   headers={'Host':'chat.thinkpro.top','X-Forwarded-Proto':'https'} if name=='gateway' else {}
   with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=3) as r:p['status']=r.status;r.read(1)
  except urllib.error.HTTPError as e:p['status']=e.code
  except Exception as e:p['error']=type(e).__name__
  p['ms']=round((time.monotonic()-t)*1000);row['probes'].append(p)
 row['incident']=row.get('container',{}).get('health')!='healthy' or any(p.get('ms',0)>=2000 or p.get('error') or p.get('status')!=200 for p in row['probes']) or row['pressure']['io']['full']['avg10']>=20
 log=P('/var/log/maildesk-performance/resources.jsonl')
 # Hard bound even if rotation is delayed: keep one 16 MiB resource log backup.
 if log.exists() and log.stat().st_size>16*1024*1024:log.replace(log.with_suffix('.jsonl.overflow'))
 with log.open('a') as f:f.write(json.dumps(row,separators=(',',':'))+'\n')
 print(json.dumps({'recorded':True,'incident':row['incident'],'probes':row['probes']}))

if __name__=='__main__':main()
