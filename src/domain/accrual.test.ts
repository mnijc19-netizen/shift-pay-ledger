import { describe, expect, it } from 'vitest';
import { calculate, dailyEarnings, dailyWageDetails, money, sum } from './engine';
import { initialState, defaultRules, newCycle, quickShift } from './seed';
import { parseBackup, upgradeSavedState } from './storage';

const rules=()=>structuredClone(defaultRules);
const basic=(r=rules())=>({...newCycle('2026-10',r),postEnabled:false});
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
