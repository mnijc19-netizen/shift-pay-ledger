import type { State } from './model';

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const identity=(v:unknown)=>object(v)?typeof v.id==='string'?v.id:typeof v.date==='string'?v.date:undefined:undefined;
function changed(a:unknown,b:unknown):{before:unknown;after:unknown}|undefined{
  if(JSON.stringify(a)===JSON.stringify(b))return;
  if(Array.isArray(a)&&Array.isArray(b)&&[...a,...b].every(v=>identity(v)!==undefined)){
    const old=new Map(a.map(v=>[identity(v),v])),next=new Map(b.map(v=>[identity(v),v]));
    return {before:a.filter(v=>JSON.stringify(v)!==JSON.stringify(next.get(identity(v)))),after:b.filter(v=>JSON.stringify(v)!==JSON.stringify(old.get(identity(v))))};
  }
  if(object(a)&&object(b)){
    const before:Record<string,unknown>={},after:Record<string,unknown>={};
    for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
      const delta=changed(a[key],b[key]);if(!delta)continue;
      if(delta.before!==undefined)before[key]=delta.before;if(delta.after!==undefined)after[key]=delta.after;
    }
    return {before,after};
  }
  return {before:a,after:b};
}
export function diffs(before:State,after:State){
  const previous:Record<string,unknown>={},next:Record<string,unknown>={};
  for(const key of ['rules','shifts','cycles','payslips','snapshots'] as const){
    const delta=changed(before[key],after[key]);if(!delta)continue;previous[key]=delta.before;next[key]=delta.after;
  }
  return {format:'changes-v1' as const,before:JSON.stringify(previous),after:JSON.stringify(next)};
}
export function compactAuditEntries(entries:State['audit']):State['audit']{
  return entries.map(entry=>{
    if(entry.format==='changes-v1')return entry;
    try{
      const a:unknown=JSON.parse(entry.before),b:unknown=JSON.parse(entry.after);if(!object(a)||!object(b))return entry;
      const delta=changed(a,b)??{before:{},after:{}};
      return {...entry,format:'changes-v1',before:JSON.stringify(delta.before),after:JSON.stringify(delta.after)};
    }catch{return entry;}
  });
}
