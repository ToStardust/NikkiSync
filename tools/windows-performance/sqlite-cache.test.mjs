import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseManager} from '../../packages/database/dist/src/database-manager.js';

test('SQLite hot statements reuse bounded compiled queries while rebinding values and reading fresh rows',()=>{
 const db=new DatabaseManager(':memory:');
 try{
  db.initialize('CREATE TABLE sample(value TEXT NOT NULL);');
  const insert=db.connection.prepare('INSERT INTO sample VALUES (?)');insert.run('first');
  const first=db.connection.prepare('SELECT ? AS value');
  assert.equal(first.get('one').value,'one');
  const second=db.connection.prepare('SELECT ? AS value');
  assert.equal(second.get('two').value,'two');
  if(process.versions.bun)assert.equal(first,second,'the packaged runtime must cache compiled hot SQL');
  const read=db.connection.prepare('SELECT COUNT(*) AS count FROM sample');
  assert.equal(read.get().count,1);insert.run('second');assert.equal(read.get().count,2);
  if(process.versions.bun){
   for(let i=0;i<128;i++)db.connection.prepare('SELECT ? AS value_'+i).get(i);
   assert.notEqual(db.connection.prepare('SELECT ? AS value'),first,'one-off SQL cannot grow the cache without bound');
   assert.equal(first.get('held').value,'held','eviction must not invalidate a statement still in use');
  }
 }finally{db.close();}
});
