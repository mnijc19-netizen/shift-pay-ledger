import { ArrowRight, ArrowDown } from 'lucide-react';
import type { PayItem, PayResult } from '../domain/model';
import { money, sum } from '../domain/engine';
import { currency } from './ui';

const insuranceNames=new Set(['养老保险','医疗保险','失业保险','住房公积金']);
export function PayCalculationChain({result}:{result:PayResult}){
  const cash=result.items.filter(i=>!i.deduction&&i.method==='cash'),deductions=result.items.filter(i=>i.deduction);
  const total=(items:PayItem[])=>money(sum(items.map(i=>i.amount)));
  const base=cash.filter(i=>i.id==='base'),ot=cash.filter(i=>i.id.startsWith('ot-')),night=cash.filter(i=>i.id.startsWith('night-'));
  const other=cash.filter(i=>!base.includes(i)&&!ot.includes(i)&&!night.includes(i));
  const insurance=deductions.filter(i=>insuranceNames.has(i.name)),tax=deductions.filter(i=>i.name==='个人所得税'),otherDeductions=deductions.filter(i=>!insurance.includes(i)&&!tax.includes(i));
  const row=(label:string,value:string)=><div className="pay-chain-row" key={label}><span>{label}</span><strong>{value}</strong></div>;
  const arrow=<span className="pay-chain-arrow" aria-hidden="true"><ArrowRight size={22}/><ArrowDown size={22}/></span>;
  return <section className="card pay-chain" aria-label="工资计算链">
    <div className="section-heading"><div><h2>工资怎么算到手</h2><p className="muted small">先加工资收入，再从应发里扣个人费用。</p></div></div>
    <div className="pay-chain-flow">
      <div className="pay-chain-step"><h3><span>1</span>先算应发工资</h3>
        {row('基本工资',currency(total(base)))}{row('＋ 加班费',currency(total(ot)))}{row('＋ 夜班餐补',currency(total(night)))}{row('＋ 绩效、其他津贴奖金',currency(total(other)))}
        <div className="pay-chain-total"><span>＝ 应发工资</span><strong data-testid="chain-gross">{currency(result.gross)}</strong></div>
      </div>{arrow}
      <div className="pay-chain-step"><h3><span>2</span>从应发里扣个人费用</h3>
        {row('个人五险一金',currency(total(insurance)))}{row('＋ 个人所得税',tax.length?currency(total(tax)):'待录入，暂未计')}{row('＋ 其他扣款',currency(total(otherDeductions)))}
        <p className="pay-chain-note">{insurance.some(i=>i.source==='pending')?'五险一金含最低参考估算；录入工资条实际扣款后，逐项替换。':'五险一金按本期已录入的个人扣款计算。'}单位承担部分不扣个人工资。</p>
        <div className="pay-chain-total"><span>＝ 扣款合计</span><strong data-testid="chain-deductions">{currency(result.deductions)}</strong></div>
      </div>{arrow}
      <div className="pay-chain-step pay-chain-result"><h3><span>3</span>预计实发到账</h3>
        <p className="pay-chain-equation">应发 {currency(result.gross)}<br/>− 个人扣款 {currency(result.deductions)}</p>
        <strong className="pay-chain-net" data-testid="chain-net">＝ {currency(result.net)}</strong>
        <p className="pay-chain-note">{tax.length?'个税使用本期录入金额。':'个税尚未录入，实际有个税时还要扣除。'}未填写的扣款不代表实际为零。</p>
      </div>
    </div>
    <p className="pay-chain-footnote">饭卡400元另存饭卡，不计应发或实发；夜班餐补已加进工资。基本工资按本周期计一次，日历中的每日分摊不再重复相加。</p>
  </section>;
}
