import { ChevronRight } from 'lucide-react';
import type { PayItem, PayResult } from '../domain/model';
import { money, sum } from '../domain/engine';
import { currency } from './ui';

const insuranceNames=new Set(['养老保险','医疗保险','失业保险','住房公积金']);
const total=(items:PayItem[])=>money(sum(items.map(i=>i.amount)));

function WageLine({label,value,calculation}:{label:string;value:string;calculation?:string}){
  return <div className="pay-chain-row">
    <div><span>{label}</span>{calculation&&<small>{calculation}</small>}</div>
    <strong>{value}</strong>
  </div>;
}

export function PayCalculationChain({result,accrued=false,asOf,onDetails}:{
  result:PayResult;accrued?:boolean;asOf?:string;onDetails?:()=>void;
}){
  const cash=result.items.filter(item=>!item.deduction&&item.method==='cash');
  const deductions=result.items.filter(item=>item.deduction);
  const base=cash.find(item=>item.id==='base');
  const overtime=cash.filter(item=>item.id.startsWith('ot-'));
  const night=cash.filter(item=>item.id.startsWith('night-'));
  const other=cash.filter(item=>item.id!=='base'&&!overtime.includes(item)&&!night.includes(item));
  const hasPerformance=other.some(item=>item.id==='performance');
  const hasTax=deductions.some(item=>item.name==='个人所得税');
  const nightCount=new Set(night.flatMap(item=>item.shiftIds)).size;
  return <section className="card pay-chain" aria-label="工资计算链">
    <div className="section-heading"><div><h2>本期工资怎么算</h2><p className="muted small">{asOf?'已录工作至 '+asOf.slice(5).replace('-',' 月 ')+' 日':'工资收入合计，再减个人扣款'}</p></div>
      {onDetails&&<button type="button" className="text-button" onClick={onDetails}>逐项明细 <ChevronRight size={15}/></button>}
    </div>
    <div className="pay-chain-flow">
      <div className="pay-chain-step">
        <h3>工资收入</h3>
        {base&&<WageLine label="基本工资" value={currency(base.amount)} calculation={base.formula}/>}
        {overtime.map(item=><WageLine key={item.id} label={item.name} value={currency(item.amount)}
          calculation={item.formula.replace(/^(\d+(?:\.\d+)?) × /,'$1 小时 × ')}/>)}
        {night.length>0&&<WageLine label="晚间餐补" value={currency(total(night))} calculation={nightCount?nightCount+' 班计入':''}/>}
        {other.map(item=><WageLine key={item.id} label={item.name} value={currency(item.amount)}/>)}
        {!hasPerformance&&<WageLine label="绩效奖金" value="待核对 · 暂未计入"/>}
        <div className="pay-chain-total"><span>应发工资</span><strong data-testid="chain-gross">{currency(result.gross)}</strong></div>
      </div>
      <div className="pay-chain-step">
        <h3>个人扣款</h3>
        {deductions.map(item=><WageLine key={item.id} label={item.name} value={currency(item.amount)}
          calculation={insuranceNames.has(item.name)?(item.formula==='工资条实际扣款'?'已录实际扣款':item.formula+' · 参考'):undefined}/>)}
        {!hasTax&&<WageLine label="个人所得税" value="待录入，暂未计"/>}
        <p className="pay-chain-note">五险一金参考按月计算。单位承担部分不扣个人工资。</p>
        <div className="pay-chain-total"><span>已计扣款</span><strong data-testid="chain-deductions">{currency(result.deductions)}</strong></div>
      </div>
    </div>
    <div className="pay-chain-result">
      <div><strong>{accrued?'扣款后参考到账':'预计实发到账'}</strong><p className="muted small">{currency(result.gross)} − {currency(result.deductions)}</p></div>
      <strong className="pay-chain-net" data-testid="chain-net">＝ {currency(result.net)}</strong>
    </div>
    <p className="pay-chain-footnote">饭卡与其他非现金福利单列。{Number(result.noncash)>0&&'本期非现金福利 '+currency(result.noncash)+'。'}</p>
  </section>;
}
