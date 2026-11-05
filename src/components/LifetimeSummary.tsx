import { ArrowUpRight, CalendarDays, Clock3 } from 'lucide-react';
import type { CumulativePayroll } from '../domain/payroll';
import { currency, prettyHours } from './ui';

export function LifetimeSummary({payroll,hireDate,onSelect}:{payroll:CumulativePayroll;hireDate:string;onSelect:(month:string)=>void}){
  const { records, gross, net, actual, pendingActual, confirmedCount, attendance } = payroll;
  return <div className="overview-panel" aria-label="入职以来收入" role="region">
    <div className="lifetime-head"><div><span className="eyebrow">累计账本</span><h2>入职以来</h2><p className="muted">{hireDate} 入职 · 已汇总 {records.length} 个有记录的工资周期</p></div>
      <div className="lifetime-attendance"><span><CalendarDays size={16}/><strong data-testid="total-workdays">{attendance.days}</strong> 天</span><span><Clock3 size={16}/><strong data-testid="total-workhours">{prettyHours(attendance.hours)}</strong> 小时</span></div>
    </div>
    <div className="lifetime-metrics">
      <div className="card lifetime-primary"><span>累计扣后参考到账</span><strong data-testid="lifetime-net">{net===null?'待估算':currency(net)}</strong><small>各期应发减去已录及参考扣款</small></div>
      <div className="card"><span>累计应发 · 估算</span><strong data-testid="lifetime-gross">{gross===null?'待估算':currency(gross)}</strong><small>仅汇总现金工资，不含饭卡</small></div>
      <div className="card"><span>累计已确认到账</span><strong data-testid="lifetime-actual">{actual===null?'待确认':currency(actual)}</strong><small>{confirmedCount} / {records.length} 期已确认{pendingActual!==null&&` · 待确认 ${currency(pendingActual)}`}</small></div>
    </div>
    <section className="card lifetime-ledger" aria-label="历期收入明细">
      <div className="section-heading"><div><h2>按工资周期查看</h2><p className="muted small">估算和实际到账各自汇总。点周期查看同一份工资明细。</p></div></div>
      {!records.length?<p className="muted">还没有可累计的工资记录。录入考勤或工资条后会自动更新。</p>:<div className="lifetime-periods">
        {records.map(({cycle,bounds,result,payslip,hasEstimate})=><article key={cycle.month} className="lifetime-row" data-payroll-month={cycle.month}>
          <button className="text-button lifetime-period" onClick={()=>onSelect(cycle.month)} aria-label={`查看 ${cycle.month} 工资明细`}><span><strong>{cycle.month}</strong><small>{bounds.start.slice(5)} — {bounds.end.slice(5)}</small></span><ArrowUpRight size={16}/></button>
          <div className="lifetime-row-amount"><span>应发估算</span><strong data-testid="lifetime-row-gross">{hasEstimate?currency(result.gross):'—'}</strong></div>
          <div className="lifetime-row-amount"><span>扣后参考</span><strong data-testid="lifetime-row-net">{hasEstimate?currency(result.net):'—'}</strong></div>
          <div className="lifetime-row-amount"><span>实际到账</span><strong>{payslip&&payslip.actualNet!==''?currency(payslip.actualNet):'待录入'}</strong>{payslip&&payslip.actualNet!==''&&<small>{payslip.confirmed?'已确认':'待确认'}</small>}</div>
        </article>)}
      </div>}
      <p className="muted small lifetime-note">按入职所在周期至当前周期的已录记录汇总。工资快照仅供回看；工时按账本实际出勤累计，休息、假期和草稿不计。</p>
    </section>
  </div>;
}
