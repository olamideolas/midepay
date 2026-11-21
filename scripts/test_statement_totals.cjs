const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('path').join(__dirname,'../app.js'),'utf8');
const start=source.indexOf('  function statementSettledTotals('),end=source.indexOf('  function openOfficialStatementModal(',start);
assert.ok(start>=0&&end>start);const totals=vm.runInNewContext(source.slice(start,end)+';statementSettledTotals');
const row=(type,amount,status='successful',fee=0)=>({type,amount,status,fee});
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name)}
test('pending deposits and reversed/failed outflows do not inflate settled totals',()=>{const r=totals([row('inflow',100),row('inflow',10000,'pending'),row('outflow',30,'reversed',2),row('outflow',15,'failed',1)]);assert.equal(r.totalInflow,100);assert.equal(r.totalOutflow,0);assert.equal(r.totalFees,0)});
test('refund debit counts once while the original successful deposit remains visible',()=>{const r=totals([row('inflow',100),{...row('outflow',25),category:'refund'},row('outflow',40,'pending',1)]);assert.equal(r.totalInflow,100);assert.equal(r.totalOutflow,25)});
test('decimal fees and mixed-case statuses sum in whole kobo',()=>{const r=totals([row('outflow','0.10','Successful','0.01'),row('outflow','0.20','successful','0.02')]);assert.equal(r.totalOutflow,0.3);assert.equal(r.totalFees,0.03)});
test('unknown status is not silently reported as settled',()=>{assert.equal(totals([{type:'inflow',amount:100}]).totalInflow,0)});
test('malformed, negative and fractional-kobo settled amounts fail closed',()=>{for(const amount of [NaN,Infinity,-1,'1.001','bad'])assert.throws(()=>totals([row('inflow',amount)]))});
test('empty loaded history has zero settled totals',()=>{assert.equal(totals([]).totalFees,0)});
console.log(`${count} passed; 0 failed`);
