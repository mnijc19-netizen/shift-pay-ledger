import Decimal from 'decimal.js';
import type { Rules, Shift, Cycle, PayItem, PayResult, OT, Payslip } from './model';
import { otLabels } from './model';
import { civilMs, nextDate, period, monthOf } from './dates';
import { insuranceReference, isLateMealEligible } from './policy';

export const D = Decimal.clone({precision:40, rounding:Decimal.ROUND_HALF_UP});
export const dec=(v:Decimal.Value)=>new D(v);
export const sum=(values:Decimal.Value[])=>values.reduce<Decimal>((a,b)=>a.plus(b),dec(0));
export const money=(v:Decimal.Value,rounding:Rules['rounding']='halfUp')=>dec(v).toFixed(2,rounding==='halfUp'?D.ROUND_HALF_UP:D.ROUND_DOWN);
export const hourly=(r:Rules)=>dec(r.otBase).div(r.otDays).div(r.standardHours);
export const nonWork=(s:Shift)=>['rest','paidLeave','unpaidLeave','absence','pendingRest','onboarding'].includes(s.type);

export interface Segment {date:string; start:string; end:string; hours:string; type:OT; normal:string; overtime:string; raw:string}
export function splitShift(s:Shift,r:Rules,normalUsedBefore:Decimal.Value='0'):{segments:Segment[];warnings:string[]}{
  if(nonWork(s)||s.draft) return {segments:[],warnings:[]};
  const start=civilMs(s.start),end=civilMs(s.end);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>36*3600000) throw new Error('班次起止时间无效');
  // Merge break intervals so overlapping breaks can never be deducted twice.
  const breaks:[[number,number],...Array<[number,number]>]=[[start+Number(s.mealOffset)*60000,start+(Number(s.mealOffset)+Number(s.mealMinutes))*60000]];
  if(s.deductShort) for(const offset of [s.break1,s.break2]) breaks.push([start+Number(offset)*60000,start+(Number(offset)+Number(s.shortMinutes))*60000]);
  const merged:Array<[number,number]>=[];
  for(const [a,b] of breaks.map(([a,b])=>[Math.max(start,a),Math.min(end,b)] as [number,number]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0])){
    const last=merged.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else merged.push([a,b]);
  }
  const rows:Array<{date:string;start:string;end:string;hours:Decimal}>=[];
  for(let cursor=start;cursor<end;){
    const day=new Date(cursor).toISOString().slice(0,10),boundary=Math.min(end,civilMs(nextDate(day)+'T00:00'));
    const unpaid=merged.reduce((n,[a,b])=>n+Math.max(0,Math.min(boundary,b)-Math.max(cursor,a)),0);
    rows.push({date:day,start:new Date(cursor).toISOString().slice(11,16),end:new Date(boundary).toISOString().slice(11,16),hours:dec(boundary-cursor-unpaid).div(3600000)});cursor=boundary;
  }
  const physical=sum(rows.map(x=>x.hours));
  const paid=s.paidHours!==''?dec(s.paidHours):physical;
  const allocationBase=physical.isZero()&&s.paidHours!==''?dec(end-start).div(3600000):physical;
  if(paid.gt(dec(end-start).div(3600000)))throw new Error('计薪工时不能超过实际班次时长');
  const warnings:string[]=[];
  if(s.paidHours!==''&&rows.length>1&&r.split)warnings.push(`${s.date}：手动计薪工时按各日期原计薪时长比例分配，可在分段修正中指定。`);
  const exact=rows.map(row=>s.overrides[row.date]?.hours??'');
  if(exact.some(x=>x!=='')){
    if(exact.some(x=>x===''))throw new Error('手动拆分工时须填写每个日期');
    if(!sum(exact).eq(paid))throw new Error(`分段工时合计须等于总计薪工时 ${paid.toString()}`);
  }
  let normalUsed=dec(normalUsedBefore),allocated=dec(0);
  const segments=rows.map((row,index):Segment=>{
    const weight=physical.isZero()?dec(civilMs(row.date+'T'+(row.end==='00:00'?'23:59':row.end))-civilMs(row.date+'T'+row.start)).div(3600000).plus(row.end==='00:00'?dec(1).div(60):0):row.hours;
    const h=exact.every(x=>x!=='')?dec(exact[index]):index===rows.length-1?paid.minus(allocated):allocationBase.isZero()?dec(0):weight.div(allocationBase).mul(paid);
    if(h.gt(dec(civilMs(row.date+'T'+(row.end==='00:00'?'23:59':row.end))-civilMs(row.date+'T'+row.start)).div(3600000).plus(row.end==='00:00'?dec(1).div(60):0)))throw new Error('分段工时不能超过该日期实际时段');
    allocated=allocated.plus(h);
    const day=r.split?row.date:s.date;
    const entry=r.calendar.find(x=>x.date===day);
    let type:OT=s.ot;
    if(s.useCalendar){
      if(entry?.type==='statutory')type='holiday';
      else if(entry?.type==='personalRest'&&s.ot!=='compensated')type='rest';
      else if(r.fuzhouPolicy&&r.system==='standard'){
        const weekend=[0,6].includes(new Date(day+'T00:00:00Z').getUTCDay());
        const rest=entry?.type==='holidayBreak'||weekend&&entry?.type!=='makeup'&&entry?.type!=='ordinary';
        if(rest&&s.ot!=='compensated')type='rest';
        else if(!rest&&s.ot==='unknown')type='normal';
      }
    }
    type=s.overrides[row.date]?.type??type;
    const normal=type==='normal'?D.min(h,D.max(0,dec(r.standardHours).minus(normalUsed))):dec(0);
    normalUsed=normalUsed.plus(normal);
    const overtime=type==='normal'?h.minus(normal):['rest','holiday'].includes(type)?h:dec(0);
    if(type==='unknown'&&h.gt(0))warnings.push(`${row.date}：加班类型待确认，暂未计加班费。`);
    const rate=type==='holiday'?r.holidayRate:type==='rest'?r.restRate:r.normalRate;
    return {date:row.date,start:row.start,end:row.end,hours:h.toString(),type,normal:normal.toString(),overtime:overtime.toString(),raw:overtime.mul(hourly(r)).mul(rate).toString()};
  });
  return {segments,warnings};
}

export function analyzeShifts(shifts:Shift[],r:Rules){
  const results=new Map<string,ReturnType<typeof splitShift>>(),normalByDate=new Map<string,Decimal>();
  for(const s of shifts.slice().sort((a,b)=>a.start.localeCompare(b.start))){
    const used=normalByDate.get(s.date)??dec(0),out=splitShift(s,r,used);
    normalByDate.set(s.date,used.plus(sum(out.segments.map(x=>x.normal))));results.set(s.id,out);
  }
  return results;
}

export function calculate(r:Rules,c:Cycle,all:Shift[]):PayResult{
  const bounds=period(c.month,r.cycleEnd),items:PayItem[]=[],warnings:string[]=[];
  const seen=new Set<string>();
  const shifts=all.filter(s=>s.date>=bounds.start&&s.date<=bounds.end&&!s.draft).filter(s=>{if(seen.has(s.id)){warnings.push('重复考勤 ID 已忽略。');return false;}seen.add(s.id);return true;});
  const add=(item:Omit<PayItem,'raw'|'amount'>,value:Decimal.Value)=>items.push({...item,raw:dec(value).toString(),amount:money(value,r.rounding)});
  const basic=(id:string,name:string,confirmed:boolean,formula:string,inputs:string,source:PayItem['source']='auto'):Omit<PayItem,'raw'|'amount'>=>({id,name,confirmed,formula,inputs,source:!confirmed&&source==='payslip'?'pending':source,hours:'',rate:'',shiftIds:[],method:'cash',deduction:false});
  const verified=c.confirmedRuleVersion===r.version;
  if(!verified)warnings.push('规则版本已变化：依赖旧规则计算的确认金额已转为预计，请重新核验；历史快照保持原值。');
  const denominator=c.denominator||r.baseDays;
  const factor=c.mode==='partial'?dec(c.paidDays).div(denominator):dec(1);
  const base=c.baseActual!==''?dec(c.baseActual):c.mode==='manual'?dec(0):dec(r.base).mul(factor);
  add(basic('base','基本工资',c.baseConfirmed&&(c.baseActual!==''||verified),c.baseActual!==''?'本期实际基本工资':c.mode==='partial'?`${r.base} ÷ ${denominator} × ${c.paidDays}`:c.mode==='manual'?'待录入实际基本工资':`${r.base} × 1`,c.mode==='partial'?`应计薪 ${c.expectedDays} 天；实际 ${c.paidDays} 天；折算分母 ${denominator}`:'完整周期工资假设；普通班次正常工时已包含',c.baseActual!==''?'payslip':'auto'),base);
  if(c.mode==='manual'&&c.baseActual==='')warnings.push('基本工资采用实际录入模式，但本期金额未填写。');
  if(c.mode==='full')warnings.push('基本工资按完整周期预测；未录入日期不会自动算作已出勤，缺勤扣款需另行确认。');
  if(r.hireDate>bounds.start&&c.mode==='full')warnings.push('入职日处于本周期内，请确认基本工资是否应按部分周期折算。');
  if(r.system!=='standard')warnings.push(r.system==='unknown'?'工时制度尚不确定，当前按手动加班类型估算，需核实公司制度。':'综合计算工时制需核实审批与结算周期；逐班结果仅作估算，可用调整项目修正。');
  if(r.fuzhouPolicy&&r.system==='standard'&&shifts.some(s=>!s.date.startsWith('2026-')))warnings.push('该年份的官方节假日、调休表尚未内置；仅按周末参考，请补充日期后核算，不能认定法定加班费完整。');
  if(shifts.some(s=>['absence','unpaidLeave','pendingRest'].includes(s.type)))warnings.push('存在缺勤、无薪假或休息待确认记录；未自动扣薪，请录入有依据的实际扣款。');
  const groups=new Map<string,{h:Decimal;raw:Decimal;ids:string[];type:OT;confirmed:boolean}>();
  const hours:Record<string,string>={normal:'0',rest:'0',holiday:'0',compensated:'0',unknown:'0'};
  const analyses=analyzeShifts(shifts,r);
  for(const s of shifts){
    if(nonWork(s))continue;
    if(s.source==='payslip'&&s.ruleVersion!==r.version)warnings.push(`${s.date}：工时已确认，但规则版本已变化，重算的加班费需重新核验。`);
    const out=analyses.get(s.id)!;warnings.push(...out.warnings);
    for(const seg of out.segments){
      hours[seg.type]=dec(hours[seg.type]).plus(['unknown','compensated'].includes(seg.type)?seg.hours:seg.overtime).toString();
      if(!dec(seg.overtime).gt(0))continue;
      const confirmed=s.source==='payslip'&&s.ruleVersion===r.version;
      const key=`ot-${seg.type}-${confirmed?'confirmed':'expected'}`;
      const g=groups.get(key)??{h:dec(0),raw:dec(0),ids:[],type:seg.type,confirmed};
      g.h=g.h.plus(seg.overtime);g.raw=g.raw.plus(seg.raw);if(!g.ids.includes(s.id))g.ids.push(s.id);groups.set(key,g);
    }
    if(s.dayMeal){
      if(s.type!=='day'&&s.type!=='holiday')warnings.push(`${s.date}：已勾选白班餐补，请核对班次资格。`);
      add({...basic('meal-'+s.id,'白班加班餐补',s.allowanceConfirmed&&s.ruleVersion===r.version,`${r.dayMeal} × 1`,`${s.date} 逐班勾选`,s.allowanceConfirmed?'payslip':'pending'),shiftIds:[s.id]},r.dayMeal);
    }
    const lateMeal=s.nightAllowance&&(!r.fuzhouPolicy||s.allowanceConfirmed&&s.nightAmount!==''||isLateMealEligible(s,out.segments.some(seg=>dec(seg.overtime).gt(0))));
    if(lateMeal)add({...basic('night-'+s.id,r.fuzhouPolicy?(s.type==='night'?'夜班餐补':'晚间加班餐补'):'夜班津贴',s.allowanceConfirmed&&(s.nightAmount!==''||s.ruleVersion===r.version),`${s.nightAmount||r.night} × 1`,`${s.date}；加班超过22点；每班一笔，实际金额优先`,s.allowanceConfirmed?'payslip':'pending'),shiftIds:[s.id]},s.nightAmount||r.night);
  }
  for(const [key,g] of groups){
    const multiplier=g.type==='holiday'?r.holidayRate:g.type==='rest'?r.restRate:r.normalRate;
    add({...basic(key,`${otLabels[g.type]}加班费`,g.confirmed,`${g.h.toString()} × (${r.otBase} ÷ ${r.otDays} ÷ ${r.standardHours}) × ${multiplier}`,`同类工时合并后按分取整；${g.ids.length} 个班次`,g.confirmed?'payslip':'auto'),hours:g.h.toString(),rate:hourly(r).mul(multiplier).toString(),shiftIds:g.ids},g.raw);
  }
  if(r.postEnabled&&c.postEnabled)add(basic('post','岗位津贴',c.postConfirmed&&verified,r.postProrate&&c.mode==='partial'?`${r.post} ÷ ${denominator} × ${c.paidDays}`:`${r.post} × 1`,'岗位资格及部分周期规则可修改',c.postConfirmed?'payslip':'auto'),dec(r.post).mul(r.postProrate?factor:1));
  if(c.mealEnabled){
    const hasDayMeal=shifts.some(s=>s.dayMeal);
    const both=hasDayMeal&&!c.mealDuplicateChecked&&r.mealMethod!=='card';
    if(both)warnings.push('月餐补与白班餐补是否重复尚未确认：月餐补暂列发放方式待定，不计现金预测。');
    const method=both?'unknown':r.mealMethod;
    add({...basic('meal-month',method==='card'?'饭卡餐补':'月度餐补',c.mealConfirmed&&verified&&!both,`${r.meal}${r.mealProrate&&c.mode==='partial'?` ÷ ${denominator} × ${c.paidDays}`:' × 1'}`,method==='card'?'饭卡充值，单独列为福利，不计应发或实发工资；夜班餐补另计现金':'发放方式待核验；与逐班餐补分别核对',c.mealConfirmed?'payslip':'pending'),method},dec(r.meal).mul(r.mealProrate?factor:1));
    if(r.mealMethod==='unknown')warnings.push('月餐补的发放方式未知，未计入现金收入与实发。');
  }
  if(c.heatEnabled)add(basic('heat',r.fuzhouPolicy&&c.month>='2026-10'?'公司夏季福利':'高温补贴',c.heatConfirmed&&(c.heatActual!==''||verified),c.heatActual!==''?'本期实际录入':r.heatProrate&&c.mode==='partial'?`${r.heat} ÷ ${denominator} × ${c.paidDays}`:`${r.heat} × 1`,'截图6–9月50元福利；法定高温作业津贴须另外核验，不能以50元替代',c.heatConfirmed?'payslip':'manual'),c.heatActual!==''?c.heatActual:dec(r.heat).mul(r.heatProrate?factor:1));
  if(c.performanceActual!==''||r.performance!==''&&r.performanceMethod!=='manual'){
    const ratio=r.employee==='trial'?dec(r.trialRatio).div(100):dec(1);
    const p=c.performanceActual!==''?dec(c.performanceActual):dec(r.performance).mul(ratio).mul(r.performanceMethod==='prorate'?factor:1);
    add(basic('performance','绩效奖金',c.performanceConfirmed&&(c.performanceActual!==''||verified),c.performanceActual!==''?'本期实际绩效':`${r.performance} × ${ratio.toString()}${r.performanceMethod==='prorate'?` × ${factor.toString()}`:''}`,'历史 ¥68.25 仅用于历史周期',c.performanceConfirmed?'payslip':'auto'),p);
  }else warnings.push('正式绩效标准未知，本周期未录入实际绩效，暂未计绩效。');
  for(const [enabled,confirmed,id,name,value] of [[c.midGift,c.midConfirmed,'mid-gift','中秋节礼金',r.employee==='trial'?r.midTrial:r.midRegular],[c.nationalGift,c.nationalConfirmed,'national-gift','国庆节礼金',r.employee==='trial'?r.nationalTrial:r.nationalRegular]] as const){if(enabled)add(basic(id,name,confirmed&&verified,`${value} × 1`,'公司福利，与法定节假日加班费独立',confirmed?'payslip':'pending'),value);}
  for(const e of c.extras)add({...basic('extra-'+e.id,e.name,e.confirmed,'手动输入',e.note,e.confirmed?'payslip':e.source),method:e.method},e.amount);
  const references=c.insuranceMode==='minimum'?insuranceReference(c.month,r.hireDate):[];
  if(c.insuranceMode==='minimum')warnings.push(references.length?'五险一金按所属月份最低基数与最低个人比例参考；实际扣款优先。社保按自然月，不按26–25周期天数摊薄，补缴或跨月扣款须实际录入。':'此月份未内置可靠的五险一金基数，请填写实际扣款。');
  if(c.insuranceMode==='minimum'&&c.month>'2026-12')warnings.push('五险一金沿用2026-10核验的最后参考值；2027年费率、基数需更新，结果仅作参考。');
  const configured=[...c.deductions,...references.filter(ref=>!c.deductions.some(d=>d.name===ref.name)).map((ref,i)=>({id:'policy-'+i,name:ref.name,actual:'',base:'',rate:'',confirmed:false,note:''}))];
  for(const d of configured){
    const ref=references.find(ref=>ref.name===d.name),base=d.base||ref?.base||'',rate=d.rate||ref?.rate||'';
    if(d.actual===''&&(base===''||rate==='')){if(!['其他扣款','缺勤扣款'].includes(d.name))warnings.push(`${d.name}尚未填写实际金额或基数与费率；未按零扣款确认。`);continue;}
    // Income tax is actual-only; do not fabricate a cumulative withholding estimate.
    if(d.name==='个人所得税'&&d.actual===''){warnings.push('个税只记录实际扣款，未采用基数×费率估算。');continue;}
    const actual=d.actual!=='';
    const estimated=dec(base||'0').mul(rate||'0').div(100),value=actual?d.actual:ref?estimated.toFixed(ref.wholeYuan?0:2,D.ROUND_HALF_UP):estimated;
    add({...basic('deduction-'+d.id,d.name,d.confirmed&&actual,actual?'工资条实际扣款':`${base} × ${rate}%${ref?.wholeYuan?'，按元四舍五入':''}`,d.note||(ref?'福州最低个人缴费参考；不是企业实际申报基数，工伤、生育单位承担部分不扣个人工资':'未输入的扣款不代表实际为零'),actual?'manual':'pending'),deduction:true},value);
  }
  const cash=items.filter(i=>!i.deduction&&i.method==='cash');
  const confirmedCash=sum(cash.filter(i=>i.confirmed).map(i=>i.amount));
  const expectedCash=sum(cash.filter(i=>!i.confirmed).map(i=>i.amount));
  const deductions=sum(items.filter(i=>i.deduction).map(i=>i.amount));
  return {items,gross:money(confirmedCash.plus(expectedCash),r.rounding),confirmedCash:money(confirmedCash),expectedCash:money(expectedCash),noncash:money(sum(items.filter(i=>!i.deduction&&['card','other'].includes(i.method)).map(i=>i.amount))),unknownBenefit:money(sum(items.filter(i=>!i.deduction&&i.method==='unknown').map(i=>i.amount))),deductions:money(deductions),net:money(confirmedCash.plus(expectedCash).minus(deductions)),warnings:[...new Set(warnings)],hours,stats:{shifts:shifts.filter(s=>!nonWork(s)).length,day:shifts.filter(s=>['day','short','holiday'].includes(s.type)).length,night:shifts.filter(s=>s.type==='night').length,rest:shifts.filter(s=>['rest','pendingRest'].includes(s.type)).length}};
}

export interface DailyEarning {base:string; overtime:string; allowances:string; total:string; hours:string; pending:boolean}
function dailyBase(r:Rules,c?:Cycle){
  const denominator=c?.denominator||r.baseDays,actualDays=c?.mode==='partial'?c.paidDays:c?.expectedDays||denominator;
  return c?.baseActual!==undefined&&c.baseActual!==''?(dec(actualDays).gt(0)?dec(c.baseActual).div(actualDays):dec(0)):c?.mode==='manual'?dec(0):dec(r.base).div(denominator);
}
// This is a calendar allocation for display. Monthly salary is calculated only by calculate().
export function dailyEarnings(r:Rules,all:Shift[],cycles:Record<string,Cycle>={}):Map<string,DailyEarning>{
  const shifts=[...new Map(all.filter(s=>!s.draft).map(s=>[s.id,s])).values()];
  const analyses=analyzeShifts(shifts,r),days=new Map<string,{base:Decimal;overtime:Decimal;allowances:Decimal;hours:Decimal;pending:boolean}>();
  for(const s of shifts){
    const day=days.get(s.date)??{base:dec(0),overtime:dec(0),allowances:dec(0),hours:dec(0),pending:false};
    days.set(s.date,day);
    if(nonWork(s))continue;
    const segments=analyses.get(s.id)!.segments,hours=sum(segments.map(x=>x.hours));
    if(!hours.gt(0))continue;
    const c=cycles[monthOf(s.date,r.cycleEnd)],base=dailyBase(r,c);
    // Calendar amounts allocate normal/paid-holiday hours only; rest-day OT has no extra daily base.
    const paidNormal=sum(segments.map(x=>dec(x.normal).plus(x.type==='holiday'?x.hours:'0')));
    day.base=r.fuzhouPolicy?D.min(base,day.base.plus(base.mul(D.min(paidNormal,r.standardHours)).div(r.standardHours))):base;
    day.hours=day.hours.plus(hours);
    day.overtime=day.overtime.plus(sum(segments.map(x=>x.raw)));
    if(s.dayMeal)day.allowances=day.allowances.plus(r.dayMeal);
    if(s.nightAllowance&&(!r.fuzhouPolicy||s.allowanceConfirmed&&s.nightAmount!==''||isLateMealEligible(s,segments.some(seg=>dec(seg.overtime).gt(0)))))day.allowances=day.allowances.plus(s.nightAmount||r.night);
    day.pending ||= segments.some(x=>x.type==='unknown');
  }
  return new Map([...days].map(([date,d])=>[date,{base:money(d.base,r.rounding),overtime:money(d.overtime,r.rounding),allowances:money(d.allowances,r.rounding),total:money(d.base.plus(d.overtime).plus(d.allowances),r.rounding),hours:d.hours.toString(),pending:d.pending}]));
}

export interface DailyWageLine {name:string;formula:string;amount:string}
export function dailyWageDetails(date:string,r:Rules,all:Shift[],cycles:Record<string,Cycle>={}){
  const earning=dailyEarnings(r,all,cycles).get(date);
  if(!earning)return undefined;
  const shifts=[...new Map(all.filter(s=>s.date===date&&!s.draft&&!nonWork(s)).map(s=>[s.id,s])).values()];
  const analyses=analyzeShifts(shifts,r),segments=shifts.flatMap(s=>analyses.get(s.id)!.segments),lines:DailyWageLine[]=[];
  const paidNormal=D.min(r.standardHours,sum(segments.map(s=>dec(s.normal).plus(s.type==='holiday'?s.hours:'0'))));
  if(dec(earning.base).gt(0))lines.push({name:segments.some(s=>s.type==='holiday')?'基本工资分摊（带薪节日）':'正常工时工资',formula:r.fuzhouPolicy?`${paidNormal.toString()} 小时 × ${dailyBase(r,cycles[monthOf(date,r.cycleEnd)]).div(r.standardHours).toFixed(5)} 元/小时`:'按本周期日工资分母折算',amount:earning.base});
  for(const [type,name,multiplier] of [['normal','平日加班费',r.normalRate],['rest','休息日加班费',r.restRate],['holiday','法定节假日加班费',r.holidayRate]] as const){
    const group=segments.filter(s=>s.type===type),hours=sum(group.map(s=>s.overtime));
    if(hours.gt(0))lines.push({name,formula:`${hours.toString()} 小时 × ${hourly(r).toFixed(5)} 元 × ${multiplier} 倍`,amount:money(sum(group.map(s=>s.raw)),r.rounding)});
  }
  const meals=new Map<string,{values:string[]}>();
  for(const s of shifts){
    const out=analyses.get(s.id)!;if(!sum(out.segments.map(seg=>seg.hours)).gt(0))continue;
    const add=(name:string,value:string)=>{const group=meals.get(name)??{values:[]};group.values.push(value);meals.set(name,group);};
    if(s.dayMeal)add('白班餐补',r.dayMeal);
    if(s.nightAllowance&&(!r.fuzhouPolicy||s.allowanceConfirmed&&s.nightAmount!==''||isLateMealEligible(s,out.segments.some(seg=>dec(seg.overtime).gt(0)))))add(s.type==='night'?'夜班餐补':'晚间加班餐补',s.nightAmount||r.night);
  }
  for(const [name,group] of meals)lines.push({name,formula:new Set(group.values).size===1?`${group.values.length} 次 × ${group.values[0]} 元`:'按各班实际餐补合计',amount:money(sum(group.values),r.rounding)});
  const unknown=sum(segments.filter(s=>s.type==='unknown').map(s=>s.hours)),compensated=sum(segments.filter(s=>s.type==='compensated').map(s=>s.hours));
  if(unknown.gt(0))lines.push({name:'待确认工时',formula:`${unknown.toString()} 小时，类型未确认，暂未计加班费`,amount:'0.00'});
  if(compensated.gt(0))lines.push({name:'已补休工时',formula:`${compensated.toString()} 小时，不另计休息日双倍加班费`,amount:'0.00'});
  const difference=dec(earning.total).minus(sum(lines.map(l=>l.amount)));
  if(!difference.isZero())lines.push({name:'分币取整差额',formula:'合计保留精度后取整到分',amount:money(difference)});
  const types=[...new Set(segments.map(s=>s.type))];
  return {date,earning,lines,basis:types.map(t=>({normal:'普通工作日',rest:'休息日 · 未补休',holiday:'法定节假日',compensated:'已补休',unknown:'类型待确认'})[t]).join(' / ')||'未录入工作时段'};
}

export function comparePayslip(result:PayResult,payslip:Payslip){
  return payslip.rows.map(row=>{
    const matching=result.items.filter(i=>i.id===row.key||(row.key==='ot-holiday'&&i.id.startsWith('ot-holiday-'))||(row.key==='ot-normal'&&i.id.startsWith('ot-normal-'))||(row.key==='ot-rest'&&i.id.startsWith('ot-rest-'))||(row.key==='night-meal'&&i.id.startsWith('night-'))||(row.key==='day-meal'&&i.id.startsWith('meal-')&&i.id!=='meal-month'));
    const expected=money(sum(matching.map(i=>i.amount)));
    const difference=money(dec(row.amount||'0').minus(expected));
    return {...row,expected,difference,reason:dec(difference).isZero()?'与当前计算一致':row.key.startsWith('ot-')?'核对计薪工时、加班类型和补休情况':row.key==='base'?'核对计薪天数及折算分母':row.key.startsWith('deduction')?'核对缴费基数、费率与实际扣款':'核对本期资格、实际金额和发放方式'};
  });
}

export function validateAttendance(shifts:Shift[]){
  const ids=new Set<string>();
  for(const s of shifts){if(ids.has(s.id))throw new Error('考勤 ID 重复');ids.add(s.id);}
  const work=shifts.filter(s=>!s.draft&&!nonWork(s)).sort((a,b)=>a.start.localeCompare(b.start));
  for(let i=1;i<work.length;i++)if(work[i].start<work[i-1].end)throw new Error(`${work[i].date} 班次与已有记录重叠，请先修正时间`);
}
