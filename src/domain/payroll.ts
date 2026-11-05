import { monthOf, period } from './dates';
import { calculate, money, sum, dec, attendanceTotals } from './engine';
import type { State, Shift } from './model';
import { newCycle } from './seed';

// All live views use one calculation per payroll cycle. Saved snapshots are
// deliberately separate: multiple snapshots can describe the same pay cycle.
export function createPayrollLedger(state: State) {
  const { rules } = state;
  const shiftsByMonth = new Map<string, Shift[]>();
  for (const shift of state.shifts) {
    if (shift.draft) continue;
    const month = monthOf(shift.date, rules.cycleEnd);
    const shifts = shiftsByMonth.get(month) ?? [];
    shifts.push(shift);
    shiftsByMonth.set(month, shifts);
  }
  const payslips = new Map(state.payslips.map(p => [p.month, p]));
  const calculateCycle = (month: string) => {
    const cycle = state.cycles[month] ?? newCycle(month, rules);
    const shifts = shiftsByMonth.get(month) ?? [];
    return { cycle, shifts, bounds: period(month, rules.cycleEnd), result: calculate(rules, cycle, shifts), payslip: payslips.get(month) };
  };
  const cache = new Map<string, ReturnType<typeof calculateCycle>>();
  const get = (month: string) => {
    const cached = cache.get(month);
    if (cached) return cached;
    const record = calculateCycle(month);
    cache.set(month, record);
    return record;
  };
  const cumulative = (asOf: string) => {
    const first = monthOf(rules.hireDate, rules.cycleEnd), last = monthOf(asOf, rules.cycleEnd);
    const months = new Set([...shiftsByMonth.keys(), ...Object.keys(state.cycles), ...payslips.keys()]);
    const records = [...months].filter(month => month >= first && month <= last).sort().reverse().flatMap(month => {
      const record = get(month);
      const { cycle, result, payslip, shifts } = record;
      const hasPayInput = !!state.cycles[month] && (cycle.baseActual !== '' || cycle.performanceActual !== '' || cycle.heatActual !== '' || cycle.extras.length > 0 || cycle.deductions.some(d => d.actual !== '' || d.base !== '' && d.rate !== '') || cycle.mode === 'full' || cycle.mode === 'partial' && dec(cycle.paidDays).gt(0) || cycle.midGift || cycle.nationalGift || cycle.heatEnabled);
      const hasWork = attendanceTotals(shifts, rules).days > 0;
      const hasPaidLeave = shifts.some(s => s.type === 'paidLeave' || s.type === 'rest' && s.useCalendar && rules.calendar.some(d => d.date === s.date && d.type === 'statutory')) && dec(result.items.find(i => i.id === 'base')?.amount ?? 0).gt(0);
      const hasReceipt = !!payslip && (payslip.actualNet !== '' || payslip.rows.length > 0);
      const hasEstimate = hasPayInput || hasWork || hasPaidLeave;
      return hasEstimate || hasReceipt ? [{ ...record, hasEstimate }] : [];
    });
    const estimated = records.filter(r => r.hasEstimate);
    const recorded = records.flatMap(({ payslip }) => payslip && payslip.actualNet !== '' ? [payslip] : []);
    const confirmed = recorded.filter(p => p.confirmed);
    const pending = recorded.filter(p => !p.confirmed);
    return {
      records,
      attendance: attendanceTotals(state.shifts, rules, { start: period(first, rules.cycleEnd).start, end: period(last, rules.cycleEnd).end }),
      gross: estimated.length ? money(sum(estimated.map(r => r.result.gross))) : null,
      net: estimated.length ? money(sum(estimated.map(r => r.result.net))) : null,
      actual: confirmed.length ? money(sum(confirmed.map(p => p.actualNet))) : null,
      pendingActual: pending.length ? money(sum(pending.map(p => p.actualNet))) : null,
      confirmedCount: confirmed.length,
    };
  };
  return { get, cumulative };
}

export type CumulativePayroll = ReturnType<ReturnType<typeof createPayrollLedger>['cumulative']>;
