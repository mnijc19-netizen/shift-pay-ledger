import { test, expect } from '@playwright/test';
import { readLedger, writeLedger } from './storageHelpers';
const nav=(p:import('@playwright/test').Page,title:string)=>p.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:title,exact:true}).click();
test('深浅模式切换并保留偏好',async({page})=>{
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'切换浅色模式',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByRole('button',{name:'切换深色模式',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});
test('点日期直接记 12h，提前下班只改工时，日历显示当天收入',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-10');await nav(page,'考勤日历');
  const day=page.locator('[data-date="2026-10-09"]');await day.click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(day).toContainText('12 小时');await expect(day.locator('.daily-earnings strong')).toHaveText('¥176.61');
  await page.getByRole('group',{name:'快速录入班次'}).getByRole('button',{name:/夜班/}).click();
  const night=page.locator('[data-date="2026-10-10"]');await night.click();await expect(night).toContainText('12 小时');await expect(night.locator('.daily-earnings strong')).toHaveText('¥201.61');
  await page.getByLabel('快速录入工时').fill('8');const short=page.locator('[data-date="2026-10-11"]');await short.click();await expect(short).toContainText('8 小时');await expect(short.locator('.daily-earnings strong')).toHaveText('¥226.84');await expect(page.getByLabel('快速录入工时')).toHaveValue('12');
  await day.click();const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('今天上几个小时')).toHaveValue('12');await expect(dialog.getByRole('heading',{name:'当日工资明细',exact:true})).toBeVisible();await expect(dialog).toContainText('4 小时 × 12.61494 元 × 1.5 倍');await dialog.getByLabel('今天上几个小时').fill('8');await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await expect(day.locator('.daily-earnings strong')).toHaveText('¥100.92');
  await page.reload();await nav(page,'考勤日历');await expect(page.locator('[data-date="2026-10-09"] .daily-earnings strong')).toHaveText('¥100.92');
  await expect(page.getByRole('group',{name:'快速录入班次'}).getByRole('button',{name:/夜班/})).toHaveAttribute('aria-pressed','true');
  await page.setViewportSize({width:375,height:812});await expect(page.locator('.sidebar')).not.toBeInViewport();await expect(page.locator('[data-date="2026-10-10"] .daily-earnings strong')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/calendar-dark-mobile.png',fullPage:true});
});
test('历史工资条计算与核对、实际到账独立记录',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-09');
  await expect(page.getByTestId('net')).toHaveText('¥715.42');await expect(page.locator('.ledger-table tbody tr')).toHaveCount(7);await expect(page.locator('.metric').filter({hasText:'工资条实际到账'})).toContainText('待录入');
  await nav(page,'工资条核对');await expect(page.locator('.reconcile-table tbody tr')).toHaveCount(7);await expect(page.locator('.reconcile-table tbody .badge.green')).toHaveCount(7);await expect(page.getByLabel('实际银行到账金额')).toHaveValue('');expect(errors).toEqual([]);
});
test('录入、修改、删除考勤；刷新仍保留；工资快照保持原规则',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-10');await nav(page,'考勤日历');await page.getByRole('button',{name:'详细录入',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('归属日期（上班日期）').fill('2026-10-09');await dialog.getByLabel('手动加班类型',{exact:false}).selectOption('normal');await dialog.getByLabel('备注 / 修改依据').fill('测试：人事确认普通工作日');await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.reload();await nav(page,'考勤日历');await expect(page.locator('.record-row').filter({hasText:'测试：人事确认'})).toHaveCount(1);await nav(page,'工资总览');await expect(page.getByTestId('net')).toHaveText('¥2,082.42');await page.getByRole('button',{name:'保存工资快照',exact:true}).click();
  await nav(page,'工资规则');await page.getByText('详细规则与特殊情况设置',{exact:true}).click();await page.getByLabel('月基本工资（元）',{exact:false}).fill('2300');await page.getByRole('button',{name:'保存规则并更新预测',exact:true}).click();await nav(page,'工资总览');await expect(page.getByTestId('net')).toHaveText('¥2,187.42');
  await page.getByRole('button',{name:'数据与备份',exact:true}).click();await page.getByRole('button',{name:'历史工资快照',exact:true}).click();await page.locator('.snapshot-row').filter({hasText:'2026-10'}).getByRole('button',{name:'查看',exact:true}).click();await expect(page.getByTestId('net')).toHaveText('¥2,082.42');await expect(page.getByRole('button',{name:'本周期参数'})).toBeDisabled();await page.getByRole('button',{name:'返回实时预测'}).click();
  await nav(page,'考勤日历');await page.locator('.record-row').filter({hasText:'测试：人事确认'}).click();await page.getByRole('dialog').getByRole('button',{name:'删除记录'}).click();await expect(page.locator('.record-row').filter({hasText:'测试：人事确认'})).toHaveCount(0);
});
test('草稿不计薪，确认后才纳入考勤',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-10');await nav(page,'考勤日历');await expect(page.locator('.record-row').filter({hasText:'2026-10-05'})).toContainText('草稿');await page.locator('.record-row').filter({hasText:'2026-10-05'}).click();await page.getByRole('button',{name:'详细设置与计算明细 →'}).click();await page.getByRole('dialog').getByLabel('手动加班类型',{exact:false}).selectOption('normal');await page.getByRole('dialog').getByLabel('保留为草稿（不计入工资）').uncheck();await page.getByRole('button',{name:'保存记录',exact:true}).click();await nav(page,'工资总览');await expect(page.getByTestId('net')).toHaveText('¥2,334.49');
});
test('跨午夜手动工时与分段修正可保存',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-09');await nav(page,'考勤日历');await page.getByRole('button',{name:'详细录入',exact:true}).click();const d=page.getByRole('dialog');await d.getByLabel('归属日期（上班日期）').fill('2026-09-30');await d.getByLabel('考勤类型',{exact:true}).selectOption('night');await d.getByLabel('手动加班类型',{exact:false}).selectOption('normal');await d.getByLabel('手动计薪工时',{exact:false}).fill('10');await d.getByLabel('2026-09-30 分段小时').fill('3');await d.getByLabel('2026-10-01 分段小时').fill('7');await d.getByRole('button',{name:'保存记录',exact:true}).click();await expect(d).toHaveCount(0);
});
test('周期实际扣款和预计收入分开，工资条保存后刷新保留',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-10');await page.getByRole('button',{name:'本周期参数',exact:true}).click();const d=page.getByRole('dialog');await d.getByText('五险一金与实际扣款',{exact:true}).click();await d.locator('.deduction-row').filter({hasText:'养老保险'}).getByLabel('实际金额').fill('200');await d.getByRole('button',{name:'保存并更新预测'}).click();await expect(page.getByTestId('net')).toHaveText('¥2,173.05');await nav(page,'工资条核对');await page.getByLabel('实际银行到账金额').fill('2100');await page.getByRole('button',{name:'保存工资条',exact:true}).first().click();await page.reload();await nav(page,'工资条核对');await expect(page.getByLabel('实际银行到账金额')).toHaveValue('2100');
});
test('JSON完整导出恢复与损坏数据拒绝覆盖',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'数据与备份',exact:true}).click();const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON 完整备份'}).click();const file=await downloadEvent;expect(file.suggestedFilename()).toContain('完整备份');const path=await file.path();expect(path).toBeTruthy();await page.getByLabel('选择 JSON 备份文件').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});await expect(page.getByRole('status')).toContainText('恢复失败');await page.getByLabel('选择 JSON 备份文件').setInputFiles(path!);await expect(page.getByRole('status')).toContainText('备份已恢复');await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByLabel('选择工资周期月份').fill('2026-09');await expect(page.getByTestId('net')).toHaveText('¥715.42');
});
test('375px手机四个页面和编辑弹窗无水平溢出',async({page})=>{
  await page.setViewportSize({width:375,height:812});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');const mobileNav=page.getByRole('navigation',{name:'手机导航'});
  for(const title of ['工资总览','考勤日历','工资规则','工资条核对']){await mobileNav.getByRole('button',{name:title,exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
  await mobileNav.getByRole('button',{name:'考勤日历',exact:true}).click();await page.getByRole('button',{name:'新增考勤',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.getByRole('button',{name:'关闭',exact:true}).click();await mobileNav.getByRole('button',{name:'工资总览',exact:true}).click();await page.screenshot({path:'test-results/mobile.png',fullPage:true});expect(errors).toEqual([]);
});
test('1440px桌面页面渲染与截图',async({page})=>{await page.goto('/');await expect(page.getByRole('heading',{name:'每一班，都有数。'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'test-results/desktop.png',fullPage:true});});

test('福州参考扣款内置，规则默认折叠，实际扣款逐项覆盖',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-10');
  for(const [name,amount] of [['养老保险','366.32'],['医疗保险','91.58'],['失业保险','22.90'],['住房公积金','110.00']]){await expect(page.locator('.ledger-table tbody tr').filter({hasText:name})).toContainText(amount);}
  await nav(page,'工资规则');await expect(page.getByRole('heading',{name:'福州标准，已经算在里面'})).toBeVisible();await expect(page.getByLabel('月基本工资（元）',{exact:false})).not.toBeVisible();await page.getByText('查看标准依据与计算差异',{exact:true}).click();await expect(page.locator('.policy-source-links a')).toHaveCount(14);
  await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByText('查看标准依据与计算差异',{exact:true}).click();await page.screenshot({path:'test-results/fuzhou-rules-mobile.png',fullPage:true});
});

test('旧浏览器账本自动升级一次，原有历史快照保留',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('net')).toBeVisible();
  const s=await readLedger(page);delete s.rules.fuzhouPolicy;s.rules.version=1;s.rules.baseDays='23';s.rules.system='unknown';s.audit=[];
  const oldSnapshot=s.snapshots;await writeLedger(page,s);await page.reload();await expect(page.getByTestId('net')).toBeVisible();
  expect((await readLedger(page)).rules.baseDays).toBe('21.75');expect((await readLedger(page)).snapshots).toEqual(oldSnapshot);
  expect((await readLedger(page)).audit.filter(x=>x.action==='启用福州法定标准')).toHaveLength(1);
  await page.reload();await expect(page.getByTestId('net')).toBeVisible();expect((await readLedger(page)).audit.filter(x=>x.action==='启用福州法定标准')).toHaveLength(1);
});

test('已有账本刷新后改用上班日标准，10月6日夜班全部用6日倍率',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-10');await nav(page,'考勤日历');await page.getByRole('group',{name:'快速录入班次'}).getByRole('button',{name:/夜班/}).click();await page.locator('[data-date="2026-10-10"]').click();await expect(page.locator('[data-date="2026-10-10"]')).toContainText('12 小时');
  const s=await readLedger(page);delete s.startDateBasisApplied;s.rules.split=true;s.rules.version=2;const oldSnapshot=s.snapshots;await writeLedger(page,s);
  await page.reload();await nav(page,'考勤日历');await expect(page.locator('[data-date="2026-10-10"] .daily-earnings strong')).toHaveText('¥201.61');
  await page.locator('[data-date="2026-10-06"]').click();await expect(page.locator('[data-date="2026-10-06"] .daily-earnings strong')).toHaveText('¥327.76');await page.locator('[data-date="2026-10-06"]').click();const d=page.getByRole('dialog');await expect(d).toContainText('整班按 2026-10-06 的工资标准');await expect(d.locator('.daily-pay-line').filter({hasText:'休息日加班费'})).toContainText('¥302.76');await expect(d.locator('.daily-pay-line').filter({hasText:'夜班餐补'})).toContainText('¥25.00');await d.getByRole('button',{name:'关闭',exact:true}).click();
  expect((await readLedger(page)).snapshots).toEqual(oldSnapshot);await page.reload();await expect(page.getByTestId('net')).toBeVisible();
  expect((await readLedger(page)).audit.filter(x=>x.action==='整班按上班日计薪')).toHaveLength(1);
});

test('日明细列公式，月工资条分收入扣款和饭卡，绩效修改不重复相加',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-10');await nav(page,'考勤日历');await page.getByRole('group',{name:'快速录入班次'}).getByRole('button',{name:/夜班/}).click();await page.locator('[data-date="2026-10-09"]').click();await page.locator('[data-date="2026-10-09"]').click();const d=page.getByRole('dialog');await expect(d.getByRole('heading',{name:'当日工资明细'})).toBeVisible();await expect(d.locator('.daily-pay-line').filter({hasText:'正常工时工资'})).toContainText('8 小时 × 12.61494');await expect(d.locator('.daily-pay-line').filter({hasText:'平日加班费'})).toContainText('4 小时 × 12.61494 元 × 1.5 倍');await expect(d.locator('.daily-pay-total')).toContainText('¥201.61');await d.getByRole('button',{name:'关闭',exact:true}).click();
  await nav(page,'工资总览');const income=page.getByTestId('monthly-income');await expect(income.locator('[data-pay-item="meal-month"]')).toHaveCount(0);const night=income.locator('tbody tr').filter({hasText:'夜班餐补'});await expect(night).toHaveCount(1);await expect(night).toContainText('¥50.00');await expect(page.getByRole('region',{name:'饭卡和非现金福利'})).toContainText('¥400.00');await expect(page.getByTestId('net')).toHaveText('¥2,107.42');
  const add=async(amount:string)=>{await page.getByRole('button',{name:'记录绩效 / 其他收入'}).click();await page.getByRole('dialog').getByLabel('本期实际金额',{exact:false}).fill(amount);await page.getByRole('button',{name:'保存本月加项'}).click();};
  await add('600');await expect(page.getByTestId('net')).toHaveText('¥2,707.42');await add('350');await expect(page.getByTestId('net')).toHaveText('¥2,457.42');await expect(income.locator('tbody tr').filter({hasText:'绩效奖金'})).toHaveCount(1);
  await page.getByRole('button',{name:'记录绩效 / 其他收入'}).click();const extra=page.getByRole('dialog');await extra.getByLabel('收入类型').selectOption('extra');await extra.getByLabel('项目名称').fill('生日礼金');await extra.getByLabel('本期实际金额',{exact:false}).fill('120');await page.getByRole('button',{name:'保存本月加项'}).click();await expect(page.getByTestId('net')).toHaveText('¥2,577.42');await page.reload();await expect(page.getByTestId('net')).toHaveText('¥2,577.42');
  await page.setViewportSize({width:375,height:812});await expect(page.locator('.sidebar')).not.toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/monthly-pay-and-meal-card-mobile.png',fullPage:true});
});
