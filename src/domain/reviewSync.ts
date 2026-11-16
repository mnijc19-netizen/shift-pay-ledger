import config from './reviewConfig.json';
import type { State } from './model';

export const reviewRepository = config.repository;
const api = 'https://api.github.com/repos/' + reviewRepository;
const settingsKey = 'shift-pay:private-review:v1';
export const validReviewToken = (token:string) => /^github_pat_[A-Za-z0-9_]+$/.test(token);
export type ReviewConnection = { token:string; device:string };
const encoder = new TextEncoder();

export function readReviewConnection():ReviewConnection|null {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey) || 'null') as ReviewConnection|null;
    return saved && validReviewToken(saved.token) && /^[0-9a-f-]{36}$/.test(saved.device) ? saved : null;
  } catch { return null; }
}
export function storeReviewConnection(connection:ReviewConnection|null) {
  if(connection) localStorage.setItem(settingsKey,JSON.stringify(connection));
  else localStorage.removeItem(settingsKey);
}
function base64(buffer: ArrayBuffer|Uint8Array) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for(let i=0;i<bytes.length;i+=16384) binary += String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(binary);
}
async function request(token:string, path:string, signal:AbortSignal, method='GET', body?:string) {
  const response=await fetch(api+path,{
    method, body, signal, redirect:'error', cache:'no-store', credentials:'omit',
    headers:{Authorization:'Bearer '+token,Accept:path.startsWith('/contents/')&&method==='GET'?'application/vnd.github.object+json':'application/vnd.github+json','Content-Type':'application/json'},
  });
  if(response.status===401||response.status===403)throw new Error('GitHub 授权失效或权限不足，请检查私有仓库的 Contents 读写权限。');
  return response;
}
export async function verifyReviewRepository(token:string, signal:AbortSignal) {
  if(!validReviewToken(token))throw new Error('请使用 GitHub 的细粒度访问令牌。');
  if(!crypto.subtle)throw new Error('当前浏览器无法加密，请使用 HTTPS 打开班薪记。');
  const response=await request(token,'',signal);
  if(!response.ok)throw new Error('无法访问指定的私有仓库，请检查令牌授权范围。');
  const repo=await response.json();
  if(repo.id!==config.repositoryId||repo.full_name?.toLowerCase()!==reviewRepository||repo.private!==true||repo.visibility!=='private'||repo.archived||repo.disabled)throw new Error('核对仓库不是预期的可写私有仓库，已停止上传。');
  if(typeof repo.default_branch!=='string'||!repo.default_branch)throw new Error('无法确认私有仓库分支，已停止上传。');
  return repo.default_branch as string;
}
export async function encryptReviewCopy(state:State, device:string, publicKey:JsonWebKey=config.publicKey,inboxSecret?:string) {
  const payload=encoder.encode(JSON.stringify(inboxSecret?{...state,reviewInboxSecret:inboxSecret}:state));
  if(payload.byteLength>20*1024*1024)throw new Error('账本超过核对副本的大小限制，请先导出本地备份。');
  const compression=typeof CompressionStream==='function'?'gzip':'none';
  const plain=compression==='gzip'?await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer():payload;
  const metadata={version:1,device,updatedAt:new Date().toISOString(),compression};
  const rsa=await crypto.subtle.importKey('jwk',publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const [data,wrapped]=await Promise.all([
    crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(JSON.stringify(metadata))},key,plain),
    crypto.subtle.exportKey('raw',key).then(raw=>crypto.subtle.encrypt({name:'RSA-OAEP'},rsa,raw)),
  ]);
  return {...metadata,iv:base64(iv),key:base64(wrapped),data:base64(data)};
}
export async function publishReviewCopy(connection:ReviewConnection, state:State, signal:AbortSignal) {
  const branch=await verifyReviewRepository(connection.token,signal);
  const copy=await encryptReviewCopy(state,connection.device,config.publicKey,inboxSecret(connection.device));
  const path='/contents/devices/'+connection.device+'.json';
  const content=base64(encoder.encode(JSON.stringify(copy)));
  for(let attempt=0;attempt<2;attempt++){
    const current=await request(connection.token,path+'?ref='+encodeURIComponent(branch),signal);
    if(!current.ok&&current.status!==404)throw new Error('无法检查现有核对副本，保留上一次上传。');
    const sha=current.ok?(await current.json()).sha:undefined;
    if(current.ok&&typeof sha!=='string')throw new Error('核对副本格式异常，已停止覆盖。');
    const response=await request(connection.token,path,signal,'PUT',JSON.stringify({message:'Update encrypted review copy',branch,content,...(sha?{sha}:{})}));
    if(response.ok)return copy.updatedAt;
    if(response.status!==409&&response.status!==422)break;
  }
  throw new Error('私有副本上传失败，请检查网络和仓库的 Contents 读写权限。');
}

const adjustmentLink = /^#review=([0-9a-f-]{36})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;
const decodeBase64 = (value:string) => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),letter=>letter.charCodeAt(0));

const randomId=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encodedKey=/^[A-Za-z0-9+/]{43}=$/;
export const inboxAuditAction='接收私有账本更新';
export const inboxReceipt=(state:State,id:string)=>state.audit.some(entry=>entry.action===inboxAuditAction&&entry.note===id);

function inboxSecret(device:string){
  const storageKey='shift-pay:review-inbox-key:'+device;
  const saved=localStorage.getItem(storageKey);
  if(saved&&encodedKey.test(saved))return saved;
  const created=base64(crypto.getRandomValues(new Uint8Array(32)));
  localStorage.setItem(storageKey,created);
  return created;
}

async function bootstrapKey(state:State,device:string,fingerprints:string[]){
  // An existing encrypted copy and its originating browser already share these random record IDs.
  const ids=new Set([...state.shifts,...state.audit,...state.snapshots].map(record=>record.id).filter(id=>randomId.test(id)));
  const found=new Map<string,string>();
  for(const id of ids){
    const fingerprint=base64(await crypto.subtle.digest('SHA-256',encoder.encode('shift-pay-id-v1/'+id)));
    if(fingerprints.includes(fingerprint))found.set(fingerprint,id);
    if(found.size===fingerprints.length)break;
  }
  if(found.size!==fingerprints.length)throw new Error('这笔更新与本机账本不匹配，请重新上传本机账本。');
  return new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(
    'shift-pay-inbox-bootstrap-v1/'+device+'/'+fingerprints.map(value=>found.get(value)).join('/'))));
}

export async function readReviewInbox(connection:ReviewConnection,state:State,signal:AbortSignal){
  const branch=await verifyReviewRepository(connection.token,signal);
  const response=await request(connection.token,'/contents/inbox/'+connection.device+'.json?ref='+encodeURIComponent(branch),signal);
  if(response.status===404)return null;
  if(!response.ok)throw new Error('暂时无法接收账本更新。');
  const file=await response.json();
  if(file.encoding!=='base64'||typeof file.content!=='string'||file.content.length>1400000)throw new Error('账本更新文件无效。');
  const envelope=JSON.parse(new TextDecoder().decode(decodeBase64(file.content)));
  const {version,device,id,bootstrap,iv,data,signature}=envelope;
  if(version!==1||device!==connection.device||!randomId.test(id)||typeof iv!=='string'||typeof data!=='string'||
      typeof signature!=='string'||bootstrap!==null&&(!Array.isArray(bootstrap)||bootstrap.length!==2||
      new Set(bootstrap).size!==2||!bootstrap.every(value=>typeof value==='string'&&encodedKey.test(value))))throw new Error('账本更新文件无效。');
  if(inboxReceipt(state,id))return null;
  const metadata={version,device,id,bootstrap,iv};
  const verificationKey=await crypto.subtle.importKey('jwk',{
    kty:config.publicKey.kty,n:config.publicKey.n,e:config.publicKey.e,
  },{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const signed=encoder.encode(JSON.stringify({...metadata,data}));
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',verificationKey,decodeBase64(signature),signed)){
    throw new Error('未能验证账本更新的签名。');
  }
  const rawKey=bootstrap?await bootstrapKey(state,device,bootstrap):decodeBase64(inboxSecret(device));
  const key=await crypto.subtle.importKey('raw',rawKey,'AES-GCM',false,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decodeBase64(iv),
    additionalData:encoder.encode(JSON.stringify(metadata))},key,decodeBase64(data));
  return {id,input:JSON.parse(new TextDecoder().decode(plain)) as unknown};
}

export async function readReviewAdjustment(hash:string, signal:AbortSignal):Promise<unknown> {
  const match=adjustmentLink.exec(hash);
  if(!match)throw new Error('核对链接格式无效。');
  const [,device,id,secret]=match;
  const connection=readReviewConnection();
  if(connection?.device!==device)throw new Error('请用平时记考勤并已开启私有核对的浏览器打开此链接。');

  const branch=await verifyReviewRepository(connection.token,signal);
  const path='/contents/adjustments/'+device+'/'+id+'.json?ref='+encodeURIComponent(branch);
  const response=await request(connection.token,path,signal);
  if(!response.ok)throw new Error('暂时无法读取核对补录，请联网后重新打开链接。');
  const file=await response.json();
  if(file.encoding!=='base64'||typeof file.content!=='string'||file.size>1024*1024)throw new Error('核对补录文件格式无效。');
  const envelope=JSON.parse(new TextDecoder().decode(decodeBase64(file.content)));
  if(envelope.version!==1||typeof envelope.iv!=='string'||typeof envelope.data!=='string')throw new Error('核对补录文件格式无效。');

  const key=await crypto.subtle.importKey('raw',decodeBase64(secret),'AES-GCM',false,['decrypt']);
  const plain=await crypto.subtle.decrypt({
    name:'AES-GCM',
    iv:decodeBase64(envelope.iv),
    additionalData:encoder.encode('shift-pay-review-v1/'+device+'/'+id),
  },key,decodeBase64(envelope.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
