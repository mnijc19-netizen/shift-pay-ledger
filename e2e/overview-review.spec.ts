import { test, expect } from '@playwright/test';
import { readLedger } from './storageHelpers';
import { createCipheriv, randomBytes } from 'node:crypto';

test('手机打开私有核对链接后直接入账并回到对应工资周期',async({page})=>{
  const device='81070f85-5be5-44f2-acd7-20ec77d2eaaf',id='b1f62ed7-a64b-4d7b-b2b7-aeb24030f06c';
  const key=randomBytes(32),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('shift-pay-review-v1/'+device+'/'+id));
  const input={kind:'shift-pay-review-v1',regularFrom:'2026-11-10',leave:[],
    payslip:{id:'link-issued',month:'2026-10',issuedNet:'900.00',actualNet:'',confirmed:false,note:'',rows:[]}};
  const data=Buffer.concat([cipher.update(JSON.stringify(input)),cipher.final(),cipher.getAuthTag()]);
  const content=Buffer.from(JSON.stringify({version:1,iv:iv.toString('base64'),data:data.toString('base64')})).toString('base64');
  await page.addInitScript(device=>localStorage.setItem('shift-pay:private-review:v1',JSON.stringify({device,token:'github_pat_test'})),device);
  await page.route('https://api.github.com/repos/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/adjustments/'+device+'/'+id+'.json')){
      await route.fulfill({json:{encoding:'base64',content}});
    }else if(url.pathname.endsWith('/shift-pay-private-ledger')){
      await route.fulfill({json:{id:1447139541,full_name:'mnijc19-netizen/shift-pay-private-ledger',private:true,visibility:'private',default_branch:'main'}});
    }else await route.abort();
  });
  await page.setViewportSize({width:375,height:812});
  await page.goto('/?test=review-link#review='+device+'.'+id+'.'+key.toString('base64url'));
  await expect(page.getByTestId('issued-net')).toHaveText('¥900.00');
  await expect(page.getByLabel('选择工资周期月份')).toHaveValue('2026-10');
  await expect.poll(()=>new URL(page.url()).hash).toBe('');
  const saved=await readLedger(page);
  expect(saved.payslips.filter(slip=>slip.month==='2026-10')).toHaveLength(1);
  expect(saved.rules.regularFrom).toBe('2026-11-10');
});

test('核对文件合并历史工资条和调休，跨转正周期保留实际考勤',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-11-16T10:00:00+08:00'));
  await page.goto('/');
  const before=await readLedger(page);
  const patch={
    kind:'shift-pay-review-v1',regularFrom:'2026-11-10',
    payslip:{id:'test-issued',month:'2026-10',issuedNet:'900.00',actualNet:'',confirmed:false,note:'',
      rows:[{id:'test-bonus',key:'performance',name:'绩效奖金',amount:'123.00',confirmed:true,note:'公司工资条'}]},
    leave:[{date:'2026-10-12',hours:'8',workedHours:'0'}],
  };
  const apply=async()=>{
    await page.getByRole('button',{name:'数据与备份',exact:true}).click();
    await page.getByLabel('选择工资核对补录文件').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(patch))});
    await expect(page.getByTestId('issued-net')).toHaveText('¥900.00');
  };
  await apply();
  await expect(page.getByTestId('period-actual')).toHaveText('待录入');
  await expect(page.getByRole('region',{name:'本期绩效'})).toContainText('¥123.00');
  await apply();
  const after=await readLedger(page);
  expect(after.shifts.filter(s=>s.date==='2026-10-12')).toMatchObject([{type:'paidLeave',paidHours:'8'}]);
  expect(after.shifts.filter(s=>s.date!=='2026-10-12')).toEqual(before.shifts.filter(s=>s.date!=='2026-10-12'));
  expect(after.payslips.filter(s=>s.month==='2026-10')).toHaveLength(1);
  await page.getByRole('region',{name:'本周期出勤和到账'}).getByRole('button',{name:'工资条核对'}).click();
  await expect(page.getByRole('heading',{name:'公司工资条明细'})).toBeVisible();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'工资总览'}).click();
  await page.getByLabel('选择工资周期月份').fill('2026-11');
  const performance=page.getByRole('region',{name:'本期绩效'});
  await expect(performance).toContainText('10-26 至 11-09');
  await expect(performance).toContainText('11-10 至 11-25');
  await expect(performance).toContainText('60%');
  await expect(performance).toContainText('100%');
  await expect(performance).toContainText('金额待工资条确认');
});

test.beforeEach(async({page})=>{await page.clock.setFixedTime(new Date('2026-11-05T10:00:00+08:00'));});
test('累计明细跳转复用本期金额，工资条确认到账独立更新',async({page})=>{
  await page.goto('/');
  const view=(name:string)=>page.getByRole('navigation',{name:'总览视图'}).getByRole('button',{name,exact:true}).click();
  await view('入职以来');
  await expect(page.getByTestId('lifetime-gross')).toHaveText('¥1,123.47');
  await expect(page.getByTestId('lifetime-net')).toHaveText('¥532.67');
  await expect(page.getByTestId('lifetime-actual')).toHaveText('待确认');
  await expect(page.locator('[data-payroll-month="2026-10"]').getByTestId('lifetime-row-net')).toHaveText('-¥182.75');
  await page.getByRole('button',{name:'查看 2026-10 工资明细',exact:true}).click();
  await expect(page.getByTestId('net')).toHaveText('-¥182.75');
  await view('本周期');
  await expect(page.getByTestId('net')).toHaveText('-¥182.75');
  await page.getByRole('region',{name:'本周期出勤和到账'}).getByRole('button',{name:'工资条核对'}).click();
  await page.getByLabel('实际银行到账金额').fill('500');
  await page.getByRole('button',{name:'保存工资条',exact:true}).first().click();
  await expect(page.getByRole('status')).toContainText('保存工资条成功');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'工资总览',exact:true}).click();
  await view('入职以来');
  await expect(page.getByTestId('lifetime-actual')).toHaveText('待确认');
  await expect(page.getByRole('region',{name:'入职以来收入'})).toContainText('待确认 ¥500.00');
  await view('本周期');
  await page.getByRole('region',{name:'本周期出勤和到账'}).getByRole('button',{name:'工资条核对'}).click();
  await page.getByLabel('实际到账已确认').check();
  await page.getByRole('button',{name:'保存工资条',exact:true}).first().click();
  await expect(page.getByRole('status')).toContainText('保存工资条成功');
  await page.reload();
  await view('入职以来');
  await expect(page.getByTestId('lifetime-actual')).toHaveText('¥500.00');
  await expect(page.getByTestId('lifetime-net')).toHaveText('¥532.67');
});

test('私有核对按保存上传密文，离线时仍保存本机，关闭后停止发送',async({page})=>{
  const copies:{device:string;data:string;key:string}[]=[];
  let offline=false;
  await page.route('https://api.github.com/repos/mnijc19-netizen/shift-pay-private-ledger**',async route=>{
    if(offline)return route.abort('internetdisconnected');
    const url=new URL(route.request().url());
    if(!url.pathname.includes('/contents/'))return route.fulfill({json:{id:1447139541,full_name:'mnijc19-netizen/shift-pay-private-ledger',private:true,visibility:'private',default_branch:'main'}});
    if(url.pathname.includes('/contents/inbox/'))return route.fulfill({status:404,json:{}});
    if(route.request().method()==='GET')return copies.length?route.fulfill({json:{sha:'existing'}}):route.fulfill({status:404,json:{}});
    const body=route.request().postDataJSON();
    copies.push(JSON.parse(Buffer.from(body.content,'base64').toString('utf8')));
    return route.fulfill({status:200,json:{content:{sha:'new'}}});
  });
  const panel=page.getByRole('region',{name:'私有核对设置'});
  const open=async()=>{await page.getByRole('button',{name:'数据与备份',exact:true}).click();await page.getByRole('button',{name:'私有核对',exact:true}).click();};
  const close=()=>page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  const record=async(day:string)=>{
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'考勤日历',exact:true}).click();
    await page.locator('[data-date="'+day+'"]').click();
    await expect(page.getByRole('status')).toContainText('保存考勤成功');
  };
  await page.goto('/');
  await record('2026-11-04');
  expect(copies).toHaveLength(0);
  await open();
  await panel.getByLabel('GitHub 细粒度令牌').fill('github_pat_SYNTHETIC_TEST');
  await panel.getByRole('button',{name:'开启自动核对'}).click();
  await expect(panel.getByText('已更新',{exact:true}).first()).toBeVisible();
  expect(copies).toHaveLength(1);
  expect(copies[0].key).toMatch(/^[A-Za-z0-9+/]+=*$/);
  expect(copies[0].data).not.toContain('2026-11-04');
  expect(JSON.stringify(copies[0])).not.toContain('SYNTHETIC_TEST');
  await close();
  offline=true;
  await record('2026-11-05');
  await open();
  await expect(panel.getByText('未同步',{exact:true}).first()).toBeVisible();
  expect((await readLedger(page)).shifts.some(s=>s.date==='2026-11-05')).toBe(true);
  expect(copies).toHaveLength(1);
  offline=false;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(panel.getByText('已更新',{exact:true}).first()).toBeVisible();
  expect(copies).toHaveLength(2);
  expect(copies[1].device).toBe(copies[0].device);
  expect(copies[1].data).not.toBe(copies[0].data);
  await panel.getByRole('button',{name:'关闭自动上传'}).click();
  await expect(panel.getByText('未开启',{exact:true})).toBeVisible();
  await close();
  await record('2026-11-06');
  await page.waitForTimeout(1000);
  expect(copies).toHaveLength(2);
});
