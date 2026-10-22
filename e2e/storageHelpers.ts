import type { Page } from '@playwright/test';
import type { State } from '../src/domain/model';

export async function readRecord<T>(page:Page,key='current'):Promise<T>{
  return page.evaluate(key=>new Promise((resolve,reject)=>{
    const open=indexedDB.open('shift-pay-ledger',1);
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{const db=open.result,request=db.transaction('ledger','readonly').objectStore('ledger').get(key);request.onsuccess=()=>{resolve(request.result);db.close();};request.onerror=()=>{reject(request.error);db.close();};};
  }),key) as Promise<T>;
}
export const readLedger=(page:Page)=>readRecord<State>(page);
export async function writeLedger(page:Page,state:State){
  await page.evaluate(state=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open('shift-pay-ledger',1);
    open.onsuccess=()=>{const db=open.result,tx=db.transaction('ledger','readwrite');tx.objectStore('ledger').put(state,'current');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};open.onerror=()=>reject(open.error);
  }),state);
}
