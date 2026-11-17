/** Accessible presentation behavior. Does not change authentication or financial permissions. */
(function(){
 'use strict';
 const overlays=Array.from(document.querySelectorAll('.modal-overlay'));
 let active=null,returnFocus=null;
 const visible=()=>overlays.filter(el=>!el.classList.contains('hidden')&&el.getClientRects().length)
  .sort((a,b)=>(parseInt(getComputedStyle(a).zIndex)||0)-(parseInt(getComputedStyle(b).zIndex)||0)).at(-1)||null;
 const controls=el=>Array.from(el.querySelectorAll('button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]'))
  .filter(node=>node.tabIndex>=0&&node.getClientRects().length);
 function refreshDialog(){
  const next=visible();if(next===active)return;
  if(!active&&next)returnFocus=document.activeElement;
  active=next;
  if(next){
   const box=next.querySelector('.modal-box')||next;box.setAttribute('tabindex','-1');
   requestAnimationFrame(()=>{if(active!==next)return;const field=next.querySelector('input:not([type="hidden"]):not([disabled])');(field||controls(next)[0]||box).focus({preventScroll:true})});
  }else if(returnFocus?.isConnected&&returnFocus.getClientRects().length){returnFocus.focus({preventScroll:true});returnFocus=null;}
 }
 const observer=new MutationObserver(refreshDialog);overlays.forEach(el=>observer.observe(el,{attributes:true,attributeFilter:['class']}));
 document.addEventListener('keydown',event=>{
  if(!active)return;
  if(event.key==='Tab'){
   const list=controls(active);if(!list.length){event.preventDefault();return;}
   const first=list[0],last=list.at(-1);
   if(event.shiftKey&&(document.activeElement===first||!active.contains(document.activeElement))){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&(document.activeElement===last||!active.contains(document.activeElement))){event.preventDefault();first.focus()}
  }
  if(event.key==='Escape'&&!active.classList.contains('modal-mandatory-lock')&&!active.querySelector('.loading')){
   const close=active.querySelector('.modal-close-btn:not([disabled])');if(close){event.preventDefault();close.click()}
  }
 });
 const preview=window.MIDEPAY_SUPABASE_CONFIG?.url==='https://ajbhsmcosxgymrtawlmd.supabase.co';
 if(preview){
  const upgrade=document.getElementById('btn-submit-tier3-upgrade');if(upgrade){upgrade.disabled=true;upgrade.textContent='Identity checks are coming later';}
 }
 refreshDialog();
})();
