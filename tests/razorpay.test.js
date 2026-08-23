const test=require('node:test');
const assert=require('node:assert/strict');
const {hmac}=require('../lib/razorpay-service');

test('Razorpay-compatible checkout HMAC uses SHA-256 hex output',()=>{
  assert.equal(hmac('order_123|pay_456','secret'),'18bfc0baafae8f6367711ee362f2201aaa3654274683100e5367bb9a2bd29cbe');
});
