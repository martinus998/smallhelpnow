(() => {
 'use strict';
 const API='https://bkyuyqicybqqifenhhux.supabase.co/functions/v1/smallhelpnow-payments';
 const params=new URLSearchParams(location.search),id=params.get('session_id'),state=document.getElementById('paymentReturnStatus');
 if(params.get('checkout')==='cancel'){state.textContent='Checkout was closed. Return to the original browser to check or cancel the same payment before trying again.';return;}
 if(!/^cs_live_[A-Za-z0-9_]{10,240}$/.test(id||'')){state.textContent='Return to the original website to check your payment. Do not pay again if you already confirmed it.';return;}
 history.replaceState(null,'',location.pathname);
 let attempt=0;
 async function check(){attempt++;try{const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'receipt',session_id:id}),cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});const d=await response.json();if(!response.ok)throw new Error('unavailable');if(d.status==='paid'){state.textContent='Thank you! Your support payment is confirmed.';return;}if(['expired','revoked'].includes(d.status)){state.textContent='This payment link is no longer available. Return to the original browser.';return;}state.textContent='Payment has not been confirmed yet. Return to the original browser to check this order. Do not pay again while it is processing.';}catch{state.textContent='Payment confirmation is temporarily unavailable. Return to the original browser and check there. Do not pay again.';}if(attempt<12)setTimeout(check,10000);}
 void check();
})();
