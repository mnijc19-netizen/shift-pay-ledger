import { dailyWageDetails } from '../domain/engine';
import { currency, prettyHours, Badge } from './ui';

export function DailyPayDetails({details}:{details:ReturnType<typeof dailyWageDetails>}){
  if(!details)return null;
  const {earning,lines,basis}=details;
  return <section className="daily-pay-details" aria-label="当日工资明细">
    <div className="section-heading"><h3>当日工资明细</h3><Badge>{earning.pending?'含待确认工时':'税前预计'}</Badge></div>
    <p className="muted small">{basis} · {prettyHours(earning.hours)} 小时</p>
    <div className="daily-pay-lines">{lines.map(line=><div className="daily-pay-line" key={line.name}><div><strong>{line.name}</strong><small>{line.formula}</small></div><strong>{currency(line.amount)}</strong></div>)}</div>
    {!lines.length&&<p className="muted small">今天未记录工作收入，不自动补算当天工资。</p>}
    <div className="daily-pay-total"><span>当日合计</span><strong>{currency(earning.total)}</strong></div>
    <p className="muted small">默认按已录班次累计基本工资，加班费另算。月度奖金、饭卡和扣款见当月工资条。</p>
  </section>;
}
