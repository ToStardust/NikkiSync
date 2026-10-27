import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {containsSourceSecret} from './source-privacy.mjs';

test('source audit accepts placeholder key text used to test safe startup errors',()=>{
 const placeholder='-----BEGIN PRIVATE KEY-----\nsecret-key\n-----END PRIVATE KEY-----';
 assert.equal(containsSourceSecret(placeholder),false);
 assert.equal(containsSourceSecret(JSON.stringify(placeholder)),false);
});

test('source audit rejects real Ed25519 and RSA private key material',()=>{
 for(const [type,options] of [['ed25519',{}],['rsa',{modulusLength:1024}]]){
  const {privateKey}=generateKeyPairSync(type,options);
  const pem=privateKey.export({type:'pkcs8',format:'pem'});
  assert.equal(containsSourceSecret(pem),true);
  assert.equal(containsSourceSecret(JSON.stringify(pem)),true);
  assert.equal(containsSourceSecret(pem.replaceAll('\n','\r\n')),true);
 }
});

test('source audit retains public key distribution',()=>{
 const {publicKey}=generateKeyPairSync('ed25519');
 assert.equal(containsSourceSecret(publicKey.export({type:'spki',format:'pem'})),false);
});

test('source audit still rejects token-shaped credentials',()=>{
 for(const prefix of ['ghp_','github_pat_'])assert.equal(containsSourceSecret(prefix+'A'.repeat(40)),true);
 assert.equal(containsSourceSecret('github_pat_'+'short'),false);
});
