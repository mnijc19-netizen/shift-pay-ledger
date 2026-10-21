import { describe, it, expect, vi } from 'vitest';
import { defaultRules, initialState, newShift, newCycle } from './seed';
import { calculate, comparePayslip, hourly, money, splitShift, sum, validateAttendance } from './engine';
import { period, monthOf, nextDate, shiftMonth, daysIn } from './dates';
import { stateSchema, shiftSchema, rulesSchema, uid } from './model';
import { parseBackup, csv, ledgerCsv, attendanceCsv } from './storage';
import type { Rules, Shift } from './model';
const rules=():Rules=>structuredClone(defaultRules);
function ordinary(day='2026-10-08',night=false){return {...newShift(day,rules(),night?'night':'day'),ot:'normal' as const,nightAllowance:false};}
const amount=(s:Shift,r=rules())=>money(sum(splitShift(s,r).segments.map(x=>x.raw)),r.rounding);

describe('人民币精度与验收工资条',()=>{
  it('保留小时工资基数精度',()=>expect(hourly(rules()).toFixed(8)).toBe('12.61494253'));
  it('11.5 小时法定加班为 435.22',()=>expect(amount({...ordinary(),ot:'holiday'})).toBe('435.22'));
  it('11.5 小时工作日只计 3.5 小时加班',()=>{const o=splitShift(ordinary(),rules()).segments;expect(sum(o.map(x=>x.normal)).toString()).toBe('8');expect(sum(o.map(x=>x.overtime)).toString()).toBe('3.5');expect(amount(ordinary())).toBe('66.23');});
  it('历史七项金额与 715.42 合计精确匹配',()=>{const s=initialState(),r=calculate(s.rules,s.cycles['2026-09'],s.shifts);expect(r.items.map(i=>[i.name,i.amount])).toEqual(expect.arrayContaining([['基本工资','95.43'],['法定节假日加班费','435.22'],['绩效奖金','68.25'],['岗位津贴','4.35'],['白班加班餐补','10.00'],['高温补贴','2.17'],['中秋节礼金','100.00']]));expect(r.items).toHaveLength(7);expect(r.gross).toBe('715.42');expect(r.confirmedCash).toBe('715.42');expect(r.expectedCash).toBe('0.00');});
  it('不将合计伪装成银行到账',()=>{const s=initialState();expect(s.payslips[0].actualNet).toBe('');expect(s.payslips[0].confirmed).toBe(false);});
  it('不逐班重复添加正常工资',()=>{const r=rules(),c=newCycle('2026-10',r),out=calculate(r,c,[ordinary(),ordinary('2026-10-09')]);expect(out.items.filter(x=>x.id==='base')).toHaveLength(1);expect(out.items.find(x=>x.id==='base')?.amount).toBe('2195.00');expect(out.items.find(x=>x.id.startsWith('ot-normal'))?.amount).toBe('132.46');});
  it('先合并再取整，避免逐班取整累计误差',()=>{const r=rules(),ss=Array.from({length:10},(_,i)=>({...ordinary('2026-10-'+String(11+i).padStart(2,'0')),paidHours:'8.01'}));const out=calculate(r,newCycle('2026-10',r),ss);expect(out.items.find(x=>x.id.startsWith('ot-normal'))?.amount).toBe('1.89');});
  it('取整模式可改为截取到分',()=>expect(amount({...ordinary(),ot:'holiday'},{...rules(),rounding:'down'})).toBe('435.21'));
});
describe('考勤、周末与跨午夜',()=>{
  it('普通夜班仍是 11.5 小时和 3.5 小时加班',()=>{const o=splitShift(ordinary('2026-10-08',true),rules()).segments;expect(sum(o.map(x=>x.hours)).toString()).toBe('11.5');expect(sum(o.map(x=>x.overtime)).toString()).toBe('3.5');expect(amount(ordinary('2026-10-08',true))).toBe('66.23');});
  it('手动 11.5 小时不重复扣饭',()=>expect(sum(splitShift({...ordinary(),paidHours:'11.5'},rules()).segments.map(x=>x.hours)).toString()).toBe('11.5'));
  it('手动 8 小时短班无加班',()=>expect(amount({...ordinary(),paidHours:'8'})).toBe('0.00'));
  it('短休息默认不扣、启用时两次共扣 20 分钟',()=>{expect(sum(splitShift(ordinary(),rules()).segments.map(x=>x.hours)).toString()).toBe('11.5');expect(sum(splitShift({...ordinary(),deductShort:true},rules()).segments.map(x=>x.hours)).toFixed(8)).toBe('11.16666667');});
  it('重叠休息只扣一次',()=>{const s={...ordinary(),deductShort:true,mealOffset:'240',break1:'240',break2:'250'};expect(sum(splitShift(s,rules()).segments.map(x=>x.hours)).toString()).toBe('11.5');});
  it('星期六与调休工作日不自动双倍',()=>{expect(amount(ordinary('2026-10-10'))).toBe('66.23');expect(amount({...ordinary('2026-10-10'),ot:'unknown'})).toBe('0.00');expect(amount(ordinary('2026-10-11'))).toBe('66.23');});
  it('已补休不自动双倍；未补休 11.5h 为 290.14',()=>{expect(amount({...ordinary(),ot:'compensated'})).toBe('0.00');expect(amount({...ordinary(),ot:'rest'})).toBe('290.14');});
  it('连续假期不是法定日，也不自动为个人休息日',()=>expect(amount(ordinary('2026-10-04'))).toBe('66.23'));
  it('9/30 夜班跨国庆按实际时段拆分',()=>{const s=ordinary('2026-09-30',true),segments=splitShift(s,rules()).segments;expect(segments.map(s=>[s.date,s.hours,s.type])).toEqual([['2026-09-30','4','normal'],['2026-10-01','7.5','holiday']]);expect(sum(segments.map(s=>s.hours)).toString()).toBe('11.5');expect(amount(s)).toBe('283.84');});
  it('可整班按开始日期归类，且 8 小时额度不跨午夜重置',()=>expect(amount(ordinary('2026-09-30',true),{...rules(),split:false})).toBe('66.23'));
  it('手动工时按日期比例分配，保持总和',()=>{const s={...ordinary('2026-09-30',true),paidHours:'10'};expect(sum(splitShift(s,rules()).segments.map(x=>x.hours)).toString()).toBe('10');});
  it('允许逐段覆盖，且必须完全匹配计薪总时数',()=>{const s={...ordinary('2026-09-30',true),paidHours:'10',overrides:{'2026-09-30':{type:'rest' as const,hours:'3'},'2026-10-01':{type:'holiday' as const,hours:'7'}}};expect(splitShift(s,rules()).segments.map(s=>s.hours)).toEqual(['3','7']);expect(()=>splitShift({...s,paidHours:'11'},rules())).toThrow('合计');});
  it('拒绝只填写部分分段小时',()=>expect(()=>splitShift({...ordinary('2026-09-30',true),overrides:{'2026-09-30':{type:'normal',hours:'3'}}},rules())).toThrow('填写每个日期'));
  it('个人排班休息可按配置分类',()=>{const r=rules();r.calendar.push({date:'2026-10-08',type:'personalRest',label:'个人休息',source:'人工'});expect(amount(ordinary(),r)).toBe('290.14');});
  it('允许手动修正法定日类型，不重复生成加班',()=>{const s={...ordinary('2026-10-01'),overrides:{'2026-10-01':{type:'rest' as const,hours:''}}};expect(amount(s)).toBe('290.14');const r=rules(),o=calculate(r,newCycle('2026-10',r),[s]);expect(o.items.filter(x=>x.id.startsWith('ot-'))).toHaveLength(1);});
  it('夜班津贴跨午夜只生成一次',()=>{const r=rules(),s={...ordinary('2026-09-30',true),nightAllowance:true};expect(calculate(r,newCycle('2026-10',r),[s]).items.filter(x=>x.id.startsWith('night-'))).toHaveLength(1);});
  it('休息、缺勤与待确认休息不会生成扣款或加班',()=>{const r=rules(),c=newCycle('2026-10',r),o=calculate(r,c,[{...ordinary(),type:'pendingRest'}]);expect(o.items.some(i=>i.deduction||i.id.startsWith('ot-'))).toBe(false);});
  it('草稿不计工资或班次数',()=>{const r=rules(),out=calculate(r,newCycle('2026-10',r),[{...ordinary(),draft:true}]);expect(out.stats.shifts).toBe(0);expect(out.items.some(i=>i.id.startsWith('ot-'))).toBe(false);});
  it('重复考勤 ID 不重复计费，导入会拒绝重复',()=>{const s=ordinary(),r=rules();expect(calculate(r,newCycle('2026-10',r),[s,s]).hours.normal).toBe('3.5');expect(()=>validateAttendance([s,s])).toThrow('重复');});
  it('拒绝重叠班次，但允许紧邻班次',()=>{const s=ordinary();expect(()=>validateAttendance([s,{...s,id:'2'}])).toThrow('重叠');expect(()=>validateAttendance([s,{...ordinary('2026-10-08',true),id:'2'}])).not.toThrow();});
  it('同一上班日期分成多段记录时，只共享一次 8h 正常工时额度',()=>{const r=rules(),s1={...ordinary(),end:'2026-10-08T12:00',mealMinutes:'0'},s2={...ordinary(),id:'later',start:'2026-10-08T13:00',end:'2026-10-08T21:00',mealMinutes:'0'};validateAttendance([s1,s2]);const out=calculate(r,newCycle('2026-10',r),[s2,s1]);expect(out.hours.normal).toBe('4');expect(out.items.find(i=>i.id.startsWith('ot-normal'))?.amount).toBe('75.69');});
  it('拒绝手动工时超过班次长度及倒置时间',()=>{expect(()=>splitShift({...ordinary(),paidHours:'13'},rules())).toThrow('不能超过');expect(shiftSchema.safeParse({...ordinary(),end:'2026-10-08T07:00'}).success).toBe(false);});
});
describe('工资周期、跨月与跨年',()=>{
  it('包含上月26日本月25日',()=>expect(period('2026-10')).toEqual({start:'2026-09-26',end:'2026-10-25'}));
  it('夜班25日开始归本期，26日开始归下期',()=>{expect(monthOf('2026-10-25')).toBe('2026-10');expect(monthOf('2026-10-26')).toBe('2026-11');const r=rules(),c=newCycle('2026-10',r);expect(calculate(r,c,[ordinary('2026-10-25',true),ordinary('2026-10-26')]).stats.shifts).toBe(1);});
  it('正确跨年与闰月',()=>{expect(period('2027-01').start).toBe('2026-12-26');expect(shiftMonth('2026-12',1)).toBe('2027-01');expect(nextDate('2028-02-28')).toBe('2028-02-29');expect(daysIn('2028-02')).toHaveLength(29);});
  it('支持自定义工资周期截止日',()=>{expect(period('2026-10',20)).toEqual({start:'2026-09-21',end:'2026-10-20'});expect(monthOf('2026-10-21',20)).toBe('2026-11');});
});
describe('福利、部分周期、扣款及核对',()=>{
  it('本周期分母覆盖规则，独立于加班分母',()=>{const r=rules(),c={...newCycle('2026-10',r),mode:'partial' as const,paidDays:'1',denominator:'22'};const o=calculate(r,c,[]);expect(o.items.find(i=>i.id==='base')?.amount).toBe('99.77');expect(hourly(r).toFixed(8)).toBe('12.61494253');});
  it('月餐补未知不入现金，饭卡单独记录',()=>{const r=rules(),c=newCycle('2026-10',r),a=calculate(r,c,[]),b=calculate({...r,mealMethod:'card'},c,[]);expect(a.gross).toBe('2295.00');expect(a.unknownBenefit).toBe('400.00');expect(b.noncash).toBe('400.00');expect(b.gross).toBe('2295.00');});
  it('餐补重复关系未确认不得同时计现金',()=>{const r={...rules(),mealMethod:'cash' as const},c=newCycle('2026-10',r),s={...ordinary(),dayMeal:true};const o=calculate(r,c,[s]);expect(o.items.find(i=>i.id==='meal-month')?.method).toBe('unknown');expect(calculate(r,{...c,mealDuplicateChecked:true},[s]).items.find(i=>i.id==='meal-month')?.method).toBe('cash');});
  it('预计夜班津贴与国庆礼金不冒充确认金额',()=>{const r=rules(),c={...newCycle('2026-10',r),nationalGift:true},o=calculate(r,c,[{...ordinary('2026-10-08',true),nightAllowance:true}]);expect(o.confirmedCash).toBe('0.00');expect(o.items.find(i=>i.id==='national-gift')?.confirmed).toBe(false);});
  it('绩效未知不反推，实际值可直接录入',()=>{const r=rules(),c=newCycle('2026-10',r);expect(calculate(r,c,[]).items.some(i=>i.id==='performance')).toBe(false);expect(calculate(r,{...c,performanceActual:'68.25'},[]).items.find(i=>i.id==='performance')?.amount).toBe('68.25');});
  it('绩效标准明确后支持身份与部分周期比例',()=>{const r={...rules(),performance:'1000',performanceMethod:'prorate' as const},c={...newCycle('2026-10',r),mode:'partial' as const,paidDays:'1'};expect(calculate(r,c,[]).items.find(i=>i.id==='performance')?.amount).toBe('26.09');});
  it('高温补贴默认禁用，启用后支持实际值优先',()=>{const r=rules(),c=newCycle('2026-10',r);expect(calculate(r,c,[]).items.some(i=>i.id==='heat')).toBe(false);expect(calculate(r,{...c,heatEnabled:true,heatActual:'22.17'},[]).items.find(i=>i.id==='heat')?.amount).toBe('22.17');});
  it('实际扣款优先于基数费率，估算扣款不标确认',()=>{const r=rules(),c=newCycle('2026-10',r);c.deductions[0]={...c.deductions[0],base:'3000',rate:'8',actual:'200',confirmed:true};c.deductions[1]={...c.deductions[1],base:'3000',rate:'2',confirmed:true};const o=calculate(r,c,[]);expect(o.deductions).toBe('260.00');expect(o.items.find(i=>i.id==='deduction-d1')?.confirmed).toBe(false);expect(o.net).toBe('2035.00');});
  it('个税不采用基数费率的貌似精确估算',()=>{const r=rules(),c=newCycle('2026-10',r);c.deductions[4]={...c.deductions[4],base:'5000',rate:'3'};expect(calculate(r,c,[]).items.some(i=>i.id==='deduction-d4')).toBe(false);});
  it('历史工资条七项核对差额全部为零',()=>{const s=initialState(),r=calculate(s.rules,s.cycles['2026-09'],s.shifts);expect(comparePayslip(r,s.payslips[0]).map(c=>c.difference)).toEqual(Array(7).fill('0.00'));});
  it('修改规则不会改写已保存历史快照',()=>{const s=initialState(),before=JSON.stringify(s.snapshots[0]);s.rules.base='3000';expect(calculate(s.rules,s.cycles['2026-09'],s.shifts).net).not.toBe('715.42');expect(JSON.stringify(s.snapshots[0])).toBe(before);expect(s.snapshots[0].result.net).toBe('715.42');});
  it('规则版本变化后，公式计算的旧确认状态不会自动沿用',()=>{const s=initialState();s.rules.version=2;s.rules.base='3000';const r=calculate(s.rules,s.cycles['2026-09'],s.shifts);expect(r.items.find(i=>i.id==='base')?.confirmed).toBe(false);expect(r.items.find(i=>i.id.startsWith('ot-holiday'))?.confirmed).toBe(false);expect(r.items.find(i=>i.id==='performance')?.confirmed).toBe(true);expect(s.snapshots[0].result.confirmedCash).toBe('715.42');});
  it('改为休息后不会遗留旧班次的津贴',()=>{const r=rules(),s={...ordinary(),type:'rest' as const,dayMeal:true,nightAllowance:true};expect(calculate(r,newCycle('2026-10',r),[s]).items.some(i=>i.id.startsWith('night-')||i.id.startsWith('meal-')&&i.id!=='meal-month')).toBe(false);});
});
describe('持久化、备份验证与导出',()=>{
  it('局域网 HTTP 上不依赖 secure-context randomUUID',()=>{const original=crypto;vi.stubGlobal('crypto',{getRandomValues:original.getRandomValues.bind(original)});try{expect(uid()).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);}finally{vi.unstubAllGlobals();}});
  it('初始数据和完整备份通过 schema，往返无损',()=>{const s=initialState();expect(stateSchema.safeParse(s).success).toBe(true);expect(parseBackup(JSON.stringify(s))).toEqual(s);});
  it('拒绝损坏 JSON、错误版本、非法数值和重叠记录',()=>{expect(()=>parseBackup('{bad')).toThrow();const s=initialState();expect(()=>parseBackup(JSON.stringify({...s,schema:99}))).toThrow();s.rules.otDays='0';expect(()=>parseBackup(JSON.stringify(s))).toThrow();const b=initialState();b.shifts.push({...b.shifts[1],id:'duplicate'});expect(()=>parseBackup(JSON.stringify(b))).toThrow('重叠');});
  it('规则拒绝零分母与负数',()=>{expect(rulesSchema.safeParse({...rules(),otDays:'0'}).success).toBe(false);expect(rulesSchema.safeParse({...rules(),base:'-1'}).success).toBe(false);});
  it('CSV 包含 BOM、公式追溯并防表格公式注入',()=>{expect(csv([['=1+1','逗号,换行\n"引号"']])).toBe('\ufeff"\'=1+1","逗号,换行\n""引号"""');const s=initialState();expect(ledgerCsv(s.snapshots[0].result)).toContain('原始金额');expect(attendanceCsv(s.shifts,'2026-09',25)).toContain('2026-09-25');expect(attendanceCsv(s.shifts,'2026-09',25)).not.toContain('2026-10-08');});
});
