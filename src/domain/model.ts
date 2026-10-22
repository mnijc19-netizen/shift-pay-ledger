import { z } from 'zod';

export const numeric = z.string().regex(/^\d+(\.\d+)?$/, '请输入非负十进制数').refine(v => Number.isFinite(Number(v)) && Number(v) <= 1e10, '数值过大');
const positive = numeric.refine(v => Number(v) > 0, '必须大于 0');
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, '日期无效');
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).refine(v => { const d = new Date(v + 'Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0,16) === v; });
export const otTypes = ['normal','rest','compensated','holiday','unknown'] as const;
export const dayTypes = ['statutory','holidayBreak','makeup','personalRest','ordinary'] as const;
export const shiftTypes = ['day','night','short','restWork','compWork','holiday','rest','paidLeave','unpaidLeave','absence','custom','pendingRest','onboarding'] as const;
export const sourceTypes = ['auto','manual','payslip','pending'] as const;
export const otLabels = {normal:'普通工作日',rest:'休息日 · 未补休',compensated:'休息日 · 已补休',holiday:'法定节假日',unknown:'暂不确认'};
export const dayLabels = {statutory:'法定节假日',holidayBreak:'连续休假日',makeup:'调休工作日',personalRest:'个人排班休息',ordinary:'普通工作日'};
export const shiftLabels = {day:'白班',night:'夜班',short:'短班 / 清洁',restWork:'休息日上班 · 未补休',compWork:'休息日上班 · 已补休',holiday:'法定节假日上班',rest:'正常休息',paidLeave:'带薪假',unpaidLeave:'无薪假',absence:'缺勤',custom:'其他自定义',pendingRest:'休息待确认',onboarding:'入职办理'};
export const sourceLabels = {auto:'自动计算',manual:'手动录入',payslip:'工资条确认',pending:'待核验'};
export const calendarEntrySchema = z.object({date, type:z.enum(dayTypes), label:z.string(), source:z.string()});
export const rulesSchema = z.object({
  version:z.number().int().positive(), updatedAt:z.string(), hireDate:date, employee:z.enum(['trial','regular']), fuzhouPolicy:z.boolean().default(false),
  base:positive, otBase:positive, otDays:positive, standardHours:positive.refine(v=>Number(v)<=24), baseDays:positive,
  normalRate:numeric, restRate:numeric, holidayRate:numeric, system:z.enum(['standard','comprehensive','unknown']),
  cycleEnd:z.number().int().min(1).max(28), split:z.boolean(), rounding:z.enum(['halfUp','down']),
  mealMinutes:numeric.refine(v=>Number(v)<=720), deductShort:z.boolean(), shortMinutes:numeric.refine(v=>Number(v)<=120),
  post:numeric, postEnabled:z.boolean(), postProrate:z.boolean(), meal:numeric, mealProrate:z.boolean(), mealMethod:z.enum(['cash','card','other','unknown']),
  dayMeal:numeric, night:numeric, heat:numeric, heatProrate:z.boolean(), performance:z.union([numeric,z.literal('')]), trialRatio:numeric,
  performanceMethod:z.enum(['full','prorate','manual']), midTrial:numeric, midRegular:numeric, nationalTrial:numeric, nationalRegular:numeric,
  calendar:z.array(calendarEntrySchema)
});
export const shiftSchema = z.object({
  id:z.string(), ruleVersion:z.number().int().positive().default(1), date, type:z.enum(shiftTypes), start:timestamp, end:timestamp,
  mealMinutes:numeric, mealOffset:numeric, deductShort:z.boolean(), shortMinutes:numeric, break1:numeric, break2:numeric,
  paidHours:z.union([numeric,z.literal('')]), ot:z.enum(otTypes), useCalendar:z.boolean(),
  overrides:z.record(z.string(), z.object({type:z.enum(otTypes), hours:z.union([numeric,z.literal('')])})),
  dayMeal:z.boolean(), nightAllowance:z.boolean(), nightAmount:z.union([numeric,z.literal('')]),
  allowanceConfirmed:z.boolean(), source:z.enum(sourceTypes), draft:z.boolean(), note:z.string()
}).refine(s=>s.date===s.start.slice(0,10), '归属日期须等于上班日期')
 .refine(s=>s.end>s.start && (Date.parse(s.end+'Z')-Date.parse(s.start+'Z'))/3600000<=36, '班次结束须在开始后 36 小时以内');
export const deductionNames = ['养老保险','医疗保险','失业保险','住房公积金','个人所得税','其他扣款','缺勤扣款'] as const;
export const deductionSchema = z.object({id:z.string(), name:z.string(), actual:z.union([numeric,z.literal('')]), base:z.union([numeric,z.literal('')]), rate:z.union([numeric,z.literal('')]), confirmed:z.boolean(), note:z.string()});
export const extraSchema = z.object({id:z.string(), name:z.string().min(1), amount:numeric, confirmed:z.boolean(), method:z.enum(['cash','card','other','unknown']), source:z.enum(sourceTypes), note:z.string()});
export const cycleSchema = z.object({
  month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), confirmedRuleVersion:z.number().int().positive().default(1), insuranceMode:z.enum(['manual','minimum']).default('manual'), mode:z.enum(['full','partial','manual']), expectedDays:positive, paidDays:numeric,
  denominator:z.union([positive,z.literal('')]), baseActual:z.union([numeric,z.literal('')]), baseConfirmed:z.boolean(),
  postEnabled:z.boolean(), postConfirmed:z.boolean(), mealEnabled:z.boolean(), mealConfirmed:z.boolean(), mealDuplicateChecked:z.boolean(),
  heatEnabled:z.boolean(), heatActual:z.union([numeric,z.literal('')]), heatConfirmed:z.boolean(),
  performanceActual:z.union([numeric,z.literal('')]), performanceConfirmed:z.boolean(),
  midGift:z.boolean(), midConfirmed:z.boolean(), nationalGift:z.boolean(), nationalConfirmed:z.boolean(),
  deductions:z.array(deductionSchema), extras:z.array(extraSchema)
});
export const payslipSchema = z.object({id:z.string(), month:z.string(), rows:z.array(z.object({id:z.string(), key:z.string(), name:z.string(), amount:numeric, confirmed:z.boolean(), note:z.string()})), actualNet:z.union([numeric,z.literal('')]), confirmed:z.boolean(), note:z.string()});
export const itemSchema = z.object({id:z.string(), name:z.string(), raw:z.string(), amount:z.string(), confirmed:z.boolean(), method:z.enum(['cash','card','other','unknown']), source:z.enum(sourceTypes), formula:z.string(), inputs:z.string(), hours:z.string(), rate:z.string(), shiftIds:z.array(z.string()), deduction:z.boolean()});
export const resultSchema = z.object({items:z.array(itemSchema), gross:z.string(), confirmedCash:z.string(), expectedCash:z.string(), noncash:z.string(), unknownBenefit:z.string(), deductions:z.string(), net:z.string(), warnings:z.array(z.string()), hours:z.record(z.string(),z.string()), stats:z.object({shifts:z.number(),day:z.number(),night:z.number(),rest:z.number()})});
export const snapshotSchema = z.object({id:z.string(), month:z.string(), savedAt:z.string(), rules:rulesSchema, cycle:cycleSchema, shifts:z.array(shiftSchema), result:resultSchema, payslip:payslipSchema.optional()});
export const auditSchema = z.object({id:z.string(), at:z.string(), action:z.string(), note:z.string(), before:z.string(), after:z.string(), format:z.literal('changes-v1').optional()});
export const stateSchema = z.object({schema:z.literal(1), startDateBasisApplied:z.boolean().default(false), rules:rulesSchema, shifts:z.array(shiftSchema), cycles:z.record(z.string(),cycleSchema), payslips:z.array(payslipSchema), snapshots:z.array(snapshotSchema), audit:z.array(auditSchema)});
export type Rules=z.infer<typeof rulesSchema>;
export type Shift=z.infer<typeof shiftSchema>;
export type Cycle=z.infer<typeof cycleSchema>;
export type PayItem=z.infer<typeof itemSchema>;
export type PayResult=z.infer<typeof resultSchema>;
export type State=z.infer<typeof stateSchema>;
export type Payslip=z.infer<typeof payslipSchema>;
export type OT=typeof otTypes[number];
export type CalendarEntry=z.infer<typeof calendarEntrySchema>;
export function uid(){
  if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
  const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
