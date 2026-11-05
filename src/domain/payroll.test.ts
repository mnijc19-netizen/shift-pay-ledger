import { describe, expect, it } from 'vitest';
import { createPayrollLedger } from './payroll';
import { initialState, newCycle, quickShift } from './seed';
import { money, sum } from './engine';
import type { Payslip } from './model';

const payslip=(month:string,actualNet:string,confirmed:boolean):Payslip=>({id:month,month,actualNet,confirmed,rows:[],note:''});

describe('累计工资沿用每期同一计算',()=>{
  it('仅汇总有工资依据的周期，跨夜按班次开始日归属，快照不重复计入',()=>{
    const state=initialState();
    state.cycles['2026-11']=newCycle('2026-11',state.rules);
    state.shifts.push(quickShift('2026-10-25',state.rules,'night'),{...quickShift('2026-10-28',state.rules,'night'),draft:true},quickShift('2026-11-27',state.rules,'day'));
    state.snapshots.push({...state.snapshots[0],id:'another-snapshot'});
    const ledger=createPayrollLedger(state);
    const cumulative=ledger.cumulative('2026-11-05');
    expect(cumulative.records.map(r=>r.cycle.month)).toEqual(['2026-10','2026-09']);
    expect(cumulative.records[0].result).toBe(ledger.get('2026-10').result);
    expect(cumulative.records[0].result.stats.night).toBe(2);
    expect(cumulative.gross).toBe(money(sum(cumulative.records.map(r=>r.result.gross))));
    expect(cumulative.net).toBe(money(sum(cumulative.records.map(r=>r.result.net))));
    expect(cumulative.actual).toBeNull();
  });
  it('实际、未确认与估算独立：已确认零元有效，仅有到账的周期不加默认扣款',()=>{
    const state=initialState();
    state.payslips=[payslip('2026-09','0',true),payslip('2026-10','1400',false),payslip('2026-11','1700.20',true)];
    const ledger=createPayrollLedger(state), cumulative=ledger.cumulative('2026-11-05');
    expect(cumulative.actual).toBe('1700.20');
    expect(cumulative.pendingActual).toBe('1400.00');
    expect(cumulative.confirmedCount).toBe(2);
    expect(cumulative.records[0].hasEstimate).toBe(false);
    expect(cumulative.net).toBe(money(sum([ledger.get('2026-09').result.net,ledger.get('2026-10').result.net])));
  });
  it('已录本期绩效与实际扣款变动后，周期和累计都从新数据更新',()=>{
    const state=initialState(), before=createPayrollLedger(state).cumulative('2026-11-05');
    const cycle=newCycle('2026-10',state.rules);
    cycle.performanceActual='123.45';
    cycle.deductions.find(d=>d.name==='个人所得税')!.actual='20';
    state.cycles[cycle.month]=cycle;
    const ledger=createPayrollLedger(state), after=ledger.cumulative('2026-11-05');
    expect(after.records[0].result).toBe(ledger.get(cycle.month).result);
    expect(after.gross).toBe(money(sum([before.gross!,'123.45'])));
    expect(after.net).toBe(money(sum([before.net!,'103.45'])));
    expect(after.actual).toBeNull();
  });
});
