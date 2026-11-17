const fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.UI_TEST_OUTPUT||'ui-test-results');fs.mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg','.json':'application/json'};
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(path.resolve(root)+path.sep)||!mime[path.extname(file)]||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(file)]);res.end(fs.readFileSync(file));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const results=[];
try{for(const theme of ['dark','light'])for(const size of [{name:'desktop',width:1440,height:1040},{name:'mobile',width:390,height:844}]){
 const context=await browser.newContext({viewport:{width:size.width,height:size.height},serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const url=route.request().url();if(!url.startsWith(origin+'/'))return route.abort();if(url.includes('/config.js'))return route.fulfill({contentType:'application/javascript',body:"window.MIDEPAY_SUPABASE_CONFIG={ENV:'production',url:'https://ajbhsmcosxgymrtawlmd.supabase.co',anonKey:'sb_publishable_ui_fixture',FINANCIAL_RPCS_LIVE:false,TEST_PAYSTACK_CHECKOUT:true};"});if(url.includes('/supabaseClient.js'))return route.fulfill({contentType:'application/javascript',body:'window.MidePayDB={isConfigured:()=>false,isProduction:()=>true,isFinancialQuarantined:()=>true,client:null};'});return route.continue()});
 await page.goto(origin,{waitUntil:'load'});await page.evaluate(t=>{document.documentElement.dataset.theme=t;localStorage.setItem('midepay_theme',t)},theme);
 for(const view of ['landing','login','register','dashboard','add-money']){
  await page.evaluate(async view=>{document.querySelectorAll('.modal-overlay').forEach(el=>el.classList.add('hidden'));if(view==='dashboard'||view==='add-money'){state.user={id:'a0000000-0000-4000-8000-000000000001',fullName:'Alex Morgan',email:'alex@example.invalid',tag:'@alex',nuban:'0000000000',role:'user',hasTransactionPin:true};state.hasTransactionPin=true;state.requiresPinOnboarding=false;state.dashBalance=200;state.transactions=[{id:'ui-1',ref:'PREVIEW-001',title:'Paystack test deposit',category:'Deposit',sender:'Paystack',beneficiary:'Alex Morgan',narration:'Paystack test deposit',date:'Today, 10:30 AM',type:'inflow',amount:100,status:'Successful'},{id:'ui-2',ref:'PREVIEW-002',title:'Paystack test deposit',category:'Deposit',sender:'Paystack',beneficiary:'Alex Morgan',narration:'Paystack test deposit',date:'Yesterday, 4:15 PM',type:'inflow',amount:100,status:'Successful'}];await showView('dashboard');document.getElementById('view-dashboard').classList.remove('dashboard-pin-locked');if(view==='add-money')document.getElementById('modal-add-money').classList.remove('hidden')}else await showView(view);window.scrollTo(0,0)},view);
  if(view==='add-money'){
 await page.waitForTimeout(80);
 const dialog=page.locator('#modal-add-money');
 if(!await dialog.evaluate(el=>el.contains(document.activeElement)))throw Error('Dialog did not receive focus');
 const selectors='button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]';
 await dialog.evaluate((el,sel)=>{const list=[...el.querySelectorAll(sel)].filter(n=>n.tabIndex>=0&&n.getClientRects().length);list.at(-1).focus()},selectors);
 await page.keyboard.press('Tab');
 if(!await dialog.evaluate(el=>el.contains(document.activeElement)))throw Error('Tab escaped dialog');
 await page.keyboard.press('Shift+Tab');
 if(!await dialog.evaluate(el=>el.contains(document.activeElement)))throw Error('Reverse Tab escaped dialog');
 await page.keyboard.press('Escape');
 if(!await dialog.evaluate(el=>el.classList.contains('hidden')))throw Error('Escape did not close dialog');
 await dialog.evaluate(el=>el.classList.remove('hidden'));
 await page.waitForTimeout(40);
 }
 await page.screenshot({path:path.join(out,`${view}-${theme}-${size.name}.png`),fullPage:view!=='add-money',animations:'disabled'});
  const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,visibleDialogs:document.querySelectorAll('.modal-overlay:not(.hidden)').length}));results.push({view,theme,size:size.name,metrics,errors:[...errors]});
 }
 await context.close();
}fs.writeFileSync(path.join(out,'visual-results.json'),JSON.stringify(results,null,2));if(results.some(x=>x.metrics.scrollWidth>x.metrics.width+1||x.errors.length))process.exitCode=1;console.log(JSON.stringify({screenshots:results.length,overflow:results.filter(x=>x.metrics.scrollWidth>x.metrics.width+1).map(x=>`${x.view}-${x.theme}-${x.size}`),errors:[...new Set(results.flatMap(x=>x.errors))]}));
}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);server.close();process.exitCode=1});

