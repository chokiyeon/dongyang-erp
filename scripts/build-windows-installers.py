"""Compile native Windows installers; never bundle local credentials or data."""
from pathlib import Path
import os,subprocess,tempfile,shutil,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
compiler=os.environ.get('MAKENSIS') or shutil.which('makensis')
if not compiler:raise SystemExit('Set MAKENSIS to a native NSIS compiler.')
output=ROOT/'downloads';output.mkdir(exist_ok=True)
files=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT).decode().split('\0')
allowed_roots={'src','scripts','prisma','public','client','docs'}
allowed_names={'package.json','package-lock.json','next.config.ts','tsconfig.json','next-env.d.ts','postcss.config.mjs','prisma.config.ts','.env.office.example','.env.example','.gitignore','.gitattributes','README.md','처음읽기.txt'}
forbidden={'node_modules','backups','logs','attachments','downloads','.git','generated'}
with tempfile.TemporaryDirectory(prefix='dongyang-setup-') as tmp:
 payload=Path(tmp)/'payload';payload.mkdir();manifest=[]
 for name in sorted(set(files)):
  if not name:continue
  p=Path(name)
  if any(part in forbidden for part in p.parts):continue
  if p.parts[0] not in allowed_roots and name not in allowed_names and not (len(p.parts)==1 and p.suffix=='.cmd'):continue
  if p.name in {'.env','.env.office','ERP-login.txt'} or p.suffix in {'.dump','.pgdump','.exe','.log'}:continue
  source=ROOT/p
  if not source.is_file() or source.is_symlink():continue
  target=payload/p;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target);manifest.append(name)
 for needed in ['scripts/install-office-runtime.mjs','scripts/install-office-runtime.ps1','package-lock.json','src/lib/auth.ts','prisma/schema.prisma']:
  if needed not in manifest:raise RuntimeError('Required installer payload missing: '+needed)
 assert '.env.office' not in manifest and 'ERP-login.txt' not in manifest
 # Keep a non-secret, reproducible contents manifest in the installer.
 (payload/'installer-files.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
 subprocess.run([compiler,'-V2',f'-DPAYLOAD={payload}',f'-DOUTPUT={output/"ERP.exe"}',str(ROOT/'installer/setup.nsi')],cwd=ROOT,check=True)
 subprocess.run([compiler,'-V2',f'-DCLIENT_SOURCE={ROOT/"client/install-office-client.ps1"}',f'-DOUTPUT={output/"Client.exe"}',str(ROOT/'installer/client.nsi')],cwd=ROOT,check=True)
 for name in ['ERP.exe','Client.exe']:
  p=output/name
  if p.read_bytes()[:2]!=b'MZ':raise RuntimeError('Not a Windows executable: '+name)
  print(f'{name}: {p.stat().st_size:,} bytes SHA256 {hashlib.sha256(p.read_bytes()).hexdigest()}')
 (output/'SHA256.txt').write_text('\n'.join(hashlib.sha256((output/name).read_bytes()).hexdigest()+'  '+name for name in ['ERP.exe','Client.exe'])+'\n',encoding='ascii')
