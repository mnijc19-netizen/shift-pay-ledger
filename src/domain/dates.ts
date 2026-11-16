// Civil dates use UTC arithmetic as a timezone-free calendar, never the host timezone.
export const nextDate=(day:string,n=1)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function shiftMonth(month:string,n:number){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7);}
export function period(month:string,end=25){return {start:shiftMonth(month,-1)+'-'+String(end+1).padStart(2,'0'),end:month+'-'+String(end).padStart(2,'0')};}
export function monthOf(day:string,end=25){return Number(day.slice(8))>end?shiftMonth(day.slice(0,7),1):day.slice(0,7);}
export function daysIn(month:string){const count=new Date(Date.parse(shiftMonth(month,1)+'-01T00:00:00Z')-86400000).getUTCDate();return Array.from({length:count},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));}
export const civilMs=(stamp:string)=>Date.parse(stamp+'Z');
export const stamp=(ms:number)=>new Date(ms).toISOString().slice(0,16);

export function performanceStages(rules:{regularFrom?:string; employee:'trial'|'regular'; trialRatio:string},bounds:{start:string;end:string}){
  const date=rules.regularFrom;
  if(!date) return [{...bounds,ratio:rules.employee==='trial'?rules.trialRatio:'100'}];
  if(date<=bounds.start) return [{...bounds,ratio:'100'}];
  if(date>bounds.end) return [{...bounds,ratio:rules.trialRatio}];
  return [
    {start:bounds.start,end:nextDate(date,-1),ratio:rules.trialRatio},
    {start:date,end:bounds.end,ratio:'100'},
  ];
}
