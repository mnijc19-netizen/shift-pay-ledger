import { stateSchema, uid } from './model';
import type { State, PayResult, Shift, Payslip } from './model';
import { defaultRules, initialState } from './seed';
import { statutoryCalendar2026 } from './policy';
import { calculate, splitShift, validateAttendance } from './engine';
import { period } from './dates';
import { compactAuditEntries } from './audit';
import { CURRENT_KEY, LEGACY_BACKUP_KEY, readStoredRecord, writeStoredLedger } from './browserStore';
export const STORAGE_KEY='shift-pay:v1';
export function parseBackup(raw:string):State{
  if(raw.length>20*1024*1024)throw new Error('备份超过 20MB，请检查文件。');
  return validateLedger(JSON.parse(raw));
}
function validateLedger(value:unknown):State{
  const state=stateSchema.parse(value);
  validateAttendance(state.shifts);
  for(const [month,cycle] of Object.entries(state.cycles)){if(month!==cycle.month)throw new Error('周期键与周期月份不一致');calculate(state.rules,cycle,state.shifts);}
  for(const s of state.shifts)splitShift(s,state.rules);
  const unique=(ids:string[],name:string)=>{if(new Set(ids).size!==ids.length)throw new Error(name+'存在重复 ID');};
  unique(state.rules.calendar.map(x=>x.date),'日历日期');unique(state.payslips.map(x=>x.month),'工资条周期');
  unique(state.payslips.map(x=>x.id),'工资条');unique(state.snapshots.map(x=>x.id),'快照');
  for(const c of Object.values(state.cycles)){unique(c.extras.map(x=>x.id),'收入');unique(c.deductions.map(x=>x.id),'扣款');}
  for(const c of Object.values(state.cycles))unique(c.deductions.filter(x=>['养老保险','医疗保险','失业保险','住房公积金'].includes(x.name)).map(x=>x.name),'五险一金项目');
  for(const p of state.payslips){unique(p.rows.map(x=>x.id),'工资条项目');const keys=p.rows.map(x=>x.key).filter(Boolean);unique(keys,'工资条映射');if(keys.includes('night-meal')&&keys.some(k=>k.startsWith('night-')&&k!=='night-meal'))throw new Error('夜班餐补合计与逐班映射重复');}
  return state;
}
export function upgradeFuzhouPolicy(state:State):State{
  if(state.rules.fuzhouPolicy)return state;
  const before=JSON.stringify({rules:state.rules,cycles:state.cycles}),previous=structuredClone(state.rules);
  for(const cycle of Object.values(state.cycles)){
    if(cycle.month<'2026-10'){
      // Freeze the pre-update result for completed historical periods before changing defaults.
      if(!state.snapshots.some(s=>s.month===cycle.month))state.snapshots.push({id:uid(),month:cycle.month,savedAt:new Date().toISOString(),rules:structuredClone(previous),cycle:structuredClone(cycle),shifts:structuredClone(state.shifts.filter(s=>{const p=period(cycle.month,previous.cycleEnd);return s.date>=p.start&&s.date<=p.end;})),result:calculate(previous,cycle,state.shifts),payslip:structuredClone(state.payslips.find(p=>p.month===cycle.month))});
      cycle.denominator ||= previous.baseDays;
    }else cycle.insuranceMode='minimum';
  }
  const keys=['base','otBase','otDays','standardHours','baseDays','normalRate','restRate','holidayRate','system','mealMinutes','deductShort','split'] as const;
  state.rules={...state.rules,...Object.fromEntries(keys.map(k=>[k,defaultRules[k]])),fuzhouPolicy:true,version:previous.version+1,updatedAt:new Date().toISOString(),calendar:[...statutoryCalendar2026.filter(d=>!previous.calendar.some(p=>p.date===d.date)),...previous.calendar]};
  state.audit.push({id:uid(),at:new Date().toISOString(),action:'启用福州法定标准',note:'2026-10-22核验；当前预测按2195元、五天八小时、21.75天及最低个人缴费参考；实际扣款和历史快照保留。',before,after:JSON.stringify({rules:state.rules,cycles:state.cycles})});
  return state;
}
export function upgradeStartDateBasis(state:State):State{
  if(state.startDateBasisApplied)return state;
  const before=JSON.stringify({rules:state.rules,startDateBasisApplied:state.startDateBasisApplied});
  state.rules={...state.rules,split:false,version:state.rules.version+1,updatedAt:new Date().toISOString()};
  state.startDateBasisApplied=true;
  state.audit.push({id:uid(),at:new Date().toISOString(),action:'整班按上班日计薪',note:'按用户指定：整班使用开始上班日期的工资类型，过零点不换倍率；工时、实际金额、手动修正和历史快照保留。',before,after:JSON.stringify({rules:state.rules,startDateBasisApplied:true})});
  return state;
}
export function upgradeMealCard(state:State):State{
  if(state.rules.mealMethod==='card')return state;
  const before=JSON.stringify({rules:state.rules});
  state.rules={...state.rules,mealMethod:'card',version:state.rules.version+1,updatedAt:new Date().toISOString()};
  state.audit.push({id:uid(),at:new Date().toISOString(),action:'月餐补确认为饭卡福利',note:'用户确认：每月400元充入饭卡，不计应发或实发工资；夜班餐补仍计入工资。原工资条、实际金额、历史快照保留。',before,after:JSON.stringify({rules:state.rules})});
  return state;
}
export const upgradeSavedState=(state:State)=>upgradeMealCard(upgradeStartDateBasis(upgradeFuzhouPolicy(state)));
export interface LoadResult {state:State;error:string;raw:string}
export function storageErrorMessage(error:unknown){
  const e=error as {name?:string;message?:string};
  return e?.name==='QuotaExceededError'?'设备可用存储空间不足，本次没有保存。已保存记录仍保留，请先导出备份，释放空间后重试。':`本地数据库保存失败，本次没有改动已保存记录：${e?.message||String(error)}`;
}
export async function load():Promise<LoadResult>{
  let raw='';
  try{
    const stored=await readStoredRecord(CURRENT_KEY);
    if(stored!==undefined){
      raw=JSON.stringify(stored);const state=upgradeSavedState(validateLedger(stored));state.audit=compactAuditEntries(state.audit);
      if(JSON.stringify(state)!==raw)await persist(state);
      return {state,error:'',raw:''};
    }
    raw=localStorage.getItem(STORAGE_KEY)||'';
    const state=raw?upgradeSavedState(parseBackup(raw)):initialState();state.audit=compactAuditEntries(state.audit);
    // Current ledger and the byte-for-byte legacy backup commit atomically, before releasing the old key.
    await writeStoredLedger(state,raw||undefined);
    if(raw)try{if(localStorage.getItem(STORAGE_KEY)===raw)localStorage.removeItem(STORAGE_KEY);}catch{/* The committed database is authoritative; an old duplicate can remain. */}
    return {state,error:'',raw:''};
  }catch(error){
    if(!raw)try{raw=localStorage.getItem(STORAGE_KEY)||'';}catch{/* A blocked storage API must not overwrite existing data. */}
    return {state:initialState(),error:'本地账本暂时无法打开，原记录未覆盖。'+storageErrorMessage(error),raw};
  }
}
export async function persist(state:State){await writeStoredLedger(state);}
export async function exportLegacyBackup(){
  const raw=await readStoredRecord(LEGACY_BACKUP_KEY);
  if(typeof raw!=='string')throw new Error('没有旧版迁移备份；请使用完整备份导出当前账本。');
  download('班薪记-升级前原始备份.json',raw);
}
export function download(name:string,text:string,type='application/json'){
  const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const cell=(v:unknown)=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
export const csv=(rows:unknown[][])=>'\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
export function ledgerCsv(result:PayResult){return csv([['项目','金额（元）','确认状态','发放形式','来源','公式','输入','工时','单价（未取整）','原始金额','考勤来源ID','是否扣款'],...result.items.map(i=>[i.name,i.amount,i.confirmed?'已确认':'预计',i.method,i.source,i.formula,i.inputs,i.hours,i.rate,i.raw,i.shiftIds.join(';'),i.deduction?'是':'否'])]);}
export function attendanceCsv(shifts:Shift[],month:string,cycleEnd:number){const p=period(month,cycleEnd);return csv([['归属日期','类型','上班','下班','手动计薪工时','吃饭分钟','加班类型','草稿','备注'],...shifts.filter(s=>s.date>=p.start&&s.date<=p.end).map(s=>[s.date,s.type,s.start,s.end,s.paidHours,s.mealMinutes,s.ot,s.draft?'是':'否',s.note])]);}
export function payslipCsv(p:Payslip){return csv([['周期','项目','金额','确认','映射','备注'],...p.rows.map(r=>[p.month,r.name,r.amount,r.confirmed?'是':'否',r.key,r.note]),[p.month,'实际到账',p.actualNet,p.confirmed?'是':'否','',p.note]]);}
