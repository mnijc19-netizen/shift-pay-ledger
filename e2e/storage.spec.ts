import { test, expect } from '@playwright/test';
import { initialState, quickShift } from '../src/domain/seed';
import { nextDate } from '../src/domain/dates';
import { readLedger, readRecord } from './storageHelpers';

const nav=(p:import('@playwright/test').Page,title:string)=>p.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:title,exact:true}).click();
function largeLegacyLedger(){
  const state=initialState();let date='2027-01-01';
  while(true){
    const before=JSON.stringify({shifts:state.shifts}),shift=quickShift(date,state.rules,'day');
    const next={...state,shifts:[...state.shifts,shift],audit:[...state.audit,{id:date,at:'2026-10-22T00:00:00Z',action:'保存考勤',note:'旧版整表保存',before,after:JSON.stringify({shifts:[...state.shifts,shift]})}]};
    if(JSON.stringify(next).length>5100000)break;
    Object.assign(state,next);date=nextDate(date);
  }
  return state;
}

test('接近旧存储上限的账本完整迁移，继续录入182班并刷新，无配额报错',async({page})=>{
  test.setTimeout(120000);
  const legacy=largeLegacyLedger(),raw=JSON.stringify(legacy);
  expect(raw.length).toBeGreaterThan(4900000);
  await page.addInitScript(raw=>{if(!sessionStorage.getItem('legacy-seeded')){localStorage.setItem('shift-pay:v1',raw);sessionStorage.setItem('legacy-seeded','1');}},raw);
  await page.goto('/');await expect(page.getByTestId('net')).toBeVisible();
  const migrated=await readLedger(page);
  expect(migrated.shifts).toEqual(legacy.shifts);expect(migrated.snapshots).toEqual(legacy.snapshots);expect(migrated.payslips).toEqual(legacy.payslips);expect(migrated.cycles).toEqual(legacy.cycles);
  expect(migrated.audit).toHaveLength(legacy.audit.length);expect(JSON.stringify(migrated).length).toBeLessThan(raw.length/10);
  expect(await readRecord(page,'legacy-localStorage-v1')).toBe(raw);expect(await page.evaluate(()=>localStorage.getItem('shift-pay:v1'))).toBeNull();
  await page.getByLabel('选择工资周期月份').fill('2028-01');await nav(page,'考勤日历');
  let added=0;
  for(const month of ['2028-01','2028-02','2028-03','2028-04','2028-05','2028-06']){
    await page.getByLabel('选择工资周期月份').fill(month);
    const dates=await page.locator('[data-date]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-date')!));
    for(const date of dates){const cell=page.locator(`[data-date="${date}"]`);await cell.click();await expect(cell).toContainText('12 小时');added++;}
  }
  expect(added).toBe(182);
  const saved=await readLedger(page);expect(saved.shifts).toHaveLength(legacy.shifts.length+added);expect(JSON.stringify(saved).length).toBeLessThan(1000000);
  expect(saved.audit.at(-1)?.format).toBe('changes-v1');expect(JSON.parse(saved.audit.at(-1)!.after).shifts).toHaveLength(1);
  await page.reload();await expect(page.getByTestId('net')).toBeVisible();expect(await readLedger(page)).toEqual(saved);expect(await readRecord(page,'legacy-localStorage-v1')).toBe(raw);
  await page.getByRole('button',{name:'数据与备份',exact:true}).click();const exported=page.waitForEvent('download');await page.getByRole('button',{name:'导出升级前原始备份',exact:true}).click();expect((await exported).suggestedFilename()).toContain('升级前原始备份');
});

test('写入超额或事务中止均不假保存，重试成功；连续点日期不会丢录入',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('net')).toBeVisible();await nav(page,'考勤日历');
  const before=await readLedger(page),cell=page.locator('[data-date="2026-10-09"]');
  for(const failure of ['quota','abort']){
    await page.evaluate(failure=>{
      const original=IDBObjectStore.prototype.put;let once=true;
      IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){
        if(args[1]==='current'&&once){once=false;if(failure==='quota')throw new DOMException('Quota limit','QuotaExceededError');const request=original.apply(this,args);request.transaction!.abort();return request;}
        return original.apply(this,args);
      };
    },failure);
    await cell.click();await expect(page.getByRole('status')).toContainText(failure==='quota'?'本次没有保存':'本次没有改动已保存记录');expect(await readLedger(page)).toEqual(before);await expect(cell).not.toContainText('12 小时');
  }
  await cell.click();await expect(cell).toContainText('12 小时');
  await page.evaluate(()=>{for(const day of ['2026-10-10','2026-10-11','2026-10-13'])document.querySelector<HTMLButtonElement>(`[data-date="${day}"]`)!.click();});
  await expect(page.locator('[data-date="2026-10-13"]')).toContainText('12 小时');
  const saved=await readLedger(page);expect(saved.shifts).toHaveLength(before.shifts.length+4);
  await page.reload();await expect(page.getByTestId('net')).toBeVisible();expect(await readLedger(page)).toEqual(saved);
});

test('迁移写入失败保留旧原文，允许导出及重试，成功后才移除旧存储',async({page})=>{
  const raw=JSON.stringify(initialState());
  await page.addInitScript(raw=>{
    if(sessionStorage.getItem('migration-attempted'))return;
    sessionStorage.setItem('migration-attempted','1');localStorage.setItem('shift-pay:v1',raw);
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(args[1]==='current')throw new DOMException('No space','QuotaExceededError');return original.apply(this,args);};
  },raw);
  await page.goto('/');await expect(page.getByText(/本地账本暂时无法打开，原记录未覆盖/)).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('shift-pay:v1'))).toBe(raw);expect(await readRecord(page)).toBeUndefined();
  const exported=page.waitForEvent('download');await page.getByRole('button',{name:'导出原始数据',exact:true}).click();expect((await exported).suggestedFilename()).toBe('班薪记-原始数据.txt');
  await page.getByRole('button',{name:'重新打开账本',exact:true}).click();await expect(page.getByTestId('net')).toBeVisible();await expect(page.getByText('存储待修复',{exact:true})).toHaveCount(0);
  expect((await readLedger(page)).shifts).toEqual(JSON.parse(raw).shifts);expect(await page.evaluate(()=>localStorage.getItem('shift-pay:v1'))).toBeNull();
});

test('损坏的旧账本不覆盖原文或创建空数据库账本',async({page})=>{
  const raw='{"shifts":[损坏的原始记录';await page.addInitScript(raw=>localStorage.setItem('shift-pay:v1',raw),raw);
  await page.goto('/');await expect(page.getByText(/原记录未覆盖/)).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('shift-pay:v1'))).toBe(raw);expect(await readRecord(page)).toBeUndefined();
});

test('工资计算链金额随实际个人扣款、个税和奖金更新，饭卡不计工资',async({page})=>{
  await page.goto('/');await page.getByLabel('选择工资周期月份').fill('2026-10');const chain=page.getByRole('region',{name:'工资计算链'});
  await expect(chain.getByTestId('chain-gross')).toHaveText('¥2,597.53');await expect(chain.getByTestId('chain-deductions')).toHaveText('¥590.80');await expect(chain.getByTestId('chain-net')).toHaveText('＝ ¥2,006.73');await expect(chain).toContainText('待录入，暂未计');await expect(chain).toContainText('单位承担部分不扣个人工资');await expect(chain).toContainText('饭卡400元');
  await page.getByRole('button',{name:'本周期参数',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByText('五险一金与实际扣款',{exact:true}).click();
  await dialog.locator('.deduction-row').filter({hasText:'养老保险'}).getByLabel('实际金额',{exact:true}).fill('400');await dialog.locator('.deduction-row').filter({hasText:'个人所得税'}).getByLabel('实际金额',{exact:true}).fill('50');await dialog.getByRole('button',{name:'保存并更新预测',exact:true}).click();
  await expect(chain.getByTestId('chain-deductions')).toHaveText('¥674.48');await expect(chain.getByTestId('chain-net')).toHaveText('＝ ¥1,923.05');await expect(chain).not.toContainText('待录入，暂未计');
  await page.getByRole('button',{name:'记录绩效 / 其他收入',exact:true}).click();await dialog.getByLabel('本期实际金额').fill('100');await dialog.getByRole('button',{name:'保存本月加项',exact:true}).click();await expect(chain.getByTestId('chain-gross')).toHaveText('¥2,697.53');await expect(chain.getByTestId('chain-net')).toHaveText('＝ ¥2,023.05');
  await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await chain.screenshot({path:'test-results/pay-chain-mobile.png'});
});
