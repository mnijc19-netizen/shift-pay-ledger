import { test, expect } from '@playwright/test';
import { readLedger, writeLedger } from './storageHelpers';
import { newCycle } from '../src/domain/seed';

test.beforeEach(async({page})=>{await page.clock.setFixedTime(new Date('2026-11-02T12:00:00+08:00'));});
const view=(page:import('@playwright/test').Page,name:string)=>page.getByRole('navigation',{name:'总览视图'}).getByRole('button',{name,exact:true}).click();
const nav=(page:import('@playwright/test').Page,title:string)=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:title,exact:true}).click();

test('空白周期从0起，录入、缩短、删除班次后累计收入立即变化并保留',async({page})=>{
  await page.goto('/');await expect(page.getByLabel('选择工资周期月份')).toHaveValue('2026-11');
  await expect(page.getByTestId('earned')).toHaveText('¥0.00');await expect(page.getByText('已录考勤累计应发',{exact:true})).toBeVisible();
  await nav(page,'考勤日历');await page.locator('[data-date="2026-11-02"]').click();await expect(page.locator('[data-date="2026-11-02"]')).toContainText('12 小时');
  await nav(page,'工资总览');await expect(page.getByTestId('earned')).toHaveText('¥181.21');await view(page,'工资明细');await expect(page.getByTestId('monthly-income').locator('[data-pay-item="base"]')).toContainText('¥100.92');
  await nav(page,'考勤日历');await page.getByRole('group',{name:'快速录入班次'}).getByRole('button',{name:/夜班/}).click();await page.locator('[data-date="2026-11-03"]').click();await expect(page.locator('[data-date="2026-11-03"]')).toContainText('12 小时');
  await nav(page,'工资总览');await expect(page.getByTestId('earned')).toHaveText('¥387.42');await view(page,'工资明细');await page.getByText('查看工资计算过程',{exact:true}).click();await expect(page.getByRole('region',{name:'工资计算链'})).toContainText('16 小时');
  await page.reload();await expect(page.getByTestId('earned')).toHaveText('¥387.42');
  await nav(page,'考勤日历');await page.locator('[data-date="2026-11-03"]').click();await page.getByRole('dialog').getByLabel('今天上几个小时').fill('8');await page.getByRole('dialog').getByRole('button',{name:'保存记录',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page,'工资总览');await expect(page.getByTestId('earned')).toHaveText('¥286.73');
  await nav(page,'考勤日历');await page.locator('[data-date="2026-11-02"]').click();await page.getByRole('dialog').getByRole('button',{name:'删除记录',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page,'工资总览');await expect(page.getByTestId('earned')).toHaveText('¥105.52');
  await page.getByLabel('选择工资周期月份').fill('2026-12');await expect(page.getByTestId('earned')).toHaveText('¥0.00');
  await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('旧默认整月模式自动修正一次，实际金额和历史快照保留，手选整月预测不被重置',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('earned')).toBeVisible();const old=await readLedger(page);old.attendanceBasisApplied=false;
  old.cycles['2026-10']={...newCycle('2026-10',old.rules),mode:'full'};old.cycles['2026-11']={...newCycle('2026-11',old.rules),mode:'full',baseActual:'800'};
  await writeLedger(page,old);await page.reload();await page.getByLabel('选择工资周期月份').fill('2026-10');await expect(page.getByTestId('earned')).toHaveText('¥408.05');
  const migrated=await readLedger(page);expect(migrated.snapshots).toEqual(old.snapshots);expect(migrated.payslips).toEqual(old.payslips);expect(migrated.shifts).toEqual(old.shifts);expect(migrated.cycles['2026-11'].baseActual).toBe('800');
  expect(migrated.audit.filter(a=>a.action==='基本工资改为按已录考勤累计')).toHaveLength(1);
  await page.getByRole('button',{name:'本周期参数',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('基本工资计算方式')).toHaveValue('attendance');await dialog.getByLabel('基本工资计算方式').selectOption('full');await dialog.getByRole('button',{name:'保存并更新预测',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByTestId('net')).toHaveText('¥2,006.73');
  await page.reload();await page.getByLabel('选择工资周期月份').fill('2026-10');await expect(page.getByTestId('net')).toHaveText('¥2,006.73');expect((await readLedger(page)).audit.filter(a=>a.action==='基本工资改为按已录考勤累计')).toHaveLength(1);
});

test('法定休假在日历列明带薪工资，结束周期可明确按整月结算，当前周期仍从0累计',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('earned')).toHaveText('¥0.00');await expect(page.getByRole('region',{name:'完整周期结算提示'})).toHaveCount(0);
  await page.getByLabel('选择工资周期月份').fill('2026-10');await nav(page,'考勤日历');await page.getByRole('group',{name:'快速录入班次'}).getByRole('button',{name:/休息/}).click();
  for(const date of ['2026-10-01','2026-10-02','2026-10-03']){const cell=page.locator(`[data-date="${date}"]`);await cell.click();await expect(cell.locator('.daily-earnings strong')).toHaveText('¥100.92');}
  await page.locator('[data-date="2026-10-01"]').click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('法定带薪假工资');await expect(dialog).toContainText('带薪假，不是加班');await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await nav(page,'工资总览');await view(page,'工资明细');await expect(page.getByTestId('monthly-income').locator('[data-pay-item="base"]')).toContainText('¥403.68');await view(page,'本周期');const snapshots=(await readLedger(page)).snapshots;
  await page.getByRole('button',{name:'按整月结算本期',exact:true}).click();await view(page,'工资明细');await expect(page.getByTestId('monthly-income').locator('[data-pay-item="base"]')).toContainText('¥2,195.00');await view(page,'本周期');await expect(page.getByRole('region',{name:'完整周期结算提示'})).toHaveCount(0);expect((await readLedger(page)).snapshots).toEqual(snapshots);
  await page.reload();await page.getByLabel('选择工资周期月份').fill('2026-10');await view(page,'工资明细');await expect(page.getByTestId('monthly-income').locator('[data-pay-item="base"]')).toContainText('¥2,195.00');await view(page,'本周期');
  await page.getByLabel('选择工资周期月份').fill('2026-11');await expect(page.getByTestId('earned')).toHaveText('¥0.00');
});

test('本周期和全部累计显示天数工时，增改删除刷新及历史快照保持各自统计范围',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('period-workdays')).toHaveText('0');await expect(page.getByTestId('period-workhours')).toHaveText('0');await view(page,'入职以来');await expect(page.getByTestId('total-workdays')).toHaveText('3');await expect(page.getByTestId('total-workhours')).toHaveText('31.5');await view(page,'本周期');
  await nav(page,'考勤日历');await page.locator('[data-date="2026-11-02"]').click();await expect(page.locator('[data-date="2026-11-02"]')).toContainText('12 小时');await page.getByRole('group',{name:'快速录入班次'}).getByRole('button',{name:/夜班/}).click();await page.getByLabel('快速录入工时').fill('1.5');await page.locator('[data-date="2026-11-03"]').click();await expect(page.locator('[data-date="2026-11-03"]')).toContainText('1.5 小时');
  await nav(page,'工资总览');await expect(page.getByTestId('period-workdays')).toHaveText('2');await expect(page.getByTestId('period-workhours')).toHaveText('13.5');await view(page,'入职以来');await expect(page.getByTestId('total-workdays')).toHaveText('5');await expect(page.getByTestId('total-workhours')).toHaveText('45');await view(page,'本周期');
  await nav(page,'考勤日历');await page.locator('[data-date="2026-11-03"]').click();await page.getByRole('dialog').getByLabel('今天上几个小时').fill('8');await page.getByRole('dialog').getByRole('button',{name:'保存记录',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await nav(page,'工资总览');await expect(page.getByTestId('period-workhours')).toHaveText('20');await view(page,'入职以来');await expect(page.getByTestId('total-workhours')).toHaveText('51.5');await view(page,'本周期');
  await page.getByRole('button',{name:'保存工资快照',exact:true}).click();await expect(page.getByRole('status')).toContainText('保存工资快照成功');
  await page.getByLabel('选择工资周期月份').fill('2026-10');await expect(page.getByTestId('period-workdays')).toHaveText('2');await expect(page.getByTestId('period-workhours')).toHaveText('20');await view(page,'入职以来');await expect(page.getByTestId('total-workdays')).toHaveText('5');await expect(page.getByTestId('total-workhours')).toHaveText('51.5');await view(page,'本周期');
  await page.getByLabel('选择工资周期月份').fill('2026-11');await nav(page,'考勤日历');await page.locator('[data-date="2026-11-02"]').click();await page.getByRole('dialog').getByRole('button',{name:'删除记录',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await nav(page,'工资总览');await expect(page.getByTestId('period-workdays')).toHaveText('1');await expect(page.getByTestId('period-workhours')).toHaveText('8');await view(page,'入职以来');await expect(page.getByTestId('total-workdays')).toHaveText('4');await expect(page.getByTestId('total-workhours')).toHaveText('39.5');await view(page,'本周期');
  await page.getByRole('button',{name:'数据与备份',exact:true}).click();await page.getByRole('button',{name:'历史工资快照',exact:true}).click();await page.locator('.snapshot-row').filter({hasText:'2026-11'}).getByRole('button',{name:'查看',exact:true}).click();await expect(page.getByTestId('period-workdays')).toHaveText('2');await expect(page.getByTestId('period-workhours')).toHaveText('20');await view(page,'入职以来');await expect(page.getByTestId('total-workdays')).toHaveText('4');await expect(page.getByTestId('total-workhours')).toHaveText('39.5');await view(page,'本周期');
  await page.reload();await expect(page.getByTestId('period-workdays')).toHaveText('1');await view(page,'入职以来');await expect(page.getByTestId('total-workhours')).toHaveText('39.5');await view(page,'本周期');await page.setViewportSize({width:375,height:812});await expect(page.locator('.sidebar')).not.toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('region',{name:'本周期出勤和到账',exact:true}).screenshot({path:'test-results/attendance-totals-mobile.png',style:'.mobile-bottom-nav,.toast{visibility:hidden!important}'});
});
