import { z } from 'zod';
import { attendanceTotals, dec } from './engine';
import { period } from './dates';
import { date, numeric, payslipSchema, shiftSchema, rulesSchema, cycleSchema, type State } from './model';
import { newShift } from './seed';

const importSchema = z.object({
  kind: z.literal('shift-pay-review-v1'),
  regularFrom: date,
  payslip: payslipSchema,
  leave: z.array(z.object({ date, hours: numeric, workedHours: numeric })).max(31),
});

// Apply the reviewed facts to the current ledger inside the normal save transaction.
export function applyPayrollReview(state: State, input: unknown): State {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) throw new Error('文件格式无效，请选择班薪记工资核对补录文件。');
  const { regularFrom, payslip, leave } = parsed.data;
  if (regularFrom < state.rules.hireDate || state.rules.regularFrom && state.rules.regularFrom !== regularFrom) {
    throw new Error('转正日期与账本冲突，请先核对工资规则。');
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payslip.month) || payslip.issuedNet === undefined || payslip.actualNet !== '' || payslip.confirmed) {
    throw new Error('补录文件的工资条月份或实发记录无效。');
  }
  const bounds = period(payslip.month, state.rules.cycleEnd);
  const existing = state.payslips.find(slip => slip.month === payslip.month);
  const rowsMatch = existing?.rows.length === payslip.rows.length &&
    payslip.rows.every(row => existing.rows.some(current => current.key === row.key && dec(current.amount).eq(row.amount)));
  if (existing && (existing.rows.length > 0 && !rowsMatch ||
      existing.issuedNet !== undefined && !dec(existing.issuedNet).eq(payslip.issuedNet))) {
    throw new Error('本期已有不同的工资条，请先核对原记录。');
  }

  const shifts = [...state.shifts];
  const days = new Set<string>();
  for (const entry of leave) {
    const { date: day, hours, workedHours } = entry;
    if (day < bounds.start || day > bounds.end || day < state.rules.hireDate || days.has(day) ||
        !dec(hours).gt(0) || dec(hours).plus(workedHours).gt(state.rules.standardHours)) {
      throw new Error('补录文件的调休日期或工时无效。');
    }
    days.add(day);
    const records = shifts.filter(shift => shift.date === day);
    const existingLeave = records.filter(shift => shift.type === 'paidLeave' && !shift.draft);
    const rest = records.filter(shift => shift.type === 'rest' || shift.type === 'pendingRest');
    if (!dec(attendanceTotals(records, state.rules).hours).eq(workedHours) ||
        records.some(shift => shift.draft || shift.type === 'absence' || shift.type === 'unpaidLeave') ||
        rest.length > 1 || existingLeave.length > 1) {
      throw new Error(`${day} 的考勤与补录文件冲突，请先核对该日。`);
    }
    if (existingLeave.length) {
      if (dec(existingLeave[0].paidHours || state.rules.standardHours).eq(hours)) continue;
      throw new Error(`${day} 已有不同的带薪假工时。`);
    }
    const paidLeave = { ...newShift(day, state.rules, 'paidLeave'), paidHours: hours,
      note: `公司考勤：调休假 ${hours} 小时`, source: 'payslip' as const };
    if (rest.length) shifts[shifts.indexOf(rest[0])] = { ...paidLeave, id: rest[0].id, note: [paidLeave.note, rest[0].note].filter(Boolean).join('。') };
    else shifts.push(paidLeave);
  }

  const saved = { ...payslip, id: existing?.id ?? payslip.id, rows: rowsMatch && existing ? existing.rows : payslip.rows,
    actualNet: existing?.actualNet ?? '', confirmed: existing?.confirmed ?? false, note: existing?.note || payslip.note };
  return { ...state, rules: { ...state.rules, regularFrom }, shifts,
    payslips: [...state.payslips.filter(slip => slip.month !== payslip.month), saved] };
}

const recordChange = <T extends z.ZodType>(schema:T) => z.object({
  before:schema.nullable(),after:schema.nullable(),
});
const changesSchema=z.object({
  kind:z.literal('shift-pay-changes-v1'),
  month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  rules:z.object({before:rulesSchema,after:rulesSchema}).optional(),
  shifts:z.array(recordChange(shiftSchema)).max(500).default([]),
  payslips:z.array(recordChange(payslipSchema)).max(24).default([]),
  cycles:z.array(recordChange(cycleSchema)).max(24).default([]),
});

function recordEquals(a:unknown,b:unknown):boolean{
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const left=a as Record<string,unknown>,right=b as Record<string,unknown>;
  const keys=Object.keys(left);
  return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&recordEquals(left[key],right[key]));
}

function mergeRecords<T>(current:T[],changes:{before:T|null;after:T|null}[],id:(record:T)=>string,label:string){
  const records=new Map(current.map(record=>[id(record),record]));
  const edited=new Set<string>();
  for(const {before,after} of changes){
    const record=before??after;
    if(!record)throw new Error('账本更新缺少记录。');
    const key=id(record);
    if(edited.has(key)||after&&id(after)!==key)throw new Error(`${label}更新包含重复或变更的编号。`);
    edited.add(key);
    if(!recordEquals(records.get(key)??null,before))throw new Error(`${label}已有新的本机修改，请重新核对后再同步。`);
    if(after)records.set(key,after);
    else records.delete(key);
  }
  return [...records.values()];
}

export function applyInboxUpdate(state:State,input:unknown){
  const correction=importSchema.safeParse(input);
  if(correction.success)return {state:applyPayrollReview(state,correction.data),month:correction.data.payslip.month};
  const parsed=changesSchema.safeParse(input);
  if(!parsed.success)throw new Error('无法识别此次账本更新。');
  const update=parsed.data;
  if(update.rules&&!recordEquals(state.rules,update.rules.before))throw new Error('工资规则已有新的本机修改，请重新核对后再同步。');
  return {
    month:update.month,
    state:{...state,
      rules:update.rules?.after??state.rules,
      shifts:mergeRecords(state.shifts,update.shifts,record=>record.id,'考勤'),
      payslips:mergeRecords(state.payslips,update.payslips,record=>record.month,'工资条'),
      cycles:Object.fromEntries(mergeRecords(Object.values(state.cycles),update.cycles,record=>record.month,'工资周期').map(record=>[record.month,record])),
    },
  };
}
