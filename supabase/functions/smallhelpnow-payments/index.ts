import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import Stripe from 'npm:stripe@22.6.0';
import {canonicalStatus, checkoutParams, SESSION, TOKEN} from './checkout-state.mjs';

const APP = "smallhelpnow";
const BRAND = "SmallHelpNow";
const MODE = "payment";
const ORIGIN = "https://smallhelpnow.com";
const ORIGINS = new Set(["https://smallhelpnow.com", "https://www.smallhelpnow.com", "https://smallhelpnow.vercel.app"]);
const OFFERS = {"1": {"amount": 100, "name": "SmallHelpNow \u00b7 One-time support", "description": "Voluntary support for development and operation of useful projects. Not a charitable donation."}, "1.99": {"amount": 199, "name": "SmallHelpNow \u00b7 One-time support", "description": "Voluntary support for development and operation of useful projects. Not a charitable donation."}, "4.99": {"amount": 499, "name": "SmallHelpNow \u00b7 One-time support", "description": "Voluntary support for development and operation of useful projects. Not a charitable donation."}, "3": {"amount": 300, "name": "SmallHelpNow \u00b7 One-time support", "description": "Voluntary support for development and operation of useful projects. Not a charitable donation."}, "5": {"amount": 500, "name": "SmallHelpNow \u00b7 One-time support", "description": "Voluntary support for development and operation of useful projects. Not a charitable donation."}};
const ACTIVE = new Set(['active','trialing','past_due','unpaid','incomplete','paused']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function hash(value:string) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function headers(origin:string) {return {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':ORIGINS.has(origin)?origin:ORIGIN,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'content-type,authorization,apikey,x-client-info','X-Content-Type-Options':'nosniff'};}
Deno.serve(async (req:Request) => {
  const origin=req.headers.get('origin')||'';
  const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:headers(origin)});
  if(!ORIGINS.has(origin))return json({error:'origin_not_allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(origin)});
  if(req.method==='GET')return json({ok:true,prices:Object.fromEntries(Object.entries(OFFERS).map(([k,v])=>[k,v.amount])),requires_account_before_payment:false});
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  try {
    const raw=await req.text();if(raw.length>5000)return json({error:'request_too_large'},413);
    let body:any;try{body=JSON.parse(raw);}catch{return json({error:'invalid_json'},400);}
    const action=body.action||'checkout';
    if(!['checkout','checkout_status','cancel_checkout','receipt','proof'].includes(action))return json({error:'invalid_action'},400);
    if(action==='proof'&&APP!=='repaircostmatch')return json({error:'invalid_action'},400);
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
    const {data:allowed,error:limitError}=await admin.rpc('safeorscam_rate_limit',{p_bucket:await hash(APP+':'+ip+':'+(action==='checkout'?'create':String(body.session_id||''))+':'+Math.floor(Date.now()/60000)),p_limit:action==='checkout'?8:30});
    if(limitError)return json({error:'service_unavailable'},503);if(!allowed)return json({error:'rate_limited'},429);
    const key=(Deno.env.get('BILLSAVINGS_STRIPE_LIVE_SECRET_KEY')||Deno.env.get('STRIPE_LIVE_SECRET_KEY')||Deno.env.get('STRIPE_SECRET_KEY')||'').trim();
    if(!/^(sk|rk)_live_/.test(key))return json({error:'checkout_unavailable'},503);
    const stripe=new Stripe(key,{apiVersion:'2026-08-26.dahlia',timeout:15000,maxNetworkRetries:1});
    if(action==='checkout') {
      const option=String(body.plan||body.amount||body.offer||'');
      if(!Object.hasOwn(OFFERS,option))return json({error:'invalid_plan'},400);
      const cfg=OFFERS[option];
      const qr=body.checkout_channel==='qr';
      if(body.attempt!=null&&!UUID.test(body.attempt))return json({error:'invalid_attempt'},400);
      if((qr||APP==='repaircostmatch')&&!TOKEN.test(body.token||''))return json({error:'invalid_access'},400);
      let user:any=null;
      if(APP==='billsavings_ai'&&req.headers.has('authorization')) {
        const bearer=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!bearer)return json({error:'sign_in_required'},401);
        const {data,error}=await admin.auth.getUser(bearer);
        if(error||!data.user?.id||!data.user.email_confirmed_at||!data.user.email||data.user.is_anonymous)return json({error:'sign_in_required'},401);
        user=data.user;
        const {data:current,error:lookupError}=await admin.from('billing_subscriptions').select('plan,status').eq('user_id',user.id).maybeSingle();
        if(lookupError)return json({error:'account_check_unavailable'},503);
        if(current&&['premium','family'].includes(current.plan)&&ACTIVE.has(current.status))return json({error:'already_subscribed'},409);
      }
      const ownerHash=TOKEN.test(body.token||'')?await hash(body.token):undefined;
      const params:any=checkoutParams({app:APP,brand:BRAND,mode:MODE,offer:cfg,option,ownerHash,qr,origin:APP==='smallhelpnow'?origin:ORIGIN,product:cfg.product});
      if(APP==='billsavings_ai') {
        params.metadata.plan=option;params.metadata.checkout_flow='pay_first';
        params.branding_settings.background_color='#eaf3ff';params.branding_settings.button_color='#1967d2';
        if(user){params.customer_email=user.email.trim().toLowerCase();params.metadata.user_id=user.id;params.subscription_data.metadata.user_id=user.id;}
      }
      const attempt=body.attempt||crypto.randomUUID();
      const session=await stripe.checkout.sessions.create(params,{idempotencyKey:APP+':low-v1:'+option+':'+(qr?'qr':'web')+':'+(user?.id||'guest')+':'+(ownerHash||'')+':'+attempt});
      if(!session.livemode||!SESSION.test(session.id)||!session.url?.startsWith('https://checkout.stripe.com/c/pay/'))throw new Error('checkout_unavailable');
      canonicalStatus(session,{app:APP,mode:MODE,offers:OFFERS,ownerHash,qrOnly:qr});
      return json({ok:true,url:session.url,checkout_url:session.url,session_id:session.id,expires_at:session.expires_at,amount:cfg.amount,offer:option});
    }
    if(!SESSION.test(String(body.session_id||'')))return json({error:'invalid_session'},400);
    const owner=action!=='receipt';
    if(owner&&!TOKEN.test(body.token||''))return json({error:'invalid_access'},403);
    const ownerHash=owner?await hash(body.token):undefined;
    let session=await stripe.checkout.sessions.retrieve(body.session_id);
    let state=canonicalStatus(session,{app:APP,mode:MODE,offers:OFFERS,ownerHash,qrOnly:APP!=='repaircostmatch'});
    if(action==='cancel_checkout'&&state.status==='open') {
      try{session=await stripe.checkout.sessions.expire(session.id);}catch{session=await stripe.checkout.sessions.retrieve(session.id);}
      state=canonicalStatus(session,{app:APP,mode:MODE,offers:OFFERS,ownerHash,qrOnly:APP!=='repaircostmatch'});
    }
    // New RepairCostMatch receipts also recheck refunds/disputes before granting access.
    if(APP==='repaircostmatch'&&state.status==='paid') {
      const intent=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
      if(!intent)throw new Error('verification_unavailable');
      const payment=await stripe.paymentIntents.retrieve(intent,{expand:['latest_charge']});
      const charge:any=payment.latest_charge;
      if(payment.status!=='succeeded'||payment.amount_received!==199||payment.currency!=='usd'||!charge||typeof charge==='string')throw new Error('verification_unavailable');
      if(charge.refunded||charge.amount_refunded>0||charge.disputed)state={...state,status:'revoked'};
    }
    if(action==='proof') {
      if(state.status!=='paid')return json({error:'payment_not_complete'},409);
      return json({ok:true,status:'paid',session_id:session.id,amount:199,currency:'usd',offer_marker:'checkout_repair199',payment_intent:typeof session.payment_intent==='string'?session.payment_intent:null});
    }
    return json({ok:true,...state});
  } catch(error) {
    const message=error instanceof Error?error.message:'unknown';
    if(['session_mismatch','amount_mismatch','access_denied'].includes(message))return json({error:'invalid_access'},403);
    console.error(APP,'payment request failed',message);
    return json({error:'service_unavailable'},503);
  }
});
