import { useMemo, useState } from 'react';
import { ArrowUpRight, ArrowRight, CalendarCheck2, Settings2, Save, ChevronDown, Wallet, CalendarDays, ListChecks, CircleHelp } from 'lucide-react';
import type { State, Cycle, PayResult, PayItem } from '../domain/model';
import { sourceLabels, extraSchema, uid } from '../domain/model';
import { period } from '../domain/dates';
import { sum, money, attendanceTotals } from '../domain/engine';
import type { CumulativePayroll } from '../domain/payroll';
import { LifetimeSummary } from './LifetimeSummary';
import type { Commit } from './Attendance';
import { CycleEditor } from './CycleEditor';
import { PayCalculationChain } from './PayCalculationChain';
import { Badge, Modal, Notice, Field, Num, Toggle, currency, prettyHours } from './ui';
function monthlyRows(items:PayItem[]):PayItem[]{
  const groups=new Map<string,PayItem[]>();
  for(const item of items){const key=/^(night-|ot-|meal-)/.test(item.id)?item.name:item.id;groups.set(key,[...(groups.get(key)??[]),item]);}
  return [...groups.values()].map(group=>{if(group.length===1)return group[0];const first=group[0],hours=group.some(i=>i.hours)?sum(group.map(i=>i.hours||'0')).toString():'';
    return {...first,id:'summary-'+first.id,amount:money(sum(group.map(i=>i.amount))),raw:sum(group.map(i=>i.raw)).toString(),confirmed:group.every(i=>i.confirmed),source:group.every(i=>i.confirmed)?'payslip':'pending',hours,shiftIds:[...new Set(group.flatMap(i=>i.shiftIds))],formula:hours?`${hours} 小时 × ${first.rate} 元/小时`:new Set(group.map(i=>i.amount)).size===1?`${group.length} 次 × ${first.amount} 元`:group.map(i=>i.amount).join(' + '),inputs:`合计 ${group.length} 笔，其中 ${group.filter(i=>i.confirmed).length} 笔已确认。\n`+group.map(i=>i.inputs).join('\n')};
  });
}
export type OverviewView = 'period' | 'lifetime' | 'details';
const views=[{id:'period',name:'本周期',icon:CalendarDays},{id:'lifetime',name:'入职以来',icon:Wallet},{id:'details',name:'工资明细',icon:ListChecks}] as const;

export function Overview({state,cycle,result,lifetime,view,onViewChange,onSelectCycle,commit,onSnapshot,onCompare,readonly=false}:{state:State;cycle:Cycle;result:PayResult;lifetime:CumulativePayroll;view:OverviewView;onViewChange:(view:OverviewView)=>void;onSelectCycle:(month:string)=>void;commit:Commit;onSnapshot:()=>void;onCompare:()=>void;readonly?:boolean}){
  const [editing,setEditing]=useState(false),[detail,setDetail]=useState<PayItem|null>(null),[filter,setFilter]=useState('all');
  const [addition,setAddition]=useState<{kind:'performance'|'extra';name:string;amount:string;note:string;confirmed:boolean}|null>(null),[additionError,setAdditionError]=useState('');
  const accrued=cycle.mode==='attendance',bounds=period(cycle.month,state.rules.cycleEnd),slip=state.payslips.find(p=>p.month===cycle.month);
  const cycleAttendance=useMemo(()=>attendanceTotals(state.shifts,state.rules,bounds),[state.shifts,state.rules,bounds.start,bounds.end]);
  const closed=bounds.end<new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
  const settleMonth=()=>commit('按整月结算本期',cycle.month+'；使用合同月基本工资，排班休息不自动扣薪；无薪缺勤和实际工资条另行核对。',s=>({...s,cycles:{...s.cycles,[cycle.month]:{...(s.cycles[cycle.month]??cycle),mode:'full'}}}));
  const visible=(i:PayItem)=>filter==='all'||filter==='confirmed'&&i.confirmed||filter==='expected'&&!i.confirmed;
  const wageRows=monthlyRows(result.items.filter(i=>!i.deduction&&i.method==='cash').filter(visible)),deductionRows=result.items.filter(i=>i.deduction).filter(visible),benefits=result.items.filter(i=>!i.deduction&&i.method!=='cash');
  const saveAddition=async()=>{
    if(!addition||readonly)return;
    const parsed=extraSchema.safeParse({id:uid(),name:addition.kind==='performance'?'绩效奖金':addition.name,amount:addition.amount,note:addition.note,confirmed:addition.confirmed,method:'cash',source:addition.confirmed?'payslip':'manual'});
    if(!parsed.success){setAdditionError('请填写项目名称和有效金额。');return;}
    const updated=addition.kind==='performance'?{...cycle,performanceActual:parsed.data.amount,performanceConfirmed:parsed.data.confirmed}:{...cycle,extras:[...cycle.extras,parsed.data]};
    if(await commit('记录本月加项',cycle.month+'；'+parsed.data.name+'；'+parsed.data.note,s=>({...s,cycles:{...s.cycles,[cycle.month]:updated}}))){setAddition(null);setAdditionError('');}
  };
  const renderRow=(i:PayItem)=><tr key={i.id} data-pay-item={i.id} onClick={()=>setDetail(i)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setDetail(i);}}><td><strong>{i.name}</strong><small>{i.hours?prettyHours(i.hours)+' 小时':i.id.startsWith('summary-night-')?i.shiftIds.length+' 班累计':i.deduction?'个人承担部分':'本月工资项目'}</small></td><td><Badge tone={i.confirmed?'green':'amber'}>{i.confirmed?'已确认':'预计 / 待核验'}</Badge></td><td className={i.deduction?'deduction-amount':''}>{i.deduction?'−':''}{currency(i.amount)}</td><td><ArrowUpRight size={15}/></td></tr>;
  const hasActual=slip!==undefined&&slip.actualNet!=='';
  return <div className="pay-overview">
    <header className="page-title overview-title"><div><span className="eyebrow">班薪记 · 工资账本</span><h1>工资总览<span className="title-dot">。</span></h1><p>看本期进度、入职累计，也能逐笔核对。</p></div></header>
    <div className="overview-nav">
      <nav aria-label="总览视图">{views.map(({id,name,icon:Icon})=><button key={id} type="button" aria-pressed={view===id} onClick={()=>onViewChange(id)}><Icon size={17}/>{name}</button>)}</nav>
      {view!=='lifetime'&&<div className="overview-actions"><button className="button secondary small-button" onClick={()=>setEditing(true)} disabled={readonly}><Settings2 size={16}/>本周期参数</button><button className="button secondary small-button" onClick={onSnapshot} disabled={readonly}><Save size={16}/>保存工资快照</button></div>}
    </div>
    {view==='period'&&<div className="overview-panel" role="region" aria-label="本周期总览">
      <div className="overview-period-grid">
        <section className="pay-hero overview-hero"><div className="hero-top"><span>{accrued?'已录考勤累计应发':'预计实发工资'}</span><Badge tone="hero">{readonly?'历史快照':'工资估算'}</Badge></div>
          <div className="hero-amount" data-testid={accrued?'earned':'net'}>{currency(accrued?result.gross:result.net)}</div>
          <p className="hero-caption">{accrued?'按已录工时、津贴与奖金累计':'应发工资减去已录及参考扣款'}</p>
          <dl className="overview-hero-facts"><div><dt>{accrued?'扣款后参考到账':'税前应发'}</dt><dd data-testid={accrued?'net':undefined}>{currency(accrued?result.net:result.gross)}</dd></div><div><dt>个人扣款 · 含参考</dt><dd>{currency(result.deductions)}</dd></div></dl>
          <div className="hero-bottom"><CalendarCheck2 size={16}/><span>{bounds.start} — {bounds.end}</span><button className="text-button" onClick={()=>onViewChange('details')}>查看明细 <ArrowRight size={14}/></button></div>
        </section>
        <section className="card overview-period-side" aria-label="本周期出勤和到账">
          <div className="attendance-summary-heading"><h2>本周期出勤</h2><span>{result.stats.day} 白班 / 短班 · {result.stats.night} 夜班</span></div>
          <div className="attendance-summary-values"><div><span>上班天数</span><strong><span data-testid="period-workdays">{cycleAttendance.days}</span><small> 天</small></strong></div><div><span>总工时</span><strong><span data-testid="period-workhours">{prettyHours(cycleAttendance.hours)}</span><small> 小时</small></strong></div></div>
          <div className="overview-actual"><div><span>工资条实际到账</span><strong data-testid="period-actual">{hasActual?currency(slip.actualNet):'待录入'}</strong>{hasActual&&<small className="muted">{slip.confirmed?'已确认到账':'待确认到账'}</small>}</div><button className="text-button" onClick={onCompare}>工资条核对 <ArrowRight size={14}/></button></div>
        </section>
      </div>
    {accrued&&closed&&cycle.baseActual===''&&!readonly&&<section className="card settlement-card" aria-label="完整周期结算提示"><h2>本周期已结束，请核对底薪结算</h2><p className="muted small">当前底薪 {currency(result.items.find(i=>i.id==='base')?.amount??'0')} 是已录正常工时及带薪假的累计，不等于完整周期的合同月底薪。确认本期完整在职、休息属于排班且没有另行无薪扣款时，可按月底薪 {currency(state.rules.base)} 结算，加班费另加。需要扣薪的个人请假，请在本周期参数录入实际扣款。</p><button className="button secondary small-button" onClick={settleMonth}>按整月结算本期</button></section>}
    </div>}
    {view==='lifetime'&&<LifetimeSummary payroll={lifetime} hireDate={state.rules.hireDate} onSelect={onSelectCycle}/>}
    {view==='details'&&<div className="overview-panel" role="region" aria-label="本周期工资明细">
    <div className="content-columns overview-details-grid"><div className="stack"><section className="card ledger-card" aria-label="当月工资条"><div className="section-heading"><div><h2>{cycle.month} 工资条</h2><p className="muted small">已确认现金 {currency(result.confirmedCash)} · 待核验现金 {currency(result.expectedCash)}</p></div><select className="filter-select" aria-label="筛选工资项目" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部项目</option><option value="confirmed">已确认</option><option value="expected">预计 / 待核验</option></select></div>
    <div className="monthly-section-title"><h3>工资收入 · 本期合计</h3><strong>{currency(result.gross)}</strong></div><div className="table-scroll"><table className="ledger-table" data-testid="monthly-income"><thead><tr><th>工资项目</th><th>状态</th><th>金额（元）</th><th/></tr></thead><tbody>{wageRows.map(renderRow)}</tbody><tfoot><tr><td>本期应发工资</td><td>不含饭卡</td><td>{currency(result.gross)}</td><td/></tr></tfoot></table></div>
    <div className="monthly-additions"><p className="muted small">{result.items.some(i=>i.id==='performance')?'绩效已按本期记录计入。':'绩效金额尚未填写，暂未计入应发。'}其他奖金、补发可在这里追加。</p><button className="button secondary small-button" disabled={readonly} onClick={()=>{setAdditionError('');setAddition({kind:'performance',name:'其他奖金 / 补发',amount:cycle.performanceActual,note:'',confirmed:cycle.performanceConfirmed});}}>记录绩效 / 其他收入</button></div>
    <div className="monthly-section-title"><h3>个人扣款 · 本期合计</h3><strong>−{currency(result.deductions)}</strong></div>{deductionRows.length?<div className="table-scroll"><table className="ledger-table" data-testid="monthly-deductions"><thead><tr><th>扣款项目</th><th>状态</th><th>金额（元）</th><th/></tr></thead><tbody>{deductionRows.map(renderRow)}</tbody></table></div>:<p className="muted small monthly-empty">{filter==='all'?'尚未记录扣款，不代表实际扣款为零。':'此筛选条件下没有扣款项目。'}</p>}
    <div className="monthly-net"><span>{accrued?'扣款后参考到账':'预计实发工资'}<small>应发 {currency(result.gross)} − 扣款 {currency(result.deductions)}</small></span><strong data-testid="net">{currency(result.net)}</strong></div><p className="muted small monthly-empty">{accrued?'只累计已录班次的正常工时工资，不预加整月底薪。五险一金仍按月参考，累计收入不足时扣后参考可能为负，不代表欠款。':'本周期使用手选的整月预测、部分周期或实际工资口径；基本工资不重复相加。'}</p></section>
    {benefits.length>0&&<section className="card benefits-card" aria-label="饭卡和非现金福利"><div className="section-heading"><h2>饭卡与非现金福利</h2><Badge>不计工资</Badge></div>{benefits.map(i=><button className="benefit-row" key={i.id} onClick={()=>setDetail(i)}><span><strong>{i.name}</strong><small>{i.method==='card'?'充入饭卡，不计应发或实发工资':i.method==='unknown'?'发放形式待确认，未计工资':'其他非现金福利'}</small></span><strong>{currency(i.amount)}</strong></button>)}<p className="muted small">夜班餐补按现金收入列在上方。</p></section>}</div>
    <aside className="stack"><section className="card"><div className="section-heading"><h2>加班工时</h2><span className="muted small">小时</span></div>{[{name:'普通工作日',key:'normal',color:'green'},{name:'休息日 · 未补休',key:'rest',color:'olive'},{name:'法定节假日',key:'holiday',color:'gold'}].map(t=><div className="hours-row" key={t.key}><span><i className={'legend-dot '+t.color+'-dot'}/>{t.name}</span><strong>{prettyHours(result.hours[t.key]||'0')} <small>h</small></strong></div>)}<div className="subtle-divider"/><p className="muted small">另有 {prettyHours(result.hours.unknown||'0')} h 类型待确认、{prettyHours(result.hours.compensated||'0')} h 已补休，未自动计双倍加班费。</p></section>    <details className="card warnings"><summary><span><CircleHelp size={18}/>本周期待确认事项 <Badge tone="amber">{result.warnings.length}</Badge></span><ChevronDown size={17}/></summary><ul>{result.warnings.map(w=><li key={w}>{w}</li>)}</ul><p className="muted small">此工具用于个人记录和核对，不会仅根据差额认定工资少发。</p></details>
</aside></div>
    <details className="overview-formula"><summary>查看工资计算过程 <ChevronDown size={17}/></summary><PayCalculationChain result={result} accrued={accrued}/></details>
    </div>}
    {editing&&<CycleEditor cycle={cycle} rules={state.rules} onClose={()=>setEditing(false)} onSave={async c=>{if(await commit('更新本周期参数','用户修改 '+c.month+' 的工资项目与扣款',s=>({...s,cycles:{...s.cycles,[c.month]:c}})))setEditing(false);}}/>}
    {addition&&<Modal title="记录本月加项" onClose={()=>setAddition(null)}><div className="modal-body"><p className="muted small">记录 {cycle.month} 的绩效、奖金或补发，计入应发工资。饭卡单列，不作为现金收入添加。</p><Field label="收入类型"><select value={addition.kind} onChange={e=>{const kind=e.target.value as 'performance'|'extra';setAddition({...addition,kind,amount:kind==='performance'?cycle.performanceActual:'',confirmed:false});}}><option value="performance">本期绩效奖金</option><option value="extra">其他奖金 / 补发</option></select></Field>{addition.kind==='extra'&&<Field label="项目名称"><input value={addition.name} onChange={e=>setAddition({...addition,name:e.target.value})} placeholder="例如：全勤奖、生日礼金、工资补发"/></Field>}<Field label="本期实际金额" hint={addition.kind==='performance'?'填写本期实际绩效，替换已有绩效记录，避免重复计算。':'此金额作为一笔额外现金收入。'}><Num value={addition.amount} onChange={v=>setAddition({...addition,amount:v})}/></Field><Field label="备注 / 依据"><input value={addition.note} onChange={e=>setAddition({...addition,note:e.target.value})}/></Field><Toggle label="金额已核对，有实际依据" value={addition.confirmed} onChange={v=>setAddition({...addition,confirmed:v})}/>{additionError&&<Notice>{additionError}</Notice>}</div><footer className="modal-footer"><button className="button secondary" onClick={()=>setAddition(null)}>取消</button><button className="button primary" onClick={saveAddition}>保存本月加项</button></footer></Modal>}
    {detail&&<Modal title={detail.name+' · 计算明细'} onClose={()=>setDetail(null)}><div className="modal-body"><div className="detail-amount">{currency(detail.amount)} <Badge tone={detail.confirmed?'green':'amber'}>{detail.confirmed?'已确认':'预计 / 待核验'}</Badge></div><dl className="detail-list"><dt>计算公式</dt><dd className="formula">{detail.formula}</dd><dt>输入 / 依据</dt><dd>{detail.inputs||'—'}</dd><dt>单价（内部精度）</dt><dd>{detail.rate||'—'}</dd><dt>加班工时</dt><dd>{detail.hours?prettyHours(detail.hours)+' h':'不适用'}</dd><dt>取整前金额</dt><dd className="break-word">{detail.raw}</dd><dt>来源</dt><dd>{sourceLabels[detail.source]}</dd><dt>来源考勤 ID</dt><dd className="break-word">{detail.shiftIds.join('、')||'本周期工资参数'}</dd></dl><Notice>同类工时与未取整金额先合并，工资项目按分取整后汇总。普通班次的正常工时不会另计基本工资。</Notice></div></Modal>}
  </div>;
}
