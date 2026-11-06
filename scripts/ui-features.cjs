const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(),'kuromi-dark-ui-'));
  const now = new Date(), createdAt=now.toISOString();
  await fs.writeFile(path.join(profile,'journal.json'),JSON.stringify({version:1,
    todos:[{id:'portfolio',text:'Finish the portfolio homepage',done:false,createdAt}],thoughts:[],
    settings:{alwaysOnTop:true,roaming:false,reducedMotion:false,scale:1},position:null}));
  await fs.writeFile(path.join(profile,'companion.json'),JSON.stringify({version:1,model:'llama3.2:3b',greetings:[],
    history:[{id:'u',role:'user',text:'A previous conversation',createdAt},{id:'a',role:'assistant',text:'A previous reply',createdAt}]}));
  const app=await electron.launch({args:[root],cwd:root,env:{...process.env,KUROMI_USER_DATA:profile}});
  try {
    const page=await app.firstWindow();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>document.body.dataset.companionReady==='true');
    await page.waitForFunction(()=>document.querySelector('#greeting-text').textContent.includes('Finish the portfolio homepage'));
    assert.equal(await page.locator('#chat-hint,.pet-caption,.panel-footer').count(),0);
    assert.equal(await page.getByText('YOUR LITTLE COMPANION',{exact:true}).count(),0);
    assert.equal(await page.locator('#panel').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(25, 22, 31)');
    await page.locator('#new-chat').click();
    await page.waitForFunction(()=>document.querySelector('#chat-messages').childElementCount===0 && !document.querySelector('#new-chat').disabled);
    const metadata=await page.evaluate(()=>window.kuromi.getCompanion());
    assert.deepEqual(metadata.history,[]);
    assert.equal((await fs.readdir(path.join(profile,'conversations'))).length,1);
    await page.screenshot({path:path.join(root,'test-results','dark-chat.png'),omitBackground:true});
    await page.locator('[data-tab="diary"]').click();
    assert.equal((await page.locator('[data-view="diary"] h2').innerText()).replace(/\s/g,''),'KuromiNote♡');
    await page.screenshot({path:path.join(root,'test-results','dark-note.png'),omitBackground:true});
    await page.locator('[data-tab="tasks"]').click();
    const rowColors=await page.locator('.todo-entry').first().evaluate(node=>({background:getComputedStyle(node).backgroundColor,text:getComputedStyle(node.querySelector('.todo-text')).color}));
    assert.equal(rowColors.background,'rgb(37, 28, 47)');
    assert.equal(rowColors.text,'rgb(230, 217, 239)');
    await page.screenshot({path:path.join(root,'test-results','dark-tasks.png'),omitBackground:true});
    const nav=await page.locator('.tabs').evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));
    assert.ok(nav.scroll<=nav.width,'Longer Kuromi Note label fits the nav');
    await app.evaluate(({BrowserWindow})=> {
      const window=BrowserWindow.getAllWindows()[0];
      window.focus();
      // Test the native event bridge even when Windows foreground-lock policy
      // prevents an automated test process from taking keyboard focus.
      window.emit('blur');
    });
    await page.waitForFunction(()=>document.querySelector('#panel').hidden);
    await page.locator('#pet-button').click();
    await page.waitForFunction(()=>!document.querySelector('#panel').hidden);
    assert.deepEqual(errors,[]);
    console.log('PASS: dark theme, removed UI, Kuromi Note, new archived chat, task greeting, native blur event bridge and reopening.');
  } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
