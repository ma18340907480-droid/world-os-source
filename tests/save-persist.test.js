/**
 * World OS 存档持久化 + 市场批量出售 回归测试
 * 运行: node test/save-persist.test.js
 * 要求: 工作区 dist 已构建 (npm run build)
 */
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const URL = 'file:///home/hatch/workspace/goals/world-os/alpha/dist/index.html';
let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? ' | ' + detail : '')); }
};

async function setup(page, inv, coins, buildings) {
  await page.evaluate(async (inv, coins, buildings) => {
    const w = window.__worldos; const s = w.save();
    s.coins = coins; s.inventory = inv; s.buildings = buildings || [];
    s.quests = { q1: 'done', q2: 'done', q3: 'done' };
    w.addCoins(0); await w.flushSave();
  }, inv, coins, buildings);
}

async function enter(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('继续上次'));
    if (b) b.click();
  });
  await sleep(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('进入我的世界'));
    if (b) b.click();
  });
  await sleep(4000);
}

async function openShopBuy(page) {
  return page.evaluate(async () => {
    const w = window.__worldos;
    [...document.querySelectorAll('button')].find(b => b.textContent === '🛒').click();
    await new Promise(r => setTimeout(r, 600));
    const buyBtn = [...document.querySelectorAll('.panel button')].find(b => b.textContent === '购买');
    if (!buyBtn) return { err: 'no buy btn' };
    const before = { coins: w.save().coins, wood: w.save().inventory.wood ?? 0 };
    buyBtn.click();
    await new Promise(r => setTimeout(r, 800)); // 等待异步保存完成
    const after = { coins: w.save().coins, wood: w.save().inventory.wood ?? 0 };
    const c = document.querySelector('.panel .close'); if (c) c.click();
    return { before, after };
  });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/opt/meta-chromium/chrome',
    headless: 'new',
    args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader',
           '--user-data-dir=/tmp/pptr-save-test','--window-size=390,844',
           '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0,100)));

  console.log('--- P0: 存档持久化 ---');
  
  // 1. 购买后立即刷新
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(3000);
  await setup(page, { wood: 0 }, 1000); await enter(page);
  const r1 = await openShopBuy(page);
  check('购买扣币 (1000→990)', r1.after.coins === 990, JSON.stringify(r1.after));
  check('购买加库存 (0→1)', r1.after.wood === 1);
  await enter(page); // 刷新
  const r1b = await page.evaluate(() => ({
    c: window.__worldos.save().coins, w: window.__worldos.save().inventory.wood ?? 0
  }));
  check('刷新后金币持久化', r1b.c === 990, 'c=' + r1b.c);
  check('刷新后库存持久化', r1b.w === 1, 'w=' + r1b.w);

  // 2. 连续购买 3 次
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(3000);
  await setup(page, { wood: 0 }, 1000); await enter(page);
  for (let i = 0; i < 3; i++) await openShopBuy(page);
  await page.evaluate(async () => { await window.__worldos.flushSave(); });
  const r2 = await page.evaluate(() => ({
    c: window.__worldos.save().coins, w: window.__worldos.save().inventory.wood ?? 0
  }));
  check('连续3次金币正确 (970)', r2.c === 970, 'c=' + r2.c);
  check('连续3次库存正确 (3)', r2.w === 3, 'w=' + r2.w);

  // 3. 余额不足
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(3000);
  await setup(page, { wood: 0 }, 5); await enter(page);
  const r3 = await openShopBuy(page);
  check('余额不足不扣币', r3.after.coins === 5, JSON.stringify(r3.after));
  check('余额不足不加库存', r3.after.wood === 0);

  // 4. 容量不足
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(3000);
  await setup(page, { wood: 20 }, 1000); await enter(page); // 默认容量20，已满
  const r4 = await openShopBuy(page);
  check('容量不足不扣币', r4.after.coins === 1000);
  check('容量不足不加库存', r4.after.wood === 20);

  console.log('--- P1: 市场批量出售 ---');
  
  // 5. 批量出售 UI 存在
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(3000);
  await setup(page, { wood: 50 }, 1000); await enter(page);
  const ui = await page.evaluate(async () => {
    // 打开市场面板 (通过加工/市场按钮)
    const btns = [...document.querySelectorAll('button')];
    const indBtn = btns.find(b => b.textContent.includes('🏭') || b.textContent.includes('加工'));
    if (indBtn) indBtn.click();
    await new Promise(r => setTimeout(r, 800));
    // 切换到市场标签
    const tabs = [...document.querySelectorAll('.panel button')];
    const mktTab = tabs.find(b => b.textContent.includes('市场'));
    if (mktTab) mktTab.click();
    await new Promise(r => setTimeout(r, 800));
    const input = document.querySelector('.panel input[type="number"]');
    const q10 = [...document.querySelectorAll('.panel button')].find(b => b.textContent === '10');
    const qAll = [...document.querySelectorAll('.panel button')].find(b => b.textContent === '全部');
    return { hasInput: !!input, has10: !!q10, hasAll: !!qAll };
  });
  check('数量输入框存在', ui.hasInput, JSON.stringify(ui));
  check('快捷按钮 10/全部存在', ui.has10 && ui.hasAll);

  // 6. 真实出售 1 件：验证金币+库存变化
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(3000);
  await setup(page, { wood: 50 }, 1000); await enter(page);
  const sell1 = await page.evaluate(async () => {
    const w = window.__worldos;
    const before = { coins: w.save().coins, wood: w.save().inventory.wood };
    // 直接调用 market.sell (复用真实逻辑)
    const tx = w.econ.sell('wood', 1);
    await w.flushSave();
    const after = { coins: w.save().coins, wood: w.save().inventory.wood };
    return { before, after, txTotal: tx ? tx.total : null };
  });
  const sellPrice = sell1.txTotal; // 单价
  check('出售1件库存-1', sell1.after.wood === 49, `wood ${sell1.before.wood}→${sell1.after.wood}`);
  check('出售1件金币增加', sell1.after.coins === 1000 + sellPrice, `coins ${sell1.before.coins}→${sell1.after.coins}`);

  // 7. 真实出售 10 件
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(3000);
  await setup(page, { wood: 50 }, 1000); await enter(page);
  const sell10 = await page.evaluate(async () => {
    const w = window.__worldos;
    const before = { coins: w.save().coins, wood: w.save().inventory.wood };
    const tx = w.econ.sell('wood', 10);
    await w.flushSave();
    const after = { coins: w.save().coins, wood: w.save().inventory.wood };
    return { before, after, txTotal: tx ? tx.total : null, txN: tx ? tx.n : 0 };
  });
  check('出售10件库存-10', sell10.after.wood === 40, `wood=${sell10.after.wood}`);
  check('出售10件金币正确', sell10.after.coins === 1000 + sell10.txTotal && sell10.txN === 10);

  // 8. 非法数量被拒绝（扩展：NaN/Infinity/小数/超库存）
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(3000);
  await setup(page, { wood: 50 }, 1000); await enter(page);
  const invalid = await page.evaluate(async () => {
    const w = window.__worldos;
    const results = {};
    for (const n of [0, -5, 1.5, NaN, Infinity, -Infinity, 999]) {
      // 每次重置状态，避免污染
      w.save().inventory.wood = 50;
      w.save().coins = 1000;
      const before = { coins: w.save().coins, wood: w.save().inventory.wood };
      const tx = w.econ.sell('wood', n);
      const after = { coins: w.save().coins, wood: w.save().inventory.wood };
      results[String(n)] = {
        rejected: tx === null,
        unchanged: before.coins === after.coins && before.wood === after.wood
      };
    }
    return results;
  });
  check('数量0被拒绝', invalid['0'].rejected && invalid['0'].unchanged);
  check('负数被拒绝', invalid['-5'].rejected && invalid['-5'].unchanged);
  check('小数被拒绝', invalid['1.5'].rejected && invalid['1.5'].unchanged);
  check('NaN被拒绝', invalid['NaN'].rejected && invalid['NaN'].unchanged);
  check('Infinity被拒绝', invalid['Infinity'].rejected && invalid['Infinity'].unchanged);
  check('-Infinity被拒绝', invalid['-Infinity'].rejected && invalid['-Infinity'].unchanged);
  check('超库存被拒绝', invalid['999'].rejected && invalid['999'].unchanged);

  // 9. 出售后刷新，数据持久化
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(3000);
  await setup(page, { wood: 50 }, 1000); await enter(page);
  await page.evaluate(async () => {
    const w = window.__worldos;
    w.econ.sell('wood', 5);
    await w.flushSave();
  });
  await enter(page); // 刷新
  const persist = await page.evaluate(() => ({
    c: window.__worldos.save().coins, w: window.__worldos.save().inventory.wood
  }));
  check('出售后刷新库存持久化', persist.w === 45, `w=${persist.w}`);

  // 10. 模拟保存失败：出售回滚（通过 doSell UI 路径）
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(3000);
  await setup(page, { wood: 50 }, 1000); await enter(page);
  const rollbackSell = await page.evaluate(async () => {
    const w = window.__worldos;
    // 打开市场面板，找到木材行的出售按钮
    const btns = [...document.querySelectorAll('button')];
    const indBtn = btns.find(b => b.textContent.includes('🏭') || b.textContent.includes('加工'));
    if (indBtn) indBtn.click();
    await new Promise(r => setTimeout(r, 800));
    const tabs = [...document.querySelectorAll('.panel button')];
    const mktTab = tabs.find(b => b.textContent.includes('市场'));
    if (mktTab) mktTab.click();
    await new Promise(r => setTimeout(r, 800));
    
    const before = { coins: w.save().coins, wood: w.save().inventory.wood };
    // 模拟下一次保存失败
    w.simulateSaveFailure();
    // 点击出售（通过输入框设置数量1，点击出售按钮）
    const sellBtns = [...document.querySelectorAll('.panel button')].filter(b => b.textContent === '出售');
    if (sellBtns.length > 0) {
      sellBtns[0].click();
      await new Promise(r => setTimeout(r, 1500)); // 等待异步完成
    }
    const after = { coins: w.save().coins, wood: w.save().inventory.wood };
    return { before, after, rolledBack: before.coins === after.coins && before.wood === after.wood };
  });
  check('保存失败时出售回滚', rollbackSell.rolledBack, JSON.stringify(rollbackSell.after));

  // 11. 模拟保存失败：商店购买回滚
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(3000);
  await setup(page, { wood: 0 }, 1000); await enter(page);
  const rollbackBuy = await page.evaluate(async () => {
    const w = window.__worldos;
    [...document.querySelectorAll('button')].find(b => b.textContent === '🛒').click();
    await new Promise(r => setTimeout(r, 600));
    const before = { coins: w.save().coins, wood: w.save().inventory.wood ?? 0 };
    w.simulateSaveFailure();
    const buyBtn = [...document.querySelectorAll('.panel button')].find(b => b.textContent === '购买');
    if (buyBtn) {
      buyBtn.click();
      await new Promise(r => setTimeout(r, 1500));
    }
    const after = { coins: w.save().coins, wood: w.save().inventory.wood ?? 0 };
    return { before, after, rolledBack: before.coins === after.coins && before.wood === after.wood };
  });
  check('保存失败时购买回滚', rollbackBuy.rolledBack, JSON.stringify(rollbackBuy.after));

  console.log('');
  console.log('pageerrors:', errs.join(' | ') || 'none');
  console.log(`=== ${pass}通过, ${fail}失败 ===`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('测试崩溃:', e.message.slice(0,200)); process.exit(2); });
