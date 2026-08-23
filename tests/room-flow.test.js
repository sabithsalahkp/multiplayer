process.env.NODE_ENV='test';
process.env.PORT='0';

const test=require('node:test');
const assert=require('node:assert/strict');
const request=require('supertest');
const {io:clientIo}=require('socket.io-client');
const store=require('../lib/store');
const {app,start,shutdown}=require('../server');

function emitAck(socket,event,payload={}){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${event} timeout`)),4000);socket.emit(event,payload,result=>{clearTimeout(timer);resolve(result)})})}
function connect(url,headers={}){return new Promise((resolve,reject)=>{const socket=clientIo(url,{transports:['websocket'],extraHeaders:headers,reconnection:false});socket.once('connect',()=>resolve(socket));socket.once('connect_error',reject)})}

test('host subscription gates creation while guests join free by private code',async t=>{
  const listener=await start(),address=listener.address(),url=`http://127.0.0.1:${address.port}`;
  let host=null,guest=null;
  t.after(async()=>{host?.close();guest?.close();await shutdown()});
  const email=`flow-${Date.now()}@example.com`,registration=await request(app).post('/api/auth/register').send({email,password:'correct-horse-123',displayName:'Flow Host',acceptLegal:true}).expect(201);
  const sessionCookie=registration.headers['set-cookie'][0].split(';')[0];host=await connect(url,{Cookie:sessionCookie});guest=await connect(url);

  const blocked=await emitAck(host,'room:create',{name:'Flow Host'});assert.equal(blocked.ok,false);assert.equal(blocked.code,'SUBSCRIPTION_REQUIRED');
  const user=await store.getUserByEmail(email);await store.createPendingPayment({orderId:'order_flow_test',userId:user.id,amount:4900,currency:'INR',receipt:'flow_test'});await store.activateSubscription({orderId:'order_flow_test',paymentId:'pay_flow_test'});

  const created=await emitAck(host,'room:create',{name:'Flow Host'});assert.equal(created.ok,true);assert.match(created.room.code,/^[A-Z0-9]{6}$/);assert.ok(created.resumeToken);
  const joined=await emitAck(guest,'room:join',{name:'Free Guest',code:created.room.code});assert.equal(joined.ok,true);assert.equal(joined.room.players.length,2);assert.ok(joined.resumeToken);
  guest.close();await new Promise(resolve=>setTimeout(resolve,60));guest=await connect(url);
  const resumed=await emitAck(guest,'room:resume',{code:created.room.code,resumeToken:joined.resumeToken});assert.equal(resumed.ok,true);assert.equal(resumed.room.players.length,2);assert.equal(resumed.room.players.some(player=>player.id===guest.id),true);
  const hidden=await request(app).get('/api/rooms').expect(200);assert.deepEqual(hidden.body.rooms,[]);
});
