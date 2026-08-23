const test=require('node:test');
const assert=require('node:assert/strict');
const store=require('../lib/store');

test('a verified order activates exactly one 30-day period',async()=>{
  const email=`host-${Date.now()}@example.com`,user=await store.createUser({email,passwordHash:'hash',displayName:'Host'});
  await store.createPendingPayment({orderId:'order_test_store',userId:user.id,amount:4900,currency:'INR',receipt:'receipt_test'});
  const first=await store.activateSubscription({orderId:'order_test_store',paymentId:'pay_test_store'});
  const expiry=first.user.subscriptionExpiresAt;
  assert.ok(Date.parse(expiry)>Date.now()+29*24*60*60*1000);
  const second=await store.activateSubscription({orderId:'order_test_store',paymentId:'pay_test_store'});
  assert.equal(second.alreadyActivated,true);
  assert.equal(second.user.subscriptionExpiresAt,expiry);
});
