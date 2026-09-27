(() => {
  let owner=false;
  try { owner=localStorage.getItem('smallhelpnow_owner_device')==='1'; } catch {}
  if(owner || !crypto?.randomUUID) return;

  const endpoint='https://bkyuyqicybqqifenhhux.supabase.co/functions/v1/live-analytics/collect';
  const site='smallhelpnow';
  const getId=(storage,key)=>{
    try{
      let v=storage.getItem(key);
      if(!v){v=crypto.randomUUID();storage.setItem(key,v);}
      return v;
    }catch{return crypto.randomUUID();}
  };
  const visitorId=getId(localStorage,'smallhelpnow_live_visitor_v1');
  const sessionId=getId(sessionStorage,'smallhelpnow_live_session_v1');
  let sentView=false,lastActivity=Date.now(),lastPing=0;

  function sourcePayload(){
    let referrer_host='';
    try{
      if(document.referrer){
        const u=new URL(document.referrer);
        if(u.hostname && u.hostname!==location.hostname) referrer_host=u.hostname.toLowerCase();
      }
    }catch{}
    const qs=new URLSearchParams(location.search);
    return {
      referrer_host,
      utm_source:(qs.get('utm_source')||'').slice(0,120),
      utm_medium:(qs.get('utm_medium')||'').slice(0,120),
      utm_campaign:(qs.get('utm_campaign')||'').slice(0,160)
    };
  }

  async function ping(pageview=false){
    if(document.visibilityState==='hidden'&&!pageview)return;
    if(!pageview&&Date.now()-lastActivity>60000)return;
    lastPing=Date.now();
    try{
      await fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          site,visitor_id:visitorId,session_id:sessionId,
          path:location.pathname,pageview,
          active_at:new Date(lastActivity).toISOString(),
          ...sourcePayload()
        })
      });
    }catch{}
  }

  function markActive(){
    lastActivity=Date.now();
    if(document.visibilityState==='visible'&&Date.now()-lastPing>25000)void ping(false);
  }
  function first(){
    if(sentView)return;
    sentView=true;lastActivity=Date.now();void ping(true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',first,{once:true});else first();
  ['pointerdown','keydown','touchstart','scroll'].forEach(type=>window.addEventListener(type,markActive,{passive:true}));
  setInterval(()=>void ping(false),30000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastActivity=Date.now();void ping(false);}});
})();