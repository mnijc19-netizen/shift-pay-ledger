import { spawnSync } from 'node:child_process';
import { createDecipheriv, createCipheriv, createHash, privateDecrypt, constants, randomBytes, randomUUID, sign } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const {repository,repositoryId}=JSON.parse(readFileSync(new URL('../src/domain/reviewConfig.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
function command(name,args,input,env=process.env){
  const r=spawnSync(name,args,{encoding:'utf8',input,env,maxBuffer:64*1024*1024,windowsHide:true});
  if(r.status!==0)throw new Error(name==='gh'?'无法读取或更新私有仓库，请检查本机 GitHub 登录和权限。':'无法解开此 Windows 用户的核对密钥。');
  return r.stdout;
}
const ghEnv={...process.env};
if(!ghEnv.GH_TOKEN&&!ghEnv.GITHUB_TOKEN&&spawnSync('gh',['auth','status','--hostname','github.com'],{stdio:'ignore',windowsHide:true}).status!==0){
  const credential=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,
    env:{...process.env,GCM_INTERACTIVE:'Never',GIT_TERMINAL_PROMPT:'0'}});
  const token=credential.stdout?.match(/^password=(.+)$/m)?.[1];
  if(credential.status===0&&token)ghEnv.GH_TOKEN=token;
}
const gh=(...args)=>command('gh',['api',...args],undefined,ghEnv);
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
$path=$env:SHIFT_PAY_REVIEW_KEY_FILE
if(!$path){$path=Join-Path $env:LOCALAPPDATA 'ShiftPay\\private-review.key'}
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
const inboxSecret=ledger.reviewInboxSecret;
delete ledger.reviewInboxSecret;
const inboxPath='inbox/'+device+'.json';
const inboxReceipt=id=>ledger.audit.some(entry=>entry.action==='接收私有账本更新'&&entry.note===id);
const queue=process.argv.find(arg=>arg.startsWith('--queue='))?.slice(8);
if(queue){
  const file=readFileSync(queue);
  if(file.length>256*1024)throw new Error('本次更新超过 256 KB，请拆成较小的更新。');
  if(!['shift-pay-review-v1','shift-pay-changes-v1'].includes(JSON.parse(file).kind))throw new Error('无法识别账本更新类型。');
  const previous=tree.tree.find(entry=>entry.path===inboxPath);
  const endpoint='repos/'+repository+'/contents/'+inboxPath;
  if(previous){
    const envelope=JSON.parse(gh(endpoint,'-H','Accept: application/vnd.github.raw+json'));
    if(!inboxReceipt(envelope.id))throw new Error('手机还没有回传上一笔更新的保存回执。');
  }
  let bootstrap=null;
  let inboxKey;
  if(typeof inboxSecret==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(inboxSecret)){
    inboxKey=Buffer.from(inboxSecret,'base64');
  }else{
    const randomId=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const keys=[...new Set([...ledger.snapshots,...ledger.shifts,...ledger.audit].map(record=>record.id).filter(id=>randomId.test(id)))].slice(0,2);
    if(keys.length!==2)throw new Error('旧副本缺少安全接收更新所需的记录，请先打开原网址完成新版同步。');
    bootstrap=keys.map(id=>createHash('sha256').update('shift-pay-id-v1/'+id).digest('base64'));
    inboxKey=createHash('sha256').update('shift-pay-inbox-bootstrap-v1/'+device+'/'+keys.join('/')).digest();
  }
  const iv=randomBytes(12);
  const metadata={version:1,device,id:randomUUID(),bootstrap,iv:iv.toString('base64')};
  const cipher=createCipheriv('aes-256-gcm',inboxKey,iv);
  cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  const data=Buffer.concat([cipher.update(file),cipher.final(),cipher.getAuthTag()]).toString('base64');
  const envelope={...metadata,data};
  const signature=sign('sha256',Buffer.from(JSON.stringify(envelope)),privateKey).toString('base64');
  const content=Buffer.from(JSON.stringify({...envelope,signature})).toString('base64');
  command('gh',['api',endpoint,'--method','PUT','--input','-'],JSON.stringify({
    message:'Queue encrypted ledger update',branch:info.default_branch,content,...(previous?{sha:previous.sha}:{}),
  }),ghEnv);
  console.log(JSON.stringify({device,queued:metadata.id,updatedAt:copy.updatedAt}));
  process.exit(0);
}
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6);
if(out)writeFileSync(out,JSON.stringify(ledger),{flag:'wx'});
const receipts=ledger.audit.filter(entry=>entry.action==='接收私有账本更新').map(entry=>entry.note);
console.log(JSON.stringify({device,updatedAt:copy.updatedAt,shifts:ledger.shifts.length,payslips:ledger.payslips.length,exported:!!out,receipts},null,2));
