import { test, expect } from '@playwright/test';
import { readLedger, writeLedger } from './storageHelpers';
import { newCycle } from '../src/domain/seed';

test.beforeEach(async({page})=>{await page.clock.setFixedTime(new Date('2026-11-02T12:00:00+08:00'));});
const nav=(page:import('@playwright/test').Page,title:string)=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:title,exact:true}).click();

test('空白周期从0起，录入、缩短、删除班次后累计收入立即变化并保留',async({page})=>{
  await page.goto('/');await expect(page.getByLabel('选择工资周期月份')).toHaveValue('2026-11');
  await expect(page.getByTestId('earned')).toHaveText('¥0.00');await expect(page.getByText('已录考勤累计应发',{exact:true})).toBeVisible();
  await nav(page,'考勤日历');await page.locator('[data-date="2026-11-02"]').click();await expect(page.locator('[data-date="2026-11-02"]')).toContainText('12 小时');
  await nav(page,'工资总览');await expect(page.getByTestId('earned')).toHaveText('¥181.21');await expect(page.getByTestId('monthly-income').locator('[data-pay-item="base"]')).toContainText('¥100.92');
  await nav(page,'考勤日历');await page.getByRole('group',{name:'快速录入班次'}).getByRole('button',{name:/夜班/}).click();await page.locator('[data-date="2026-11-03"]').click();await expect(page.locator('[data-date="2026-11-03"]')).toContainText('12 小时');
  await nav(page,'工资总览');await expect(page.getByTestId('earned')).toHaveText('¥387.42');await expect(page.getByRole('region',{name:'工资计算链'})).toContainText('16 小时');
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
