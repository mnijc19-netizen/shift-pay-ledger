import { useMemo, useState } from 'react';
import { Plus, ChevronLeft, ChevronRight, Moon, Sun, Trash2, Copy, Check, Clock3 } from 'lucide-react';
import type { Rules, Shift, State, Cycle } from '../domain/model';
import { shiftSchema, shiftTypes, shiftLabels, otTypes, otLabels, sourceLabels } from '../domain/model';
import { daysIn, shiftMonth, nextDate, period } from '../domain/dates';
import { newShift, quickShift } from '../domain/seed';
import type { QuickType } from '../domain/seed';
import { splitShift, analyzeShifts, dailyEarnings, dailyWageDetails, sum, money, nonWork, validateAttendance } from '../domain/engine';
import { DailyPayDetails } from './DailyPayDetails';
import { Badge, Field, Num, Toggle, Modal, Notice, currency, prettyHours } from './ui';
export type Commit=(action:string,note:string,update:(s:State)=>State)=>boolean;

function ShiftEditor({shift,r,others,cycles,onSave,onDelete,onClose}:{shift:Shift;r:Rules;others:Shift[];cycles:Record<string,Cycle>;onSave:(s:Shift)=>void;onDelete:()=>void;onClose:()=>void}){
  const [s,set]=useState(()=>({...shift,source:shift.ruleVersion!==r.version&&shift.source==='payslip'?'pending' as const:shift.source,allowanceConfirmed:shift.allowanceConfirmed&&(shift.ruleVersion===r.version||shift.nightAmount!=='')})),[error,setError]=useState('');const field=<K extends keyof Shift>(key:K,value:Shift[K])=>set(v=>({...v,[key]:value}));
  const preview=(candidate:Shift)=>analyzeShifts([...others.filter(x=>x.id!==s.id),{...candidate,draft:false}],r).get(s.id)!;
  let output:ReturnType<typeof splitShift>={segments:[],warnings:[]};let calcError='';try{output=preview(s);}catch(e){calcError=(e as Error).message;try{output=preview({...s,overrides:Object.fromEntries(Object.entries(s.overrides).map(([day,o])=>[day,{...o,hours:''}]))});}catch{/* Keep invalid times editable until corrected. */}}
  let wageDetails:ReturnType<typeof dailyWageDetails>;try{wageDetails=dailyWageDetails(s.date,r,[...others.filter(x=>x.id!==s.id),{...s,draft:false}],cycles);}catch{/* Invalid draft times remain editable. */}
  const save=()=>{const parsed=shiftSchema.safeParse({...s,ruleVersion:r.version});if(!parsed.success){setError(parsed.error.issues.map(i=>i.message).join('；'));return;}if(calcError){setError(calcError);return;}onSave(parsed.data);};
  return <Modal title={s.draft?'排班草稿 · 确认后才计薪':'考勤记录与计算明细'} onClose={onClose} wide><div className="modal-body"><DailyPayDetails details={wageDetails}/>
    <div className="form-grid"><Field label="归属日期（上班日期）"><input type="date" value={s.date} onChange={e=>{const date=e.target.value;if(date)set(v=>({...v,date,start:date+v.start.slice(10),end:(v.end.slice(0,10)!==v.date?nextDate(date):date)+v.end.slice(10),overrides:{}}));}}/></Field><Field label="考勤类型"><select value={s.type} onChange={e=>{const type=e.target.value as Shift['type'];const fresh=newShift(s.date,r,type);set(v=>({...v,type,start:fresh.start,end:fresh.end,nightAllowance:fresh.nightAllowance,overrides:{},ot:type==='restWork'?'rest':type==='compWork'?'compensated':type==='holiday'?'holiday':v.ot}));}}>{shiftTypes.map(t=><option value={t} key={t}>{shiftLabels[t]}</option>)}</select></Field>
    {!nonWork(s)&&<><Field label="实际上班"><input type="datetime-local" value={s.start} onChange={e=>{field('start',e.target.value);field('date',e.target.value.slice(0,10));}}/></Field><Field label="实际下班（夜班选次日）"><input type="datetime-local" value={s.end} onChange={e=>field('end',e.target.value)}/></Field><Field label="吃饭分钟"><Num value={s.mealMinutes} onChange={v=>field('mealMinutes',v)}/></Field><Field label="吃饭开始：上班后第几分钟"><Num value={s.mealOffset} onChange={v=>field('mealOffset',v)}/></Field><Field label="手动计薪工时" hint="填写后优先使用，不再扣除吃饭或短休息。"><Num value={s.paidHours} onChange={v=>field('paidHours',v)} placeholder="留空由时间计算"/></Field><Field label="手动加班类型" hint="开启日历时按标准排班自动判断，详见下方分段；关闭日历可手动指定。"><select value={s.ot} onChange={e=>field('ot',e.target.value as Shift['ot'])}>{otTypes.map(t=><option value={t} key={t}>{otLabels[t]}</option>)}</select></Field></>}
    </div>
    {!nonWork(s)&&<><Toggle label="参考法定节假日与个人排班日历" value={s.useCalendar} onChange={v=>field('useCalendar',v)} hint="法定日优先；关闭后使用手动类型。标准工时参考官方调休及周末；排班有变化可手动修正。"/><Toggle label="额外扣除两次短休息" value={s.deductShort} onChange={v=>field('deductShort',v)}/>{s.deductShort&&<div className="form-grid thirds"><Field label="每次休息分钟"><Num value={s.shortMinutes} onChange={v=>field('shortMinutes',v)}/></Field><Field label="第一次：上班后分钟"><Num value={s.break1} onChange={v=>field('break1',v)}/></Field><Field label="第二次：上班后分钟"><Num value={s.break2} onChange={v=>field('break2',v)}/></Field></div>}
    <div className="inset"><div className="section-heading"><h3>时段拆分</h3><Badge>{r.split?'跨日期按实际时段':'整班按开始日期'}</Badge></div><p className="muted small">工资归属始终按上班日期，默认整班沿用当天倍率。手动分段修正优先；填写分段小时须填齐全部日期并与总工时一致。</p>{output.segments.map(seg=><div className="segment" key={seg.date}><div><strong>{seg.date}</strong><small>{seg.start} — {seg.end==='00:00'?'24:00':seg.end} · 计薪 {prettyHours(seg.hours)} h</small></div><select aria-label={seg.date+' 分段类型'} value={s.overrides[seg.date]?.type??seg.type} onChange={e=>field('overrides',{...s.overrides,[seg.date]:{type:e.target.value as Shift['ot'],hours:s.overrides[seg.date]?.hours??''}})}>{otTypes.map(t=><option value={t} key={t}>{otLabels[t]}</option>)}</select><input type="number" aria-label={seg.date+' 分段小时'} step="any" min="0" value={s.overrides[seg.date]?.hours??''} placeholder={prettyHours(seg.hours)+' h'} onChange={e=>field('overrides',{...s.overrides,[seg.date]:{type:seg.type,hours:e.target.value}})}/><span>{currency(money(seg.raw))}</span></div>)}<button className="text-button" onClick={()=>field('overrides',{})}>清除分段修正</button><p className="formula">{output.segments.map(seg=>`${seg.date}：${prettyHours(seg.normal)} h 正常 + ${prettyHours(seg.overtime)} h 加班`).join('；')||'此记录不生成加班费'}</p>{output.warnings.map(w=><p key={w} className="small amber-text">{w}</p>)}</div>
    <Toggle label="符合白班加班餐补条件" value={s.dayMeal} onChange={v=>field('dayMeal',v)}/><Toggle label="本班启用22点后加班晚餐补贴" value={s.nightAllowance} onChange={v=>field('nightAllowance',v)}/>{s.nightAllowance&&<Field label="本班晚餐补贴实际金额"><Num value={s.nightAmount} placeholder={'默认 '+r.night} onChange={v=>field('nightAmount',v)}/></Field>}<Toggle label="本班津贴已由工资条确认" value={s.allowanceConfirmed} onChange={v=>field('allowanceConfirmed',v)}/></>}
    <div className="form-grid"><Field label="加班费来源与确认"><select value={s.source} onChange={e=>field('source',e.target.value as Shift['source'])}>{Object.entries(sourceLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="备注 / 修改依据"><input value={s.note} onChange={e=>field('note',e.target.value)} placeholder="填写工时或分类的依据"/></Field></div><Toggle label="保留为草稿（不计入工资）" value={s.draft} onChange={v=>field('draft',v)}/>
    {(error||calcError)&&<Notice>{error||calcError}</Notice>}</div><footer className="modal-footer"><button className="button danger ghost" onClick={onDelete}><Trash2 size={16}/>删除记录</button><div><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" onClick={save}><Check size={16}/>保存记录</button></div></footer></Modal>;
}

function QuickEditor({date,record,r,cycles,allShifts,onSave,onDelete,onDetails,onClose}:{date:string;record?:Shift;r:Rules;cycles:Record<string,Cycle>;allShifts:Shift[];onSave:(s:Shift)=>void;onDelete:()=>void;onDetails:(s:Shift)=>void;onClose:()=>void}){
  const [day,setDay]=useState(date),[type,setType]=useState<QuickType>(record?.type==='night'?'night':record?.type==='rest'?'rest':'day');
  const [hours,setHours]=useState(()=>record&&!nonWork(record)?sum(splitShift({...record,draft:false},r).segments.map(x=>x.hours)).toString():'12');
  const [error,setError]=useState('');
  const candidate=()=>quickShift(day,r,type,hours,record);
  let wageDetails:ReturnType<typeof dailyWageDetails>;
  try{wageDetails=dailyWageDetails(day,r,[...allShifts.filter(s=>s.id!==record?.id),{...candidate(),draft:false}],cycles);}catch{/* Incomplete hours stay editable; saving displays validation errors. */}
  return <Modal title={record?'修改当天工时':'快速录入'} onClose={onClose}><div className="modal-body quick-editor">
    <DailyPayDetails details={wageDetails}/>
    <Field label="日期"><input type="date" value={day} onChange={e=>setDay(e.target.value)}/></Field>
    <div className="shift-picker" role="group" aria-label="班次选择">{(['day','night','rest'] as const).map(t=><button key={t} className={type===t?'selected':''} aria-pressed={type===t} onClick={()=>setType(t)}>{t==='day'?<Sun size={20}/>:t==='night'?<Moon size={20}/>:<Clock3 size={20}/>}<strong>{t==='day'?'白班':t==='night'?'夜班':'休息'}</strong><small>{t==='day'?'08:00 开始':t==='night'?'20:00 开始':'不计工时'}</small></button>)}</div>
    {type!=='rest'&&<div className="hours-entry"><Field label="今天上几个小时"><input type="number" min="0.5" max="24" step="0.5" inputMode="decimal" value={hours} onChange={e=>setHours(e.target.value)}/></Field><span>小时</span><p>正常一班填 12，提前下班改这里。吃饭不扣工时。</p></div>}
    <p className="muted small">{r.split?'此账本按实际日期分别判断倍率。':`整班按 ${day} 的工资标准，过零点不换倍率。`}补休或个人排班可在详细设置修改。</p>
    {error&&<Notice>{error}</Notice>}
    <button className="text-button" onClick={()=>{try{onDetails(candidate());}catch(e){setError((e as Error).message);}}}>详细设置与计算明细 →</button>
  </div><footer className="modal-footer">{record?<button className="button danger ghost" onClick={onDelete}><Trash2 size={15}/>删除记录</button>:<button className="button secondary" onClick={onClose}>取消</button>}<button className="button primary" onClick={()=>{try{onSave(candidate());}catch(e){setError((e as Error).message);}}}><Check size={16}/>保存记录</button></footer></Modal>;
}

export function Attendance({state,month,commit}:{state:State;month:string;commit:Commit}){
  const [view,setView]=useState(month),[edit,setEdit]=useState<Shift|null>(null),[quick,setQuick]=useState<{date:string;record?:Shift}|null>(null);
  const [batch,setBatch]=useState(false),[start,setStart]=useState(month+'-01'),[end,setEnd]=useState(month+'-07'),[batchType,setBatchType]=useState<Shift['type']>('day'),[error,setError]=useState('');
  const [quickType,setQuickType]=useState<QuickType>(()=>{try{const t=localStorage.getItem('shift-pay:quick-type');return t==='night'||t==='rest'?t:'day';}catch{return 'day';}});
  const [quickHours,setQuickHours]=useState('12');
  const days=daysIn(view),offset=(new Date(days[0]+'T00:00:00Z').getUTCDay()+6)%7,r=state.rules,bounds=period(month,r.cycleEnd);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
  const drafts=state.shifts.filter(s=>s.draft&&s.date>=bounds.start&&s.date<=bounds.end);
  const analyses=useMemo(()=>analyzeShifts(state.shifts,r),[state.shifts,r]);
  const earnings=useMemo(()=>dailyEarnings(r,state.shifts,state.cycles),[r,state.shifts,state.cycles]);
  const save=(s:Shift)=>{
    const success=commit('保存考勤',s.note||'用户修改班次',old=>{
      const shifts=[...old.shifts.filter(x=>x.id!==s.id),s];
      validateAttendance(shifts);splitShift(s,old.rules);return {...old,shifts};
    });
    if(success){setEdit(null);setQuick(null);setError('');setQuickHours('12');}
    return success;
  };
  const openRecord=(s:Shift)=>{
    if(['day','night','short','rest'].includes(s.type))setQuick({date:s.date,record:s});
    else setEdit(s);
  };
  const selectType=(t:QuickType)=>{setQuickType(t);try{localStorage.setItem('shift-pay:quick-type',t);}catch{/* Financial data storage reports its own errors. */}};
  const tapDate=(day:string)=>{
    const record=state.shifts.find(s=>s.date===day);
    if(record){openRecord(record);return;}
    try{save(quickShift(day,r,quickType,quickHours));}catch(e){setError((e as Error).message);}
  };
  const createBatch=()=>{
    if(!start||!end||start>end||new Date(end).getTime()-new Date(start).getTime()>62*86400000){setError('请选择不超过 63 天的有效日期范围。');return;}
    const dates:string[]=[];for(let d=start;d<=end;d=nextDate(d))dates.push(d);
    const available=dates.filter(d=>!state.shifts.some(s=>s.date===d));
    if(commit('生成排班草稿',start+' 至 '+end+'；跳过已有日期',s=>({...s,shifts:[...s.shifts,...available.map(date=>({...newShift(date,r,batchType),draft:true,note:'批量排班草稿；须核实后计薪。'}))]})))setBatch(false);
  };
  const deleteRecord=(s:Shift)=>{if(commit('删除考勤',s.note||'用户删除记录',old=>({...old,shifts:old.shifts.filter(x=>x.id!==s.id)}))){setEdit(null);setQuick(null);}};
  return <>
    <div className="page-title">
      <div><span className="eyebrow">ATTENDANCE</span><h1>今天这一班，点一下就记好</h1><p>选白班或夜班，再点日期。默认 12 小时，吃饭不扣工时。</p></div>
      <div className="button-row">
        <button className="button secondary" onClick={()=>setEdit(newShift(today.startsWith(view)?today:view+'-01',r))}>详细录入</button>
        <button className="button primary" onClick={()=>setQuick({date:today.startsWith(view)?today:view+'-01'})}><Plus size={18}/>新增考勤</button>
      </div>
    </div>
    <section className="card quick-entry-bar">
      <div className="quick-entry-copy"><strong>点日期直接记班</strong><small>已录入的日期，点开即可改工时</small></div>
      <div className="quick-type-buttons" role="group" aria-label="快速录入班次">
        {(['day','night','rest'] as const).map(t=><button key={t} className={quickType===t?'selected':''} aria-pressed={quickType===t} onClick={()=>selectType(t)}>
          {t==='day'?<Sun size={17}/>:t==='night'?<Moon size={17}/>:<Clock3 size={17}/>}
          <span>{t==='day'?'白班':t==='night'?'夜班':'休息'}<small>{t==='day'?'08:00—20:00':t==='night'?'20:00—次日08:00':'不记工时'}</small></span>
        </button>)}
      </div>
      {quickType!=='rest'&&<div className="quick-hours"><label htmlFor="quick-hours">这一天上</label><input id="quick-hours" aria-label="快速录入工时" type="number" min="0.5" max="24" step="0.5" inputMode="decimal" value={quickHours} onChange={e=>{setQuickHours(e.target.value);setError('');}}/><span>小时</span></div>}
      <p className="quick-entry-hint">已内置五天八小时、周末休息及官方调休；法定日按3倍、休息日未补休按2倍，{r.split?'跨零点按日期分别计算。':'整班按开始上班那天的标准计算。'}</p>
      {error&&<Notice>{error}</Notice>}
    </section>
    <div className="calendar-layout">
      <section className="card calendar-card">
        <div className="section-heading">
          <div className="month-switch"><button className="icon-button" aria-label="上个月" onClick={()=>setView(shiftMonth(view,-1))}><ChevronLeft size={18}/></button><h2>{view.replace('-',' 年 ')} 月</h2><button className="icon-button" aria-label="下个月" onClick={()=>setView(shiftMonth(view,1))}><ChevronRight size={18}/></button></div>
          <button className="button secondary small-button" onClick={()=>setBatch(true)}><Copy size={15}/>排班草稿</button>
        </div>
        <div className="calendar-week">{'一二三四五六日'.split('').map(d=><span key={d}>{d}</span>)}</div>
        <div className="calendar-grid">
          {Array.from({length:offset},(_,i)=><div key={'empty'+i} className="calendar-empty"/>)}
          {days.map(day=>{
            const records=state.shifts.filter(s=>s.date===day),entry=r.calendar.find(c=>c.date===day),inCycle=day>=bounds.start&&day<=bounds.end,earning=earnings.get(day);
            return <button key={day} data-date={day} aria-label={day+(records.length?' 修改考勤':' 录入'+(quickType==='night'?'夜班':quickType==='rest'?'休息':'白班'))} className={'calendar-day '+(inCycle?'in-cycle ':'')+(records.length?'has-record ':'')+(day===today?'today':'')} onClick={()=>tapDate(day)}>
              <div className="date-line"><span>{Number(day.slice(-2))}</span>{entry&&<em className={entry.type==='statutory'?'holiday-marker':'day-marker'}>{entry.type==='statutory'?'法':entry.type==='makeup'?'班':entry.type==='personalRest'?'休':'假'}</em>}</div>
              {records.map(s=>{
                const h=sum((analyses.get(s.id)?.segments??[]).map(x=>x.hours)).toString();
                return <div className={'day-record '+s.type+(s.draft?' draft':'')} key={s.id}>
                  {s.type==='night'?<Moon size={12}/>:!nonWork(s)?<Sun size={12}/>:null}
                  <span>{s.draft?'草稿':s.type==='short'?'短班':s.type==='holiday'?'节假日班':shiftLabels[s.type]}</span>
                  {!nonWork(s)&&!s.draft&&<small>{prettyHours(h)} 小时</small>}
                </div>;
              })}
              {earning&&<div className={'daily-earnings '+(earning.pending?'pending':'')} title={'基本工资按日展示 '+currency(earning.base)+' + 加班 '+currency(earning.overtime)+' + 本班津贴 '+currency(earning.allowances)+(earning.pending?'；加班类型待确认':'')}>
                <small>{earning.pending?'加班待定':'预计收入'}</small><strong>{currency(earning.total)}</strong>
              </div>}
              {!records.length&&<span className="unrecorded">+ 记{quickType==='night'?'夜班':quickType==='rest'?'休息':'白班'}</span>}
              {records.length>1&&<span className="calendar-record-count">共 {records.length} 条，见下方</span>}
            </button>;
          })}
        </div>
        <div className="calendar-legend"><span><i className="legend-dot green-dot"/>所选工资周期</span><span><em className="holiday-marker">法</em>法定节假日</span><span><em className="day-marker">班</em>调休工作日</span></div>
        <p className="daily-earning-note">每日税前预计 = 正常计薪工时折算 + 加班费 + 本班补贴。休息日加班不另加基本日薪，整班归上班日，月度奖金和扣款在总览核算。</p>
      </section>
      <aside className="stack">
        <section className="card quick-guide"><div className="mini-icon"><Clock3 size={20}/></div><h3>正常上班，只需点日期</h3><ol className="tips"><li>选白班或夜班，默认计薪 12 小时。</li><li>提前下班，只改“这一天上”几个小时。</li><li>点空白日期立即录入，再点已记日期即可修改。</li></ol><Notice>工资条确认的历史工时保持原记录。夜班工资归上班日期所属周期。</Notice></section>
        <section className="card"><h3>待确认草稿 <Badge tone="amber">{drafts.length}</Badge></h3><p className="muted small">草稿不进入工资，点开确认工时即可保存。</p>{drafts.slice(0,6).map(d=><button key={d.id} className="list-button" onClick={()=>openRecord(d)}>{d.date}<span>{shiftLabels[d.type]} →</span></button>)}</section>
      </aside>
    </div>
    <section className="card">
      <div className="section-heading"><h2>{view} · 已录入记录</h2><Badge>{state.shifts.filter(s=>s.date.startsWith(view)).length} 条</Badge></div>
      <div className="records-list">{state.shifts.filter(s=>s.date.startsWith(view)).sort((a,b)=>a.start.localeCompare(b.start)).map(s=><button className="record-row" key={s.id} onClick={()=>openRecord(s)}><strong>{s.date}</strong><span>{shiftLabels[s.type]}</span><span className="muted">{nonWork(s)?'不生成加班费':s.start.slice(11)+' — '+s.end.slice(11)}</span><Badge tone={s.draft?'amber':s.source==='payslip'?'green':'muted'}>{s.draft?'草稿':sourceLabels[s.source]}</Badge><span className="truncate muted">{s.note}</span></button>)}</div>
    </section>
    {quick&&<QuickEditor key={quick.record?.id??quick.date} date={quick.date} record={quick.record} r={r} cycles={state.cycles} allShifts={state.shifts} onClose={()=>setQuick(null)} onSave={save} onDelete={()=>{if(quick.record)deleteRecord(quick.record);}} onDetails={s=>{setQuick(null);setEdit(s);}}/>}
    {edit&&<ShiftEditor key={edit.id} shift={edit} r={r} others={state.shifts} cycles={state.cycles} onSave={save} onClose={()=>setEdit(null)} onDelete={()=>deleteRecord(edit)}/>}
    {batch&&<Modal title="批量生成排班草稿" onClose={()=>setBatch(false)}><div className="modal-body"><Notice>只生成草稿，跳过已有记录的日期。每条草稿需核实后才计薪。</Notice><div className="form-grid"><Field label="开始日期"><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></Field><Field label="结束日期"><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></Field><Field label="班次"><select value={batchType} onChange={e=>setBatchType(e.target.value as Shift['type'])}>{(['day','night','rest'] as const).map(t=><option value={t} key={t}>{shiftLabels[t]}</option>)}</select></Field></div>{error&&<Notice>{error}</Notice>}</div><footer className="modal-footer"><button className="button primary" onClick={createBatch}>生成草稿</button></footer></Modal>}
  </>;
}
