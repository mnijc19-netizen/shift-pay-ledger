import type { Rules, Shift, Cycle, State } from './model';
import { deductionNames, uid } from './model';
import { nextDate } from './dates';
import { calculate } from './engine';
export const calendarSource='https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm';
export const defaultRules:Rules={version:1,updatedAt:'2026-10-22',hireDate:'2026-09-24',employee:'trial',base:'2195',otBase:'2195',otDays:'21.75',standardHours:'8',baseDays:'23',normalRate:'1.5',restRate:'2',holidayRate:'3',system:'unknown',cycleEnd:25,split:true,rounding:'halfUp',mealMinutes:'30',deductShort:false,shortMinutes:'10',post:'100',postEnabled:true,postProrate:true,meal:'400',mealProrate:true,mealMethod:'unknown',dayMeal:'10',night:'25',heat:'50',heatProrate:true,performance:'',trialRatio:'60',performanceMethod:'manual',midTrial:'100',midRegular:'200',nationalTrial:'150',nationalRegular:'300',calendar:[
  {date:'2026-09-25',type:'statutory',label:'中秋节',source:calendarSource},
  ...['2026-09-26','2026-09-27'].map(date=>({date,type:'holidayBreak' as const,label:'中秋连续休假',source:calendarSource})),
  ...['2026-10-01','2026-10-02','2026-10-03'].map(date=>({date,type:'statutory' as const,label:'国庆节',source:'https://www.gov.cn/gongbao/2024/issue_11726/material/gwygb202433.pdf'})),
  ...['2026-10-04','2026-10-05','2026-10-06','2026-10-07'].map(date=>({date,type:'holidayBreak' as const,label:'国庆连续休假',source:calendarSource})),
  ...['2026-09-20','2026-10-10'].map(date=>({date,type:'makeup' as const,label:'官方调休上班',source:calendarSource}))
]};
export function newShift(date:string,r:Rules,type:Shift['type']='day'):Shift{
  const night=type==='night';return {id:uid(),ruleVersion:r.version,date,type,start:date+(night?'T20:00':'T08:00'),end:(night?nextDate(date):date)+(night?'T08:00':'T20:00'),mealMinutes:r.mealMinutes,mealOffset:'240',deductShort:r.deductShort,shortMinutes:r.shortMinutes,break1:'180',break2:'540',paidHours:'',ot:'unknown',useCalendar:true,overrides:{},dayMeal:false,nightAllowance:night,nightAmount:'',allowanceConfirmed:false,source:'manual',draft:false,note:''};
}
export function newCycle(month:string,r:Rules):Cycle{return {month,confirmedRuleVersion:r.version,mode:'full',expectedDays:r.baseDays,paidDays:r.baseDays,denominator:'',baseActual:'',baseConfirmed:false,postEnabled:true,postConfirmed:false,mealEnabled:true,mealConfirmed:false,mealDuplicateChecked:false,heatEnabled:false,heatActual:'',heatConfirmed:false,performanceActual:'',performanceConfirmed:false,midGift:false,midConfirmed:false,nationalGift:false,nationalConfirmed:false,deductions:deductionNames.map((name,i)=>({id:'d'+i,name,actual:'',base:'',rate:'',confirmed:false,note:''})),extras:[]};}
export function initialState():State{
  const r=structuredClone(defaultRules),historical=newCycle('2026-09',r);
  Object.assign(historical,{mode:'partial',paidDays:'1',expectedDays:'23',baseConfirmed:true,postConfirmed:true,mealEnabled:false,heatEnabled:true,heatConfirmed:true,performanceActual:'68.25',performanceConfirmed:true,midGift:true,midConfirmed:true});
  const holiday={...newShift('2026-09-25',r,'holiday'),id:'history-midautumn',ot:'holiday' as const,paidHours:'11.5',dayMeal:true,allowanceConfirmed:true,source:'payslip' as const,note:'工资条确认 11.5 计薪小时；08:00–20:00 为待核实的参考时段。'};
  const state:State={schema:1,rules:r,shifts:[{...newShift('2026-09-24',r,'onboarding'),id:'hire',note:'入职办理；不推定工时。'},holiday,{...newShift('2026-10-04',r,'short'),id:'cleaning',end:'2026-10-04T16:00',paidHours:'8',mealMinutes:'0',note:'已知清洁 8 小时；08:00–16:00 为参考时段，加班归类待确认。'}, {...newShift('2026-10-05',r,'night'),id:'switch',draft:true,note:'已知转夜班；具体上下班时间未确认，作为草稿保留。'}, {...newShift('2026-10-08',r,'night'),id:'night-known',note:'已知 20:00 至次日 08:00；加班类型和津贴待核验。'}, {...newShift('2026-10-12',r,'pendingRest'),id:'rest-pending',note:'原计划休息，系统误标缺勤；未扣薪。'}],cycles:{'2026-09':historical},payslips:[{id:'historical-slip',month:'2026-09',actualNet:'',confirmed:false,note:'用户提供的历史工资条验收数据；七项合计 ¥715.42，实际银行到账尚未提供。',rows:[['base','基本工资','95.43'],['ot-holiday','中秋节加班费','435.22'],['performance','绩效奖金','68.25'],['post','岗位津贴','4.35'],['day-meal','晚餐补贴','10.00'],['heat','高温补贴','2.17'],['mid-gift','中秋节礼金','100.00']].map(([key,name,amount],i)=>({id:'history-row-'+i,key,name,amount,confirmed:true,note:''}))}],snapshots:[],audit:[]};
  state.snapshots.push({id:'historical-original',month:'2026-09',savedAt:'2026-10-22T00:00:00+08:00',rules:structuredClone(r),cycle:structuredClone(historical),shifts:structuredClone(state.shifts.filter(s=>s.date<='2026-09-25')),result:calculate(r,historical,state.shifts),payslip:structuredClone(state.payslips[0])});
  return state;
}
