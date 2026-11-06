import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
const args=['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/install-office-app.ps1','-Quiet'];
const legacy=process.env.ERP_INSTALL_LEGACY_ROOT;if(legacy&&existsSync(join(legacy,'.env.office')))args.push('-ReplaceFromRoot',legacy);
const r=spawnSync('powershell.exe',args,{stdio:'inherit',windowsHide:true});process.exit(r.status??1);
