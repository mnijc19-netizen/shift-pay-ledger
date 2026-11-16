import { describe, expect, it } from 'vitest';
import { applyInboxUpdate } from './payrollReview';
import { initialState, newShift } from './seed';

describe('applyInboxUpdate',()=>{
  it('合并新增、修改的考勤并保留此后录入的日期',()=>{
    const state=initialState();
    const before=state.shifts.find(shift=>shift.id==='night-known')!;
    const later=newShift('2026-11-16',state.rules);
    const added=newShift('2026-11-17',state.rules);
    state.shifts.push(later);
    const change={kind:'shift-pay-changes-v1',shifts:[{before,after:{...before,note:'已核对'}},{before:null,after:added}]};
    const result=applyInboxUpdate(state,change).state;
    expect(result.shifts.find(shift=>shift.id===before.id)?.note).toBe('已核对');
    expect(result.shifts).toContainEqual(later);
    expect(result.shifts).toContainEqual(added);
  });

  it('拒绝覆盖本机更新过的同一班次',()=>{
    const state=initialState();
    const before=structuredClone(state.shifts.find(shift=>shift.id==='night-known')!);
    state.shifts.find(shift=>shift.id===before.id)!.note='手机刚改';
    expect(()=>applyInboxUpdate(state,{kind:'shift-pay-changes-v1',shifts:[{before,after:{...before,note:'私有更新'}}]}))
      .toThrow('考勤已有新的本机修改');
  });
});
