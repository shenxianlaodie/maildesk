#!/usr/bin/env python3
import argparse,datetime,fcntl,json,os,pathlib,re,shutil,subprocess,time
P=pathlib.Path

def run(*args):return subprocess.check_output(args,text=True).strip()
def containers():
 ids=run('docker','ps','-aq').split()
 return json.loads(run('docker','inspect',*ids)) if ids else []
def plan(cs):
 live=next(c for c in cs if c['Name']=='/maildesk')
 assert live['State'].get('Health',{}).get('Status')=='healthy','maildesk not healthy'
 started=datetime.datetime.fromisoformat(re.sub(r'(\.\d{6})\d+',r'\1',live['State']['StartedAt']).replace('Z','+00:00'))
 assert time.time()-started.timestamp()>300,'wait for five minutes of stable operation'
 old=sorted([c for c in cs if c['Name'].startswith('/maildesk-before-')],key=lambda c:c['Created'],reverse=True)
 keep=[live]+old[:2]
 return live,keep,[c for c in old[2:] if c['State']['Status']=='exited']
def main():
 a=argparse.ArgumentParser();a.add_argument('mode',choices=['npm','extensions','releases','logs']);a.add_argument('--apply',action='store_true');args=a.parse_args()
 lock=open('/run/maildesk-maintenance.lock','w');fcntl.flock(lock,fcntl.LOCK_EX)
 if args.mode in ['npm','extensions']:
  paths=['/root/.npm/_cacache'] if args.mode=='npm' else ['/root/.vscode-server/data/CachedExtensionVSIXs','/root/.cursor-server/data/CachedExtensionVSIXs']
  for name in paths:
   p=P(name);assert p.resolve()==p and not p.is_symlink()
   if p.is_dir():
    print(json.dumps({'cache':name,'apply':args.apply}),flush=True)
    if args.apply:shutil.rmtree(p)
 elif args.mode=='logs':
  if args.apply:subprocess.run(['journalctl','--vacuum-time=14d','--vacuum-size=512M'],check=True)
 else:
  cs=containers();live,keep,remove=plan(cs);keepimages={c['Image'] for c in keep}
  print(json.dumps({'keep':[c['Name'] for c in keep],'remove_containers':[c['Name'] for c in remove],'apply':args.apply}),flush=True)
  def unchanged():
   now=json.loads(run('docker','inspect','maildesk'))[0]
   assert now['Id']==live['Id'] and now['State'].get('Health',{}).get('Status')=='healthy','deployment changed; abort cleanup'
  if args.apply:
   for c in remove:
    unchanged();subprocess.run(['docker','rm',c['Id']],check=True,stdout=subprocess.DEVNULL)
  remaining=containers() if args.apply else [c for c in cs if c not in remove]
  referenced={c['Image'] for c in remaining}|keepimages
  tags=[]
  for line in run('docker','image','ls','--format','{{.Repository}}:{{.Tag}} {{.ID}}','--no-trunc').splitlines():
   tag,i=line.split()
   if tag.startswith('maildesk:') and '<none>' not in tag and i not in referenced:
    created=json.loads(run('docker','image','inspect',i))[0]['Created']
    stamp=datetime.datetime.fromisoformat(re.sub(r'(\.\d{6})\d+',r'\1',created).replace('Z','+00:00')).timestamp()
    if time.time()-stamp>86400:tags.append(tag)
  print(json.dumps({'remove_image_tags':tags}),flush=True)
  if args.apply:
   for tag in tags:
    unchanged();subprocess.run(['docker','image','rm',tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if args.apply:
   for image in {c['Image'] for c in remove}-referenced:
    unchanged();subprocess.run(['docker','image','rm',image],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  # Only build directories with explicit version tags and no nested data are eligible.
  kepttags={c['Config']['Image'] for c in keep};dirs=[]
  for p in P('/opt/maildesk').iterdir():
   if p.is_symlink() or not p.is_dir() or not re.fullmatch(r'[a-z][a-z0-9-]+-\d{10}',p.name):continue
   if not (p/'Dockerfile').is_file() or 'maildesk:'+p.name in kepttags:continue
   files=list(p.iterdir())
   if any(x.is_symlink() or not x.is_file() or x.suffix in ['.sqlite','.db','.pem'] or x.stat().st_size>2000000 for x in files):continue
   if time.time()-p.stat().st_mtime<86400:continue
   dirs.append(str(p))
  print(json.dumps({'remove_build_directories':dirs}),flush=True)
  if args.apply:
   for name in dirs:
    unchanged();p=P(name);assert p.resolve().parent==P('/opt/maildesk');shutil.rmtree(p)
if __name__=='__main__':main()
