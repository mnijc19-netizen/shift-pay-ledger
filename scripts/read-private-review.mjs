import { spawnSync } from 'node:child_process';
import { createDecipheriv, privateDecrypt, constants } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const {repository,repositoryId}=JSON.parse(readFileSync(new URL('../src/domain/reviewConfig.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
function command(name,args){
  const r=spawnSync(name,args,{encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});
  if(r.status!==0)throw new Error(name==='gh'?'无法读取私有仓库，请检查本机 GitHub 登录和权限。':'无法解开此 Windows 用户的核对密钥。');
  return r.stdout;
}
const gh=(...args)=>command('gh',['api',...args]);
const info=JSON.parse(gh('repos/'+repository));
if(info.id!==repositoryId||info.full_name.toLowerCase()!==repository||info.private!==true||info.visibility!=='private')throw new Error('目标不是私有核对仓库。');
const tree=JSON.parse(gh('repos/'+repository+'/git/trees/'+encodeURIComponent(info.default_branch),'--method','GET','-f','recursive=1'));
if(tree.truncated)throw new Error('仓库列表不完整，请先核对。');
const files=tree.tree.filter(x=>x.type==='blob'&&/^devices\/[0-9a-f-]{36}\.json$/.test(x.path));
if(process.argv.includes('--list')||!files.length){
  console.log(JSON.stringify({devices:files.map(f=>f.path.slice(8,-5))},null,2));
  process.exit(0);
}
const deviceArg=process.argv.find(x=>x.startsWith('--device='))?.slice(9);
const device=deviceArg??(files.length===1?files[0].path.slice(8,-5):null);
if(!device||!files.some(f=>f.path==='devices/'+device+'.json'))throw new Error('请先用 --list 查看设备，再指定 --device=设备编号。');
const copy=JSON.parse(gh('repos/'+repository+'/contents/devices/'+device+'.json','-H','Accept: application/vnd.github.raw+json'));
if(copy.version!==1||copy.device!==device||!['gzip','none'].includes(copy.compression))throw new Error('核对副本格式不匹配。');

const windowsScript=`
$ErrorActionPreference='Stop'
$path=Join-Path $env:LOCALAPPDATA 'ShiftPay\\private-review.key'
$secure=(Get-Content -LiteralPath $path -Raw).Trim() | ConvertTo-SecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
`;
const privateKey=command('pwsh.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(windowsScript,'utf16le').toString('base64')]);
const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(copy.key,'base64'));
const data=Buffer.from(copy.data,'base64');
const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(copy.iv,'base64'));
decipher.setAAD(Buffer.from(JSON.stringify({version:copy.version,device:copy.device,updatedAt:copy.updatedAt,compression:copy.compression})));
decipher.setAuthTag(data.subarray(-16));
const plain=Buffer.concat([decipher.update(data.subarray(0,-16)),decipher.final()]);
const raw=copy.compression==='gzip'?gunzipSync(plain,{maxOutputLength:20*1024*1024}):plain;
const ledger=JSON.parse(raw);
if(ledger.schema!==1||!Array.isArray(ledger.shifts)||!Array.isArray(ledger.payslips))throw new Error('副本不是班薪记账本。');
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6);
if(out)writeFileSync(out,raw,{flag:'wx'});
console.log(JSON.stringify({device,updatedAt:copy.updatedAt,shifts:ledger.shifts.length,payslips:ledger.payslips.length,exported:!!out},null,2));
