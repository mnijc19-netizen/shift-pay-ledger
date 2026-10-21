import { stateSchema } from './model';
import type { State, PayResult, Shift, Payslip } from './model';
import { initialState } from './seed';
import { calculate, splitShift, validateAttendance } from './engine';
import { period } from './dates';
export const STORAGE_KEY='shift-pay:v1';
export function parseBackup(raw:string):State{
  if(raw.length>20*1024*1024)throw new Error('备份超过 20MB，请检查文件。');
  const state=stateSchema.parse(JSON.parse(raw));
  validateAttendance(state.shifts);
  for(const [month,cycle] of Object.entries(state.cycles)){if(month!==cycle.month)throw new Error('周期键与周期月份不一致');calculate(state.rules,cycle,state.shifts);}
  for(const s of state.shifts)splitShift(s,state.rules);
  const unique=(ids:string[],name:string)=>{if(new Set(ids).size!==ids.length)throw new Error(name+'存在重复 ID');};
  unique(state.rules.calendar.map(x=>x.date),'日历日期');unique(state.payslips.map(x=>x.month),'工资条周期');
  unique(state.payslips.map(x=>x.id),'工资条');unique(state.snapshots.map(x=>x.id),'快照');
  for(const c of Object.values(state.cycles)){unique(c.extras.map(x=>x.id),'收入');unique(c.deductions.map(x=>x.id),'扣款');}
  for(const p of state.payslips){unique(p.rows.map(x=>x.id),'工资条项目');const keys=p.rows.map(x=>x.key).filter(Boolean);unique(keys,'工资条映射');}
  return state;
}
export function load():{state:State;error:string;raw:string}{
  let raw='';
  try{raw=localStorage.getItem(STORAGE_KEY)||'';return {state:raw?parseBackup(raw):initialState(),error:'',raw:''};}
  catch(e){return {state:initialState(),error:'本地数据读取失败，原始内容未覆盖。请先导出原始数据，再通过备份恢复。'+String(e),raw};}
}
export function persist(state:State){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
export function download(name:string,text:string,type='application/json'){
  const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const cell=(v:unknown)=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
export const csv=(rows:unknown[][])=>'\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
export function ledgerCsv(result:PayResult){return csv([['项目','金额（元）','确认状态','发放形式','来源','公式','输入','工时','单价（未取整）','原始金额','考勤来源ID','是否扣款'],...result.items.map(i=>[i.name,i.amount,i.confirmed?'已确认':'预计',i.method,i.source,i.formula,i.inputs,i.hours,i.rate,i.raw,i.shiftIds.join(';'),i.deduction?'是':'否'])]);}
export function attendanceCsv(shifts:Shift[],month:string,cycleEnd:number){const p=period(month,cycleEnd);return csv([['归属日期','类型','上班','下班','手动计薪工时','吃饭分钟','加班类型','草稿','备注'],...shifts.filter(s=>s.date>=p.start&&s.date<=p.end).map(s=>[s.date,s.type,s.start,s.end,s.paidHours,s.mealMinutes,s.ot,s.draft?'是':'否',s.note])]);}
export function payslipCsv(p:Payslip){return csv([['周期','项目','金额','确认','映射','备注'],...p.rows.map(r=>[p.month,r.name,r.amount,r.confirmed?'是':'否',r.key,r.note]),[p.month,'实际到账',p.actualNet,p.confirmed?'是':'否','',p.note]]);}
