(function(){
 'use strict';
 const el=id=>document.getElementById(id),pane=el('pane-admin-payments'),admin=el('view-admin');if(!pane||!admin)return;
 let generation=0,selected=null,timer=null,busy=false;
 const visible=()=>!pane.classList.contains('hidden')&&!admin.classList.contains('hidden');
 const message=text=>{el('refund-review-message').textContent=text;};
 const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
 const money=kobo=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(Number(kobo)/100);
 const codes={MFA_REQUIRED:'Verify your authenticator above, then reload.',FORBIDDEN:'Executive authorization is required.',REFUND_ACCOUNTING_DISABLED:'Refund adjustments are disabled.',INSUFFICIENT_FUNDS:'Insufficient funds. This request now requires manual review.',MANUAL_REVIEW_REQUIRED:'This request needs manual review.',SEPARATION_OF_DUTIES:'A different executive must approve.',FRESH_VERIFICATION_REQUIRED:'Fresh provider verification is required.',LEDGER_RECONCILIATION_REQUIRED:'The wallet ledger needs review.',MAKER_NOT_AUTHORIZED:'The requesting operator is no longer authorized.',REFUND_EXCEEDS_PAYMENT:'Refunds exceed the original payment. Manual review is required.'};
 function cancel(){selected=null;el('refund-review-pin').value='';el('refund-review-reason').value='';el('refund-review-form').hidden=true;}
 function clear(){generation++;clearTimeout(timer);cancel();el('refund-review-rows').replaceChildren();}
 async function rpc(name,args={}){try{return await window.MidePayDB?.treasuryRpc(name,args)||{success:false};}catch{return{success:false};}}
 function choose(row,action){cancel();selected={row,action};el('refund-review-selection').textContent=(action==='request'?'Request adjustment: ':action==='cancel'?'Close request without moving money: ':'Approve wallet debit: ')+money(row.amount_kobo)+' · refund '+row.provider_refund_id;el('refund-review-reason').required=action!=='approve';el('refund-review-reason').hidden=action==='approve';el('refund-review-reason').previousElementSibling.hidden=action==='approve';el('refund-review-submit').textContent=action==='request'?'Create approval request':action==='cancel'?'Close request':'Approve wallet debit';el('refund-review-form').hidden=false;el(action!=='approve'?'refund-review-reason':'refund-review-pin').focus();}
 async function load(){
  if(!visible()||busy)return;clear();const seq=generation;message('Loading refund records…');const data=await rpc('get_refund_adjustment_queue');if(seq!==generation||!visible())return;
  if(!data.success){message(codes[data.code]||'The queue could not be loaded. Try again.');return;}
  message(data.enabled?'Adjustments enabled. Check the amount and original payment before approval.':'Adjustments disabled. You can review records; wallet actions are unavailable.');
  const rows=el('refund-review-rows');
  for(const [kind,items] of [['request',data.verifications||[]],['approve',data.requests||[]]])for(const row of items){
   const card=node('article');card.className='payment-review-card';card.append(node('strong',money(row.amount_kobo)+' · refund '+row.provider_refund_id),node('p','Original payment: '+row.reference));
   card.append(node('p',kind==='request'?(row.fresh?'Provider verified · ready for a request':'Verification expired'):row.status.replaceAll('_',' ')));
   if(row.reason)card.append(node('p',row.reason));if(row.review_code)card.append(node('p',codes[row.review_code]||'Manual review required.'));
   if(kind==='approve')card.append(node('p',row.maker_id===data.viewer_id?'Requested by you · another executive must approve':'Requested by another executive'));
   if(data.enabled&&(kind==='request'?row.fresh&&!row.own_wallet:row.can_approve)){const button=node('button',kind==='request'?'Request adjustment':'Review approval');button.type='button';button.className='btn btn-outline-sm';button.addEventListener('click',()=>choose(row,kind));card.append(button);}if(kind==='approve'&&row.maker_id===data.viewer_id&&['pending','manual_review'].includes(row.status)){const close=node('button','Close request without moving money');close.type='button';close.className='btn btn-outline-sm';close.addEventListener('click',()=>choose(row,'cancel'));card.append(close);}rows.append(card);
  }
  if(!rows.children.length)rows.append(node('p','No verified refunds or requests to review.'));
  timer=setTimeout(()=>{clear();message('Authenticator access expired. Verify again and reload.');},Math.max(0,Math.min(600000,Date.parse(data.access_expires_at)-Date.now())));
 }
 el('refund-review-refresh').addEventListener('click',load);el('refund-review-cancel').addEventListener('click',cancel);
 el('refund-review-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!selected||!visible())return;const {row,action}=selected,pin=el('refund-review-pin').value,reason=el('refund-review-reason').value.trim();el('refund-review-pin').value='';
  if(!/^\d{4}$/.test(pin)){message('Enter your four-digit transaction PIN.');return;}if(action!=='approve'&&reason.length<5){message('Enter a reason of at least five characters.');return;}
  busy=true;const seq=generation;el('refund-review-submit').disabled=true;
  const data=await rpc(action==='request'?'request_refund_adjustment':action==='cancel'?'cancel_refund_adjustment':'approve_refund_adjustment',action==='request'?{p_verification_id:row.id,p_reason:reason,p_pin:pin}:action==='cancel'?{p_request_id:row.id,p_reason:reason,p_pin:pin}:{p_request_id:row.id,p_pin:pin});
  busy=false;el('refund-review-submit').disabled=false;if(seq!==generation||!visible())return;cancel();await load();
  message(data.success?(data.status==='cancelled'?'Request closed. No wallet movement.':data.status==='applied'?'Refund adjustment applied.':data.status==='duplicate'?'Already recorded. The queue has been refreshed.':'Request created. A different executive must approve.'):(codes[data.code]||'The result could not be confirmed. Reload the queue before trying again.'));
 });
 new MutationObserver(()=>{if(!visible()){clear();message('Load the queue to review refunds.');}}).observe(admin,{attributes:true,attributeFilter:['class'],subtree:true});
 for(const id of ['admin-logout-btn','dash-logout-btn'])el(id)?.addEventListener('click',clear);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
})();
