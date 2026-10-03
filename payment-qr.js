(() => {
  'use strict';
  const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  class PaymentQr {
    constructor(config) {
      Object.assign(this,config);this.pending=null;this.draft=null;
      try {const p=JSON.parse(sessionStorage.getItem(this.key)||'null');if(p?.session_id)this.pending=this.validate(p);else if(p&&Object.hasOwn(this.choices,p.option)&&/^[a-f0-9]{64}$/.test(p.token||'')&&/^[a-f0-9-]{36}$/i.test(p.attempt||''))this.draft=p;} catch {sessionStorage.removeItem(this.key);}
      document.addEventListener('visibilitychange',()=>{if(!document.hidden&&this.pending)this.poll();});
      window.addEventListener('pagehide',()=>clearTimeout(this.timer));
    }
    get hasPending(){return !!(this.pending||this.draft);}
    validate(p) {
      if(!p||!Object.hasOwn(this.choices,p.option)||!/^cs_live_[A-Za-z0-9_]{10,240}$/.test(p.session_id||'')||!/^[a-f0-9]{64}$/.test(p.token||'')||!Number.isSafeInteger(p.expires_at)||p.amount!==this.choices[p.option].amount)throw new Error('invalid_checkout');
      const u=new URL(p.url);if(u.origin!=='https://checkout.stripe.com'||u.username||u.password||u.pathname!=='/c/pay/'+p.session_id)throw new Error('invalid_checkout');return {...p,url:u.href};
    }
    save(p){sessionStorage.setItem(this.key,JSON.stringify(p));}
    clear(){clearTimeout(this.timer);this.pending=null;this.draft=null;sessionStorage.removeItem(this.key);}
    display(title,html) {
      let d=document.getElementById('paymentQrDialog');
      if(!d){d=document.createElement('dialog');d.id='paymentQrDialog';d.className='payment-qr-dialog';document.body.append(d);d.addEventListener('close',()=>clearTimeout(this.timer));}
      d.innerHTML='<button type="button" id="qrClose" aria-label="Close QR payment" class="qr-close">×</button><h2 id="qrHeading">'+escape(title)+'</h2>'+html;
      d.setAttribute('aria-labelledby','qrHeading');document.getElementById('qrClose').addEventListener('click',()=>d.close());if(!d.open)d.showModal();
    }
    message(text){const n=document.getElementById('paymentQrStatus');if(n)n.textContent=text;}
    async prepare(option) {
      if(this.pending)return this.showCurrent();if(this.preparing)return this.preparing;
      this.preparing=(async()=>{
        if(!this.draft){if(!Object.hasOwn(this.choices,option))throw new Error('invalid_offer');this.draft={option,token:token(),attempt:crypto.randomUUID()};this.save(this.draft);}
        this.display('Preparing QR payment','<p id="paymentQrStatus" role="status">Creating your secure Stripe payment link…</p>');
        try {
          const data=await this.create(this.draft);
          const p=this.validate({...data,option:this.draft.option,token:this.draft.token,attempt:this.draft.attempt});
          this.save(p);this.pending=p;this.draft=null;await this.showCurrent();
        } catch(error){
          if(['already_subscribed','sign_in_required','invalid_profile','invalid_plan','order_expired','already_has_pro'].includes(error.message)){this.clear();this.onError?.(error);}
          this.display('QR checkout unavailable','<p id="paymentQrStatus" role="status">We could not confirm whether checkout was created. Retry the same request before starting another payment.</p><button id="qrRetry" class="qr-action" type="button">Retry QR checkout</button>');
          document.getElementById('qrRetry').addEventListener('click',()=>this.prepare(option));
        }
      })();try{await this.preparing;}finally{this.preparing=null;}
    }
    async showCurrent() {
      const p=this.pending;if(!p)return;
      const choice=this.choices[p.option],url=escape(p.url);
      this.display('Pay by QR code','<div class="qr-payment"><p class="qr-price"><strong>'+escape(choice.label)+' · $'+(choice.amount/100).toFixed(2)+'</strong><small>'+escape(choice.interval||'USD · one-time payment · no subscription')+'</small></p><div id="paymentQrImage" class="payment-qr-image" aria-label="Stripe payment QR code"></div><p>Scan with another device and confirm your payment on Stripe.</p><p class="qr-note">'+escape(this.note)+'</p><p id="paymentQrStatus" role="status">Waiting for payment confirmation…</p><div class="qr-actions"><a id="qrOpen" class="qr-action" href="'+url+'">Open checkout on this device</a><button id="qrCopy" class="qr-action" type="button">Copy payment link</button><button id="qrCheck" class="qr-action" type="button">Check payment</button><button id="qrCancel" class="qr-action" type="button">Cancel this checkout</button></div><p class="qr-note">Card and eligible Google Pay are available on Stripe. The QR opens this same checkout.</p><small class="qr-note">Link expires '+escape(new Date(p.expires_at*1000).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}))+'.</small></div>');
      document.getElementById('qrCheck').addEventListener('click',()=>this.poll());document.getElementById('qrCancel').addEventListener('click',()=>this.cancel());
      document.getElementById('qrCopy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(p.url);this.message('Payment link copied.');}catch{const t=document.createElement('input');t.value=p.url;t.readOnly=true;t.className='qr-copy-input';t.setAttribute('aria-label','Payment link');document.getElementById('paymentQrImage').after(t);t.select();this.message('Select and copy the payment link.');}});
      try {
        if(!window.qrcode)await new Promise((resolve,reject)=>{let s=document.getElementById('qrGenerator');if(s){s.addEventListener('load',resolve,{once:true});s.addEventListener('error',reject,{once:true});return;}s=document.createElement('script');s.id='qrGenerator';s.src='/qrcode.js';s.onload=resolve;s.onerror=()=>{s.remove();reject(new Error('QR unavailable'));};document.head.append(s);});
        if(this.pending!==p)return;
        const q=window.qrcode(0,'M');q.addData(p.url,'Byte');q.make();const node=document.getElementById('paymentQrImage');if(node){node.innerHTML=q.createSvgTag({cellSize:4,margin:16,scalable:true});const svg=node.querySelector('svg');svg.setAttribute('role','img');svg.setAttribute('aria-label','Scan to pay on Stripe');}
      }catch{this.message('QR image could not load. Open checkout here or copy the same link.');}
      if(this.pending===p)this.poll();
    }
    async complete(data){if(!this.pending||this.completing)return;this.completing=true;try{await this.onPaid(data,this.pending);this.clear();document.getElementById('paymentQrDialog')?.close();}catch{this.message('Payment is confirmed but access could not load yet. Check payment again; do not pay again.');}finally{this.completing=false;}}
    async poll(){const p=this.pending;if(!p||this.polling||this.cancelling)return;clearTimeout(this.timer);this.polling=true;try{const data=await this.status('checkout_status',p);if(this.pending!==p)return;if(data.status==='paid'){await this.complete(data);return;}if(['expired','revoked'].includes(data.status)){this.clear();this.display(data.status==='expired'?'Payment link expired':'Payment unavailable','<p>This checkout is no longer available. Return to the website to choose another purchase.</p><a class="qr-action" href="/">Back to website</a>');return;}if(data.status==='processing'){this.message('Stripe is processing this payment. Do not pay again.');document.getElementById('qrOpen').hidden=true;}}catch{this.message('Confirmation is temporarily unavailable. We will retry. Do not pay again.');}finally{this.polling=false;if(this.pending===p)this.timer=setTimeout(()=>{if(!document.hidden&&document.getElementById('paymentQrDialog')?.open)this.poll();},10000);}}
    async cancel(){const p=this.pending;if(!p||this.cancelling)return;this.cancelling=true;clearTimeout(this.timer);const b=document.getElementById('qrCancel');b.disabled=true;try{const data=await this.status('cancel_checkout',p);if(this.pending!==p)return;if(data.status==='paid')await this.complete(data);else if(data.status==='expired'){this.clear();document.getElementById('paymentQrDialog').close();this.onCancelled?.();}else this.message('Payment is processing or cancellation is unconfirmed. Do not start another payment.');}catch{this.message('Cancellation could not be confirmed. Retry or check payment before paying again.');}finally{this.cancelling=false;b.disabled=false;if(this.pending===p)this.poll();}}
    async resume(){if(this.pending)return this.showCurrent();if(this.draft)return this.prepare(this.draft.option);}
  }
  window.PaymentQr=PaymentQr;
})();
