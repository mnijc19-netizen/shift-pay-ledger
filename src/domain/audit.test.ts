import { describe, expect, it } from 'vitest';
import { compactAuditEntries, diffs } from './audit';
import { initialState, quickShift } from './seed';

describe('保存修改记录的空间与内容',()=>{
  it('考勤增加、修改和删除仅存变动班次，保留其前后完整值',()=>{
    const a=initialState(),shift=quickShift('2026-10-09',a.rules,'night'),b={...a,shifts:[...a.shifts,shift]};
    expect(diffs(a,b)).toMatchObject({format:'changes-v1',before:JSON.stringify({shifts:[]}),after:JSON.stringify({shifts:[shift]})});
    const edited={...shift,note:'提前下班',paidHours:'8'},c={...b,shifts:[...a.shifts,edited]};
    expect(JSON.parse(diffs(b,c).before)).toEqual({shifts:[shift]});expect(JSON.parse(diffs(b,c).after)).toEqual({shifts:[edited]});
    expect(JSON.parse(diffs(c,a).before)).toEqual({shifts:[edited]});expect(JSON.parse(diffs(c,a).after)).toEqual({shifts:[]});
  });
  it('规则只记录变动字段，周期更新不重复保留其他月份',()=>{
    const a=initialState(),b=structuredClone(a);b.rules.base='2400';b.cycles['2026-09'].performanceActual='300';
    expect(JSON.parse(diffs(a,b).after)).toEqual({rules:{base:'2400'},cycles:{'2026-09':{performanceActual:'300'}}});
  });
  it('旧记录去除重复数据且保留变动；重复迁移不改值，无法解析的原文保留',()=>{
    const a=initialState(),shift=quickShift('2026-10-09',a.rules,'night'),before={shifts:a.shifts},after={shifts:[...a.shifts,shift]};
    const old={id:'old',at:'2026-10-22T00:00:00Z',action:'保存考勤',note:'原备注',before:JSON.stringify(before),after:JSON.stringify(after)};
    const opaque={...old,id:'opaque',before:'原始非JSON内容'};
    const result=compactAuditEntries([old,opaque]);
    expect(JSON.parse(result[0].before)).toEqual({shifts:[]});expect(JSON.parse(result[0].after)).toEqual({shifts:[shift]});expect(result[0].note).toBe(old.note);expect(result[1]).toEqual(opaque);expect(compactAuditEntries(result)).toEqual(result);
  });
  it('多次录入记录总量按班次数量增长，每条记录不重复全表',()=>{
    let state=initialState();
    for(let i=1;i<=150;i++){
      const date=new Date(Date.UTC(2027,0,i)).toISOString().slice(0,10),shift=quickShift(date,state.rules,'day');
      const next={...state,shifts:[...state.shifts,shift]},delta=diffs(state,next);
      expect(delta.before.length+delta.after.length).toBeLessThan(2000);
      state={...next,audit:[...state.audit,{id:String(i),at:'2026-10-22T00:00:00Z',action:'保存考勤',note:'',...delta}]};
    }
    expect(JSON.stringify(state).length).toBeLessThan(500000);
  });
});
