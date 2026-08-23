const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeEmail,validEmail,cleanDisplayName,hashToken,newSession,safeEqualHex}=require('../lib/security');

test('security helpers normalise and validate user input',()=>{
  assert.equal(normalizeEmail('  HOST@Example.COM '),'host@example.com');
  assert.equal(validEmail('host@example.com'),true);
  assert.equal(validEmail('not-an-email'),false);
  assert.equal(cleanDisplayName('  <Sabith>   Salah  '),'Sabith Salah');
});

test('session tokens are random and only hashes need storage',()=>{
  const first=newSession(),second=newSession();
  assert.notEqual(first.token,second.token);
  assert.equal(hashToken(first.token),first.tokenHash);
  assert.match(first.tokenHash,/^[a-f0-9]{64}$/);
});

test('constant-time comparison rejects changed signatures',()=>{
  const value='a'.repeat(64);
  assert.equal(safeEqualHex(value,value),true);
  assert.equal(safeEqualHex(value,'b'.repeat(64)),false);
  assert.equal(safeEqualHex(value,'short'),false);
});
