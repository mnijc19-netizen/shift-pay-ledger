import type { CalendarEntry, Shift } from './model';
import { civilMs } from './dates';

// Verified 2026-10-22. These are dated reference values, not an employer's declaration.
export const policyCheckedAt='2026-10-22';
export const policySources=[
  {title:'福州最低工资：2025-04 起 2195 元',url:'https://rst.fujian.gov.cn/zcjd/zcjd/bmzcwjjd/202501/t20250127_6710207.htm'},
  {title:'日、小时工资折算：21.75 天、8 小时',url:'https://www.mohrss.gov.cn/SYrlzyhshbzb/laodongguanxi_/zcwj/202501/t20250101_533693.html'},
  {title:'劳动法第四十四条：1.5 / 2 / 3 倍',url:'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394625.html'},
  {title:'2026 年法定放假与调休安排',url:'https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm'},
  {title:'2026 养老、失业缴费基数：4579–22893 元',url:'https://rst.fujian.gov.cn/zw/zfxxgk/zfxxgkml/zyywgz/ldgx/202610/t20261008_7221778.htm?iszzb=1'},
  {title:'养老个人比例：8%',url:'https://rst.fujian.gov.cn/wz/cjwt/czzgly/202311/t20231113_6294939.htm'},
  {title:'2026-07 起福州医保基数：4579–22893 元',url:'https://ybj.fuzhou.gov.cn/zwgk/tzgg/202607/t20260701_5341143.htm'},
  {title:'职工医保个人比例：2%',url:'https://ybj.fuzhou.gov.cn/zwgk/zczn/202406/t20240606_4837816.htm'},
  {title:'失业保险个人比例：0.5%',url:'https://www.fuzhou.gov.cn/zwgk/zdlyxxgk/shbz/sybx/202511/t20251104_5227257.htm'},
  {title:'2026 年继续降低失业保险总费率至 1%',url:'https://gxt.fujian.gov.cn/zwgk/ztjj/knxwzzcxf/xdbd/202601/t20260120_7082358.htm'},
  {title:'2026-07 至 2027-06 公积金：基数 2195 起、比例 5% 起、按元取整',url:'https://zfgjj.fuzhou.gov.cn/zwgk/gzdt/tzgg/202606/t20260630_5341026.htm'},
  {title:'住房公积金管理条例第十七条：新参加工作次月开始',url:'https://xzfg.moj.gov.cn/front/law/detail?LawID=1822'},
  {title:'长护险可从医保个人账户扣，不重复计工资现金扣款',url:'https://ybj.fujian.gov.cn/bsfw/syldylbzfw/ybbnx/202607/t20260716_7178761.htm'},
  {title:'福建法定高温津贴：260 元/月或 12 元/天，有作业条件',url:'https://rst.fujian.gov.cn/zw/zfxxgk/zfxxgkml/flfggfxwj/gfxwj/202310/t20231020_6279258.htm'},
];
export interface InsuranceReference {name:string;base:string;rate:string;wholeYuan:boolean}
export function insuranceReference(month:string,hireDate=''):InsuranceReference[]{
  // Earlier periods remain actual-only rather than borrowing today's base.
  if(month<'2026-07')return [];
  if(hireDate&&month<hireDate.slice(0,7))return [];
  return [
    {name:'养老保险',base:'4579',rate:'8',wholeYuan:false},
    {name:'医疗保险',base:'4579',rate:'2',wholeYuan:false},
    // The 2026 notice was issued on Sep 18; unemployment changes the next month.
    {name:'失业保险',base:month<'2026-10'?'4043':'4579',rate:'0.5',wholeYuan:false},
    {name:'住房公积金',base:'2195',rate:'5',wholeYuan:true},
  ].filter(ref=>ref.name!=='住房公积金'||!hireDate||month>hireDate.slice(0,7));
}
export const policyConflicts=[
  '原来的日工资分母 23 来自历史工资条；新预测按 21.75。历史周期保留原分母与快照，不能把两种口径混成同一个结果。',
  '最低基数参考约 590.80 元/月，不固定扣 600 元。实际缴费应按规定核定工资基数并限高保低，不能统一用上月应发的 57%；最低参考也不代表高工资员工可以一律按最低申报。',
  '公积金最低个人比例按 5% 参考，2195 × 5% 按元四舍五入为 110 元；企业实际比例可为 5%–12%。新参加工作从次月缴存，不能一律推迟到转正。入职首月或补缴请填实际扣款。',
  '标准五天八小时下，休息日未补休为 2 倍，官方调休上班日按工作日；连续放假不全是 3 倍，法定当天才按 3 倍，夜班跨零点拆分。个人排班或已补休可在详细录入中修正。',
  '25 元是两班倒加班超过 22:00 的晚餐补贴。按实际起止时间和加班工时判断，提前到 22:00 或之前下班不会自动加；普通工作日 8 小时短夜班也不自动认作加班。历史工资条实际金额优先。',
  '截图的 6–9 月 50 元保留为公司夏季福利，按本期资格启用。若符合福建高温作业条件，另须核验法定高温津贴 260 元/月或 12 元/天，不能把 50 元当成法定标准。',
  '社保登记期限不等于免缴期；不把“入职满 7 个工作日”“社保可不补缴”写成法定豁免。工伤、生育个人通常不缴；长护险医保个人账户划扣不重复从工资扣，额外实际工资扣款可手动录入。',
  '绩效只有试用期 60% 比例，尚无正式金额或每小时单价；6500–7500 元是招聘区间，暂不据此虚构绩效或保底实发。400 元餐补发放形式未明，继续单列待确认。',
];

const holidaySource=policySources[3].url;
export const statutoryCalendar2026:CalendarEntry[]=[];
for(const [label,dates,legal] of [
  ['元旦',['01-01','01-02','01-03'],['01-01']],
  ['春节',['02-15','02-16','02-17','02-18','02-19','02-20','02-21','02-22','02-23'],['02-16','02-17','02-18','02-19']],
  ['清明节',['04-04','04-05','04-06'],['04-05']],
  ['劳动节',['05-01','05-02','05-03','05-04','05-05'],['05-01','05-02']],
  ['端午节',['06-19','06-20','06-21'],['06-19']],
  ['中秋节',['09-25','09-26','09-27'],['09-25']],
  ['国庆节',['10-01','10-02','10-03','10-04','10-05','10-06','10-07'],['10-01','10-02','10-03']],
] as const){for(const date of dates)statutoryCalendar2026.push({date:'2026-'+date,type:(legal as readonly string[]).includes(date)?'statutory':'holidayBreak',label,source:holidaySource});}
for(const date of ['01-04','02-14','02-28','05-09','09-20','10-10'])statutoryCalendar2026.push({date:'2026-'+date,type:'makeup',label:'官方调休上班',source:holidaySource});

export function isLateMealEligible(s:Shift,hasOvertime:boolean){
  return hasOvertime&&civilMs(s.end)>civilMs(s.date+'T22:00');
}
