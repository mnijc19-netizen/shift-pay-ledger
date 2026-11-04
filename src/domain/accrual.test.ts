import { describe, expect, it } from 'vitest';
import { calculate, dailyEarnings, dailyWageDetails, money, sum, attendanceTotals } from './engine';
import { initialState, defaultRules, newCycle, quickShift } from './seed';
import { parseBackup, upgradeSavedState } from './storage';

const rules=()=>structuredClone(defaultRules);
const basic=(r=rules())=>({...newCycle('2026-10',r),postEnabled:false});
describe('出勤天数与总工时',()=>{
  it('本周期按开始上班日期筛选，全部累计覆盖所有周期，跨夜只计开始日一天',()=>{
    const r=rules(),shifts=[quickShift('2026-09-25',r,'day'),quickShift('2026-09-26',r,'night'),quickShift('2026-10-25',r,'night'),quickShift('2026-10-26',r,'day')];
    expect(attendanceTotals(shifts,r,{start:'2026-09-26',end:'2026-10-25'})).toEqual({days:2,hours:'24',shifts:2});expect(attendanceTotals(shifts,r)).toEqual({days:4,hours:'48',shifts:4});
  });
  it('同一天多个班段只计一天，重复ID不重复累计小时',()=>{
    const r=rules(),a=quickShift('2026-10-09',r,'day','4'),b={...quickShift(a.date,r,'day','8'),start:a.date+'T13:00',end:a.date+'T21:00'};
    expect(attendanceTotals([a,b,a],r)).toEqual({days:1,hours:'12',shifts:2});
  });
  it('休息、法定带薪假、请假、缺勤、入职、草稿和0小时均不算实际上班',()=>{
    const r=rules(),rest=quickShift('2026-10-01',r,'rest');
    const nonwork=(['rest','paidLeave','unpaidLeave','absence','pendingRest','onboarding'] as const).map(type=>({...rest,id:type,type}));
    expect(attendanceTotals([...nonwork,{...quickShift('2026-10-02',r,'day'),draft:true},{...quickShift('2026-10-03',r,'night'),paidHours:'0'}],r)).toEqual({days:0,hours:'0',shifts:0});
  });
  it('按已录计薪工时统计，手填11.5小时优先，非计薪饭休只在未手填时扣除',()=>{
    const r=rules(),a={...quickShift('2026-10-08',r,'day'),paidHours:'11.5',mealMinutes:'30'},b={...quickShift('2026-10-09',r,'day'),paidHours:'',mealMinutes:'30'};
    expect(attendanceTotals([a,b],r)).toEqual({days:2,hours:'23',shifts:2});
  });
  it('新账本统计只从考勤读取，不把工资快照再加一次',()=>{
    const s=initialState();expect(s.snapshots.length).toBeGreaterThan(0);expect(attendanceTotals(s.shifts,s.rules)).toEqual({days:3,hours:'31.5',shifts:3});expect(attendanceTotals([],s.rules)).toEqual({days:0,hours:'0',shifts:0});
  });
});
describe('已录法定带薪假保留基本工资',()=>{
  it('国庆1至3日休假累计24小时带薪工资，不虚构出勤或加班',()=>{
    const r=rules(),c=basic(r),shifts=['2026-10-01','2026-10-02','2026-10-03'].map(d=>quickShift(d,r,'rest')),out=calculate(r,c,shifts);
    expect(out.items.find(i=>i.id==='base')?.amount).toBe('302.76');expect(out.gross).toBe('302.76');expect(out.stats.shifts).toBe(0);expect(out.items.some(i=>i.id.startsWith('ot-')||i.id.startsWith('night-'))).toBe(false);
    const detail=dailyWageDetails(shifts[0].date,r,shifts,{[c.month]:c})!;expect(detail.earning).toMatchObject({hours:'0',base:'100.92',overtime:'0.00',total:'100.92'});expect(detail.lines[0]).toMatchObject({name:'法定带薪假工资',amount:'100.92'});expect(detail.basis).toContain('带薪休假');
  });
  it('整月结算已包含带薪假，不在2195元之上重复增加；实际工资覆盖仍优先',()=>{
    const r=rules(),shifts=[quickShift('2026-10-01',r,'rest')],c={...basic(r),mode:'full' as const};
    expect(calculate(r,c,shifts).gross).toBe('2195.00');expect(calculate(r,{...c,baseActual:'2100'},shifts).gross).toBe('2100.00');
  });
  it('普通休息、无薪假、缺勤、草稿和入职前日期不自动增加法定假工资',()=>{
    const r=rules(),s=quickShift('2026-10-01',r,'rest'),c=basic(r);
    for(const shift of [quickShift('2026-10-11',r,'rest'),{...s,type:'unpaidLeave' as const},{...s,type:'absence' as const},{...s,draft:true},{...s,useCalendar:false}])expect(calculate(r,c,[shift]).gross).toBe('0.00');
    expect(calculate({...r,hireDate:'2026-10-02'},c,[s]).gross).toBe('0.00');expect(calculate(r,c,[]).gross).toBe('0.00');
  });
  it('法定日上4小时仍保留8小时带薪基本工资，加班只计实际4小时，休息记录不重复加',()=>{
    const r=rules(),s=quickShift('2026-10-01',r,'day','4'),rest=quickShift(s.date,r,'rest'),c=basic(r),out=calculate(r,c,[s,rest]);
    expect(out.items.find(i=>i.id==='base')?.amount).toBe('100.92');expect(out.items.find(i=>i.id.startsWith('ot-holiday'))?.amount).toBe('151.38');expect(out.gross).toBe('252.30');
    const details=dailyWageDetails(s.date,r,[s,rest],{[c.month]:c})!;expect(money(sum(details.lines.map(i=>i.amount)))).toBe(details.earning.total);expect(details.earning.total).toBe('252.30');
  });
  it('明确录入的带薪假按给定小时计工资，保留零出勤、不生加班',()=>{
    const r=rules(),s={...quickShift('2026-10-09',r,'rest'),type:'paidLeave' as const,paidHours:'4'},c=basic(r);
    expect(calculate(r,c,[s]).gross).toBe('50.46');expect(dailyEarnings(r,[s],{[c.month]:c}).get(s.date)).toMatchObject({base:'50.46',hours:'0',overtime:'0.00'});
  });
});
describe('基本工资只按已录考勤累计',()=>{
  it('新周期默认累计；空白、草稿和休息均不预加整月底薪或岗位津贴',()=>{
    const r=rules(),c=newCycle('2026-10',r);expect(c.mode).toBe('attendance');
    for(const shifts of [[],[{...quickShift('2026-10-09',r,'day'),draft:true}],[quickShift('2026-10-09',r,'rest')]]){
      const out=calculate(r,c,shifts);expect(out.gross).toBe('0.00');expect(out.items.find(i=>i.id==='base')?.amount).toBe('0.00');expect(out.items.find(i=>i.id==='post')?.amount).toBe('0.00');expect(out.deductions).toBe('590.80');
    }
  });
  it('一个12小时白班只累计8小时基本工资和4小时加班，夜班另加25元',()=>{
    const r=rules(),c=basic(r),day=quickShift('2026-10-09',r,'day'),night=quickShift(day.date,r,'night');
    const out=calculate(r,c,[day]);expect(out.items.find(i=>i.id==='base')).toMatchObject({amount:'100.92',formula:expect.stringContaining('8 小时')});expect(out.gross).toBe('176.61');expect(calculate(r,c,[night]).gross).toBe('201.61');
  });
  it('连续三班、提前下班、修改和删除随实际工时重新累计',()=>{
    const r=rules(),c=basic(r),shifts=['2026-10-09','2026-10-12','2026-10-13'].map(d=>quickShift(d,r,'day'));
    expect(calculate(r,c,shifts).gross).toBe('529.83');
    const short=quickShift(shifts[0].date,r,'day','4');expect(calculate(r,c,[short]).gross).toBe('50.46');expect(calculate(r,c,[]).gross).toBe('0.00');
    expect(calculate(r,newCycle(c.month,r),[short]).items.find(i=>i.id==='post')?.amount).toBe('2.30');
  });
  it('休息日全部算加班；法定日保留已上班的带薪基本工资，整班按开始日归属',()=>{
    const r=rules(),c=basic(r),rest=quickShift('2026-10-11',r,'night'),holiday=quickShift('2026-10-03',r,'night');
    expect(calculate(r,c,[rest]).items.find(i=>i.id==='base')?.amount).toBe('0.00');expect(calculate(r,c,[rest]).gross).toBe('327.76');expect(calculate(r,c,[holiday]).gross).toBe('580.06');
    expect(calculate(r,c,[quickShift('2026-10-25',r,'night')]).stats.shifts).toBe(1);expect(calculate(r,basic(r),[quickShift('2026-10-26',r,'night')]).gross).toBe('0.00');
  });
  it('同日多个班段只累计8小时正常工资，重复ID不重复计入',()=>{
    const r=rules(),a=quickShift('2026-10-09',r,'day','4'),b={...quickShift(a.date,r,'day','8'),start:a.date+'T13:00',end:a.date+'T21:00'};
    expect(calculate(r,basic(r),[a,b,a]).gross).toBe('176.61');
  });
  it('累计基本工资封顶月底薪，日明细明确列上限调整，加班继续累计',()=>{
    const r=rules(),c=basic(r),shifts=Array.from({length:22},(_,i)=>({...quickShift(`2026-10-${String(i+1).padStart(2,'0')}`,r,'day'),useCalendar:false,ot:'normal' as const}));
    const out=calculate(r,c,shifts);expect(out.items.find(i=>i.id==='base')?.amount).toBe('2195.00');expect(out.items.find(i=>i.id.startsWith('ot-normal'))?.amount).toBe('1665.17');
    const details=dailyWageDetails('2026-10-22',r,shifts,{[c.month]:c})!;expect(details.lines.some(i=>i.name==='月基本工资上限调整')).toBe(true);expect(money(sum(details.lines.map(i=>i.amount)))).toBe(details.earning.total);
    expect(dailyEarnings(r,shifts,{[c.month]:c}).get('2026-10-22')?.base).toBe('75.69');
  });
  it('实际基本工资仍覆盖累计，日历也按实际金额分配；整月预测可明确手选',()=>{
    const r=rules(),s=quickShift('2026-10-09',r,'day'),c={...basic(r),baseActual:'80'};
    expect(calculate(r,c,[s]).items.find(i=>i.id==='base')?.amount).toBe('80.00');expect(dailyEarnings(r,[s],{[c.month]:c}).get(s.date)?.base).toBe('80.00');expect(dailyEarnings(r,[s,s],{[c.month]:c}).get(s.date)?.base).toBe('80.00');
    expect(calculate(r,{...basic(r),mode:'full'},[s]).items.find(i=>i.id==='base')?.amount).toBe('2195.00');
  });
  it('旧账本只升级默认整月预测，历史快照、实际金额、确认值及手填周期不变，且只执行一次',()=>{
    const state=initialState();state.attendanceBasisApplied=false;
    state.cycles['2026-10']={...newCycle('2026-10',state.rules),mode:'full'};
    state.cycles['2026-11']={...newCycle('2026-11',state.rules),mode:'full',baseActual:'600'};
    state.cycles['2026-12']={...newCycle('2026-12',state.rules),mode:'full',baseConfirmed:true};
    const before=structuredClone(state),out=upgradeSavedState(parseBackup(JSON.stringify(state)));
    expect(out.cycles['2026-10'].mode).toBe('attendance');expect(out.cycles['2026-11']).toEqual(before.cycles['2026-11']);expect(out.cycles['2026-12']).toEqual(before.cycles['2026-12']);expect(out.cycles['2026-09']).toEqual(before.cycles['2026-09']);
    expect(out.snapshots).toEqual(before.snapshots);expect(out.payslips).toEqual(before.payslips);expect(out.shifts).toEqual(before.shifts);expect(out.snapshots[0].result.net).toBe('715.42');
    expect(out.audit.filter(a=>a.action==='基本工资改为按已录考勤累计')).toHaveLength(1);out.cycles['2026-10'].mode='full';expect(upgradeSavedState(out).cycles['2026-10'].mode).toBe('full');expect(out.audit).toHaveLength(1);
  });
});
