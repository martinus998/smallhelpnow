// Canonical Stripe state only. A browser redirect never proves payment.
export const SESSION = /^cs_live_[A-Za-z0-9_]{10,240}$/;
export const TOKEN = /^[a-f0-9]{64}$/;
export function canonicalStatus(session, {app, mode = 'payment', offers, ownerHash, qrOnly = false}) {
  if (!session?.livemode || !SESSION.test(session.id || '') || session.mode !== mode || session.metadata?.app !== app || session.currency !== 'usd') throw new Error('session_mismatch');
  const option = session.metadata?.offer;
  const offer = Object.hasOwn(offers, option) ? offers[option] : null;
  if (!offer || session.amount_total !== offer.amount || session.metadata?.price_version !== 'us-low-20261003') throw new Error('amount_mismatch');
  if (qrOnly && session.metadata?.checkout_channel !== 'qr') throw new Error('session_mismatch');
  if (ownerHash && session.metadata?.owner_hash !== ownerHash) throw new Error('access_denied');
  if (session.payment_status === 'paid' && session.status === 'complete') return {status:'paid', offer:option, amount:offer.amount};
  if (session.status === 'expired') return {status:'expired', offer:option, amount:offer.amount};
  return {status:session.status === 'complete' ? 'processing' : 'open', offer:option, amount:offer.amount};
}
export function checkoutParams({app, brand, mode = 'payment', offer, option, ownerHash, qr, now = Date.now(), origin, product}) {
  const metadata = {app, offer:option, price_version:'us-low-20261003', checkout_channel:qr ? 'qr' : 'web', ...(ownerHash ? {owner_hash:ownerHash} : {})};
  const price_data = {currency:'usd', unit_amount:offer.amount, ...(product ? {product} : {product_data:{name:offer.name, description:offer.description}}), ...(mode === 'subscription' ? {recurring:{interval:'month'}} : {})};
  return {mode, locale:'en', branding_settings:{display_name:brand}, line_items:[{price_data,quantity:1}], metadata,
    ...(mode === 'subscription' ? {subscription_data:{metadata:{app,plan:option}},payment_method_collection:'always'} : {customer_creation:'if_required',submit_type:'pay'}),
    success_url:qr ? origin+'/payment-return.html?checkout=success&session_id={CHECKOUT_SESSION_ID}' : app === 'billsavings_ai' ? origin+'/start.html?checkout=success&session_id={CHECKOUT_SESSION_ID}' : app === 'repaircostmatch' ? origin+'/?pro_live=success&session_id={CHECKOUT_SESSION_ID}' : origin+'/?support=thanks&session_id={CHECKOUT_SESSION_ID}',
    cancel_url:qr ? origin+'/payment-return.html?checkout=cancel' : app === 'billsavings_ai' ? origin+'/start.html' : origin+'/?payment=cancelled',
    billing_address_collection:'auto',allow_promotion_codes:false,automatic_tax:{enabled:false},managed_payments:{enabled:false},
    integration_identifier:app+'_qrlower_ejkpsvra'};
}
