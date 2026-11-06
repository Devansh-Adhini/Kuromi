const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(),'kuromi-hitbox-'));
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  await fs.writeFile(path.join(profile,'companion.json'),JSON.stringify({version:1,model:'llama3.2:3b',history:[],greetings:[{date,text:'Hit area check.',source:'local'}]}));
  const app = await electron.launch({args:[root],cwd:root,env:{...process.env,KUROMI_USER_DATA:profile}});
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(()=>document.body.dataset.ready==='true');
    await page.locator('#close-panel').click();
    await app.evaluate(({ipcMain})=>ipcMain.on('kuromi:interactive',(_event,value)=>{globalThis.__interactiveCheck=value;}));
    const points = await page.locator('#pet-canvas').evaluate(canvas=>{
      const r=canvas.getBoundingClientRect();
      return {blank:{x:r.left+2,y:r.top+2},face:{x:r.left+r.width*.5,y:r.top+r.height*.55}};
    });
    await page.mouse.move(points.face.x,points.face.y);
    await page.mouse.move(points.blank.x,points.blank.y);
    await page.waitForTimeout(100);
    assert.equal(await app.evaluate(()=>globalThis.__interactiveCheck),false,'Transparent area passes through to desktop');
    await page.locator('#pet-button').dispatchEvent('pointerdown',{clientX:points.blank.x,clientY:points.blank.y,button:0,pointerId:9});
    await page.locator('#pet-button').dispatchEvent('click',{clientX:points.blank.x,clientY:points.blank.y,detail:1});
    assert.equal(await page.locator('#panel').isVisible(),false,'Blank area cannot open tools even if an event reaches the button');
    await page.mouse.move(points.face.x,points.face.y);
    await page.waitForTimeout(100);
    assert.equal(await app.evaluate(()=>globalThis.__interactiveCheck),true,'Visible body accepts clicks');
    await page.mouse.click(points.face.x,points.face.y);
    assert.equal(await page.locator('#panel').isVisible(),true,'Clicking visible Kuromi opens tools');
    await page.screenshot({path:path.join(root,'test-results','palette-hitbox.png'),omitBackground:true});
    console.log('PASS: transparent padding passes clicks through and cannot open tools; visible silhouette opens tools.');
  } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
