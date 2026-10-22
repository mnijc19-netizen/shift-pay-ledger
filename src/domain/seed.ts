import type { Rules, Shift, Cycle, State } from './model';
import { deductionNames, numeric, uid } from './model';
import { civilMs, nextDate, stamp } from './dates';
import { calculate, dec, splitShift, sum } from './engine';
import { statutoryCalendar2026 } from './policy';
export const calendarSource='https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm';
export const defaultRules:Rules={version:4,updatedAt:'2026-10-22',fuzhouPolicy:true,hireDate:'2026-09-24',employee:'trial',base:'2195',otBase:'2195',otDays:'21.75',standardHours:'8',baseDays:'21.75',normalRate:'1.5',restRate:'2',holidayRate:'3',system:'standard',cycleEnd:25,split:false,rounding:'halfUp',mealMinutes:'0',deductShort:false,shortMinutes:'10',post:'100',postEnabled:true,postProrate:true,meal:'400',mealProrate:true,mealMethod:'card',dayMeal:'10',night:'25',heat:'50',heatProrate:true,performance:'',trialRatio:'60',performanceMethod:'manual',midTrial:'100',midRegular:'200',nationalTrial:'150',nationalRegular:'300',calendar:structuredClone(statutoryCalendar2026)};
export function newShift(date:string,r:Rules,type:Shift['type']='day'):Shift{
  const night=type==='night';return {id:uid(),ruleVersion:r.version,date,type,start:date+(night?'T20:00':'T08:00'),end:(night?nextDate(date):date)+(night?'T08:00':'T20:00'),mealMinutes:r.mealMinutes,mealOffset:'240',deductShort:r.deductShort,shortMinutes:r.shortMinutes,break1:'180',break2:'540',paidHours:'',ot:'unknown',useCalendar:true,overrides:{},dayMeal:false,nightAllowance:night,nightAmount:'',allowanceConfirmed:false,source:'manual',draft:false,note:''};
}
export type QuickType='day'|'night'|'rest';
export function quickShift(date:string,r:Rules,type:QuickType,hours='12',previous?:Shift):Shift{
  if(type!=='rest')numeric.parse(hours);
  const paid=type==='rest'?dec(0):dec(hours);
  if(type!=='rest'&&(!paid.gt(0)||paid.gt(24)||!paid.mul(60).isInteger()))throw new Error('工时须大于 0、不超过 24 小时，并精确到分钟，例如 8、11.5、12。');
  if(previous&&previous.date===date&&previous.type===type&&!previous.draft){
    const before=sum(splitShift(previous,r).segments.map(x=>x.hours));
    if(type==='rest'||before.eq(paid))return previous;
  }
  const fresh=newShift(date,r,type);
  const start=previous?.type===type?date+previous.start.slice(10):fresh.start;
  const end=type==='rest'?fresh.end:stamp(civilMs(start)+paid.mul(3600000).toNumber());
  return {...fresh,...(previous??{}),date,type,start,end,
    ruleVersion:r.version,mealMinutes:'0',deductShort:false,paidHours:type==='rest'?'0':paid.toString(),overrides:{},
    ot:type==='rest'?'unknown':previous&&previous.ot!=='unknown'?previous.ot:'normal',useCalendar:previous?.useCalendar??true,
    nightAllowance:type!=='rest'&&(type==='night'||civilMs(end)>civilMs(date+'T22:00')),dayMeal:type==='day'&&(previous?.dayMeal??false),allowanceConfirmed:false,source:'manual',draft:false,
    note:[previous?.note,`快捷录入：${type==='night'?'夜班':type==='rest'?'休息':'白班'}，${type==='rest'?'0':paid.toString()} 小时；吃饭不扣工时。`].filter(Boolean).join('；')};
}
export function newCycle(month:string,r:Rules):Cycle{return {month,confirmedRuleVersion:r.version,insuranceMode:r.fuzhouPolicy&&month>='2026-10'?'minimum':'manual',mode:'full',expectedDays:r.baseDays,paidDays:r.baseDays,denominator:'',baseActual:'',baseConfirmed:false,postEnabled:true,postConfirmed:false,mealEnabled:true,mealConfirmed:false,mealDuplicateChecked:false,heatEnabled:false,heatActual:'',heatConfirmed:false,performanceActual:'',performanceConfirmed:false,midGift:false,midConfirmed:false,nationalGift:false,nationalConfirmed:false,deductions:deductionNames.map((name,i)=>({id:'d'+i,name,actual:'',base:'',rate:'',confirmed:false,note:''})),extras:[]};}
export function initialState():State{
  const r=structuredClone(defaultRules),historical=newCycle('2026-09',r);
  Object.assign(historical,{mode:'partial',denominator:'23',insuranceMode:'manual',paidDays:'1',expectedDays:'23',baseConfirmed:true,postConfirmed:true,mealEnabled:false,heatEnabled:true,heatConfirmed:true,performanceActual:'68.25',performanceConfirmed:true,midGift:true,midConfirmed:true});
  const holiday={...newShift('2026-09-25',r,'holiday'),id:'history-midautumn',ot:'holiday' as const,paidHours:'11.5',dayMeal:true,allowanceConfirmed:true,source:'payslip' as const,note:'工资条确认 11.5 计薪小时；08:00–20:00 为待核实的参考时段。'};
  const state:State={schema:1,startDateBasisApplied:true,rules:r,shifts:[{...newShift('2026-09-24',r,'onboarding'),id:'hire',note:'入职办理；不推定工时。'},holiday,{...newShift('2026-10-04',r,'short'),id:'cleaning',end:'2026-10-04T16:00',paidHours:'8',mealMinutes:'0',note:'已知清洁 8 小时；08:00–16:00 为参考时段，加班归类待确认。'}, {...newShift('2026-10-05',r,'night'),id:'switch',draft:true,note:'已知转夜班；具体上下班时间未确认，作为草稿保留。'}, {...newShift('2026-10-08',r,'night'),id:'night-known',note:'已知 20:00 至次日 08:00；加班类型和津贴待核验。'}, {...newShift('2026-10-12',r,'pendingRest'),id:'rest-pending',note:'原计划休息，系统误标缺勤；未扣薪。'}],cycles:{'2026-09':historical},payslips:[{id:'historical-slip',month:'2026-09',actualNet:'',confirmed:false,note:'用户提供的历史工资条验收数据；七项合计 ¥715.42，实际银行到账尚未提供。',rows:[['base','基本工资','95.43'],['ot-holiday','中秋节加班费','435.22'],['performance','绩效奖金','68.25'],['post','岗位津贴','4.35'],['day-meal','晚餐补贴','10.00'],['heat','高温补贴','2.17'],['mid-gift','中秋节礼金','100.00']].map(([key,name,amount],i)=>({id:'history-row-'+i,key,name,amount,confirmed:true,note:''}))}],snapshots:[],audit:[]};
  state.snapshots.push({id:'historical-original',month:'2026-09',savedAt:'2026-10-22T00:00:00+08:00',rules:structuredClone(r),cycle:structuredClone(historical),shifts:structuredClone(state.shifts.filter(s=>s.date<='2026-09-25')),result:calculate(r,historical,state.shifts),payslip:structuredClone(state.payslips[0])});
  return state;
}
