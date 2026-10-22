import type { State } from './model';

export const DATABASE_NAME='shift-pay-ledger';
export const STORE_NAME='ledger';
export const CURRENT_KEY='current';
export const LEGACY_BACKUP_KEY='legacy-localStorage-v1';
let connection:Promise<IDBDatabase>|undefined;

function database():Promise<IDBDatabase>{
  if(connection)return connection;
  connection=new Promise<IDBDatabase>((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('此浏览器未提供本地数据库'));return;}
    const request=indexedDB.open(DATABASE_NAME,1);let blocked=false;
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE_NAME))request.result.createObjectStore(STORE_NAME);};
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>{blocked=true;reject(new Error('本地数据库被其他旧页面占用，请关闭同一账本的其他页面后重试'));};
    request.onsuccess=()=>{
      const db=request.result;if(blocked){db.close();return;}
      db.onversionchange=()=>{db.close();connection=undefined;};
      db.onclose=()=>{connection=undefined;};resolve(db);
    };
  }).catch(error=>{connection=undefined;throw error;});
  return connection;
}
export async function readStoredRecord(key:string):Promise<unknown>{
  const db=await database();
  return new Promise((resolve,reject)=>{
    const request=db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).get(key);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function writeStoredLedger(state:State,legacyRaw?:string):Promise<void>{
  const db=await database();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(STORE_NAME,'readwrite'),store=transaction.objectStore(STORE_NAME);
    // Request success is not enough: report saved only after the whole transaction commits.
    transaction.oncomplete=()=>resolve();
    transaction.onerror=transaction.onabort=()=>reject(transaction.error??new DOMException('保存事务未完成','AbortError'));
    try{store.put(state,CURRENT_KEY);if(legacyRaw!==undefined)store.put(legacyRaw,LEGACY_BACKUP_KEY);}
    catch(error){transaction.abort();reject(error);}
  });
}
