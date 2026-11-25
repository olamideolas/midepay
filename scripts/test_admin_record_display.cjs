const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const start=source.indexOf('  function renderAdminUsersTable('),end=source.indexOf('\n  function renderAdminTxTable(',start);assert.ok(start>=0&&end>start);
function render(user){const tbody={};const context={adminUsersList:[user],document:{getElementById:()=>tbody},escapeHtml:v=>String(v??'').replaceAll('<','&lt;'),formatNaira:v=>'NGN '+v,formatNubanDisplay:v=>v};vm.createContext(context);vm.runInContext(source.slice(start,end)+';renderAdminUsersTable();',context);return tbody.innerHTML;}
let html=render({email:'synthetic@example.invalid',fullName:'Synthetic Member'});assert.match(html,/Unavailable/);assert.match(html,/Not recorded/);for(const claim of ['850000','9021849102','Tier 2 (BVN/NIN)','Providus Bank','Credit ₦50k'])assert.ok(!html.includes(claim),claim);
html=render({fullName:'Synthetic Member',balance:0,nuban:'9000000001',kycTier:1});assert.match(html,/NGN 0/);assert.match(html,/9000000001/);assert.match(html,/Tier 1 \(recorded\)/);
for(const balance of [null,'',NaN,Infinity,-1])assert.match(render({balance}),/Unavailable/);
assert.ok(source.includes('if (!isProd && adminWaitlistEntries.length === 0)'));
console.log('PASS missing executive wallet data stays unavailable; authoritative zero/tier retained; invalid balances rejected; sample leads restricted to demo mode');
