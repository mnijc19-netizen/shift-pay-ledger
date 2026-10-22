import { test, expect } from '@playwright/test';
const nav=(p:import('@playwright/test').Page,title:string)=>p.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:title,exact:true}).click();
test('深浅模式切换并保留偏好',async({page})=>{
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'切换浅色模式',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByRole('button',{name:'切换深色模式',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});
test('点日期直接记 12h，提前下班只改工时，日历显示当天收入',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-10');await nav(page,'考勤日历');
  const day=page.locator('[data-date="2026-10-09"]');await day.click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(day).toContainText('12 小时');await expect(day.locator('.daily-earnings strong')).toHaveText('¥171.12');
  await page.getByRole('group',{name:'快速录入班次'}).getByRole('button',{name:/夜班/}).click();
  const night=page.locator('[data-date="2026-10-10"]');await night.click();await expect(night).toContainText('12 小时');await expect(night.locator('.daily-earnings strong')).toHaveText('¥196.12');
  await page.getByLabel('快速录入工时').fill('8');const short=page.locator('[data-date="2026-10-11"]');await short.click();await expect(short).toContainText('8 小时');await expect(short.locator('.daily-earnings strong')).toHaveText('¥120.43');await expect(page.getByLabel('快速录入工时')).toHaveValue('12');
  await day.click();const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('今天上几个小时')).toHaveValue('12');await dialog.getByLabel('今天上几个小时').fill('8');await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await expect(day.locator('.daily-earnings strong')).toHaveText('¥95.43');
  await page.reload();await nav(page,'考勤日历');await expect(page.locator('[data-date="2026-10-09"] .daily-earnings strong')).toHaveText('¥95.43');
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
  await page.reload();await nav(page,'考勤日历');await expect(page.locator('.record-row').filter({hasText:'测试：人事确认'})).toHaveCount(1);await nav(page,'工资总览');await expect(page.getByTestId('net')).toHaveText('¥2,395.69');await page.getByRole('button',{name:'保存工资快照',exact:true}).click();
  await nav(page,'工资规则');await page.getByLabel('月基本工资（元）',{exact:false}).fill('2300');await page.getByRole('button',{name:'保存规则并更新预测',exact:true}).click();await nav(page,'工资总览');await expect(page.getByTestId('net')).toHaveText('¥2,500.69');
  await page.getByRole('button',{name:'数据与备份',exact:true}).click();await page.getByRole('button',{name:'历史工资快照',exact:true}).click();await page.locator('.snapshot-row').filter({hasText:'2026-10'}).getByRole('button',{name:'查看',exact:true}).click();await expect(page.getByTestId('net')).toHaveText('¥2,395.69');await expect(page.getByRole('button',{name:'本周期参数'})).toBeDisabled();await page.getByRole('button',{name:'返回实时预测'}).click();
  await nav(page,'考勤日历');await page.locator('.record-row').filter({hasText:'测试：人事确认'}).click();await page.getByRole('dialog').getByRole('button',{name:'删除记录'}).click();await expect(page.locator('.record-row').filter({hasText:'测试：人事确认'})).toHaveCount(0);
});
test('草稿不计薪，确认后才纳入考勤',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-10');await nav(page,'考勤日历');await expect(page.locator('.record-row').filter({hasText:'2026-10-05'})).toContainText('草稿');await page.locator('.record-row').filter({hasText:'2026-10-05'}).click();await page.getByRole('button',{name:'详细设置与计算明细 →'}).click();await page.getByRole('dialog').getByLabel('手动加班类型',{exact:false}).selectOption('normal');await page.getByRole('dialog').getByLabel('保留为草稿（不计入工资）').uncheck();await page.getByRole('button',{name:'保存记录',exact:true}).click();await nav(page,'工资总览');await expect(page.getByTestId('net')).toHaveText('¥2,420.69');
});
test('跨午夜手动工时与分段修正可保存',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-09');await nav(page,'考勤日历');await page.getByRole('button',{name:'详细录入',exact:true}).click();const d=page.getByRole('dialog');await d.getByLabel('归属日期（上班日期）').fill('2026-09-30');await d.getByLabel('考勤类型',{exact:true}).selectOption('night');await d.getByLabel('手动加班类型',{exact:false}).selectOption('normal');await d.getByLabel('手动计薪工时',{exact:false}).fill('10');await d.getByLabel('2026-09-30 分段小时').fill('3');await d.getByLabel('2026-10-01 分段小时').fill('7');await d.getByRole('button',{name:'保存记录',exact:true}).click();await expect(d).toHaveCount(0);
});
test('周期实际扣款和预计收入分开，工资条保存后刷新保留',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-10');await page.getByRole('button',{name:'本周期参数',exact:true}).click();const d=page.getByRole('dialog');await d.locator('.deduction-row').filter({hasText:'养老保险'}).getByLabel('实际金额').fill('200');await d.getByRole('button',{name:'保存并更新预测'}).click();await expect(page.getByTestId('net')).toHaveText('¥2,120.00');await nav(page,'工资条核对');await page.getByLabel('实际银行到账金额').fill('2100');await page.getByRole('button',{name:'保存工资条',exact:true}).first().click();await page.reload();await nav(page,'工资条核对');await expect(page.getByLabel('实际银行到账金额')).toHaveValue('2100');
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
