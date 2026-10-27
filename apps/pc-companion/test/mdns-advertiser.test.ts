import assert from 'node:assert/strict'
import test from 'node:test'
import dgram from 'node:dgram'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { MdnsAdvertiser } from '../src/server/MdnsAdvertiser.js'

test('mDNS chooses the same real Wi-Fi host as pairing when a virtual switch is first', t => {
  class Socket extends EventEmitter {
    packet:Buffer=Buffer.alloc(0); selected=''
    bind(_port:number,callback:()=>void){callback()}
    setMulticastInterface(ip:string){this.selected=ip} addMembership(){} setMulticastTTL(){}
    send(packet:Buffer){this.packet=packet} close(){}
  }
  const socket=new Socket()
  t.mock.method(dgram,'createSocket',()=>socket)
  t.mock.method(os,'networkInterfaces',()=>({
    'vEthernet (Default Switch)':[{family:'IPv4',internal:false,address:'172.25.9.238'}],
    WLAN:[{family:'IPv4',internal:false,address:'10.1.4.35'}]
  }))
  const advertiser=new MdnsAdvertiser()
  try{
    advertiser.start({serverId:'fixture-pc',name:'Momo',port:28080})
    assert.equal(socket.selected,'10.1.4.35')
    assert.deepEqual([...socket.packet.subarray(-4)],[10,1,4,35])
  }finally{advertiser.stop()}
})

test('mDNS refreshes its socket and address after hotspot changes to Wi-Fi', t => {
  class Socket extends EventEmitter {
    packets: Buffer[]=[]; closed=false
    bind(_port:number,callback:()=>void){callback()}
    setMulticastInterface(){} addMembership(){} setMulticastTTL(){}
    send(packet:Buffer){this.packets.push(packet)} close(){this.closed=true}
  }
  const sockets:Socket[]=[];let address='192.168.137.1';let tick=()=>{}
  t.mock.method(dgram,'createSocket',()=>{const socket=new Socket();sockets.push(socket);return socket})
  t.mock.method(os,'networkInterfaces',()=>({fixture:[{family:'IPv4',internal:false,address}]}))
  t.mock.method(globalThis,'setInterval',(callback:()=>void)=>{tick=callback;return {} as NodeJS.Timeout})
  t.mock.method(globalThis,'clearInterval',()=>{})
  const advertiser=new MdnsAdvertiser()
  try{
    advertiser.start({serverId:'same-paired-server',name:'Momo',port:28080})
    assert.deepEqual([...sockets[0]!.packets[0]!.subarray(-4)],[192,168,137,1])
    address='192.168.31.130';tick()
    assert.equal(sockets[0]!.closed,true);assert.equal(sockets.length,2)
    assert.deepEqual([...sockets[1]!.packets[0]!.subarray(-4)],[192,168,31,130])
  }finally{advertiser.stop()}
})

test('mDNS follows hotspot address changes while an unrecognized /32 stays up', t => {
  class Socket extends EventEmitter {
    packet: Buffer = Buffer.alloc(0); selected = ''; closed = false
    bind(_port: number, callback: () => void) { callback() }
    setMulticastInterface(ip: string) { this.selected = ip }
    addMembership() {} setMulticastTTL() {}
    send(packet: Buffer) { this.packet = packet }
    close() { this.closed = true }
  }
  const sockets: Socket[] = []; let address = '10.28.113.197'; let tick = () => {}
  t.mock.method(dgram, 'createSocket', () => { const socket = new Socket(); sockets.push(socket); return socket })
  t.mock.method(os, 'networkInterfaces', () => ({
    custom: [{ family: 'IPv4', internal: false, address: '172.30.216.166', netmask: '255.255.255.255' }],
    WLAN: [{ family: 'IPv4', internal: false, address, netmask: '255.255.255.0' }]
  }))
  t.mock.method(globalThis, 'setInterval', (callback: () => void) => { tick = callback; return {} as NodeJS.Timeout })
  t.mock.method(globalThis, 'clearInterval', () => {})
  const advertiser = new MdnsAdvertiser()
  try {
    advertiser.start({ serverId: 'same-paired-server', name: 'Momo', port: 28080 })
    assert.equal(sockets[0]!.selected, '10.28.113.197')
    assert.deepEqual([...sockets[0]!.packet.subarray(-4)], [10, 28, 113, 197])
    address = '192.168.43.12'; tick()
    assert.equal(sockets[0]!.closed, true)
    assert.equal(sockets.length, 2)
    assert.equal(sockets[1]!.selected, '192.168.43.12')
    assert.deepEqual([...sockets[1]!.packet.subarray(-4)], [192, 168, 43, 12])
  } finally { advertiser.stop() }
})

test('mDNS ignores its own announcements and other responses, answers only valid queries', t => {
  class Socket extends EventEmitter {
    packets: Buffer[] = []
    bind(_port: number, callback: () => void) { callback() }
    setMulticastInterface() {}
    addMembership() {}
    setMulticastTTL() {}
    send(packet: Buffer) { this.packets.push(packet) }
    close() {}
  }
  const socket = new Socket()
  t.mock.method(dgram, 'createSocket', () => socket)
  t.mock.method(os, 'networkInterfaces', () => ({ fixture: [{ family: 'IPv4', internal: false, address: '192.168.1.10' }] }))
  const advertiser = new MdnsAdvertiser()
  try {
    advertiser.start({ serverId: 'test-server', name: 'NikkiSync', port: 28080 })
    assert.equal(socket.packets.length, 1)
    socket.emit('message', socket.packets[0])
    assert.equal(socket.packets.length, 1, 'own multicast reply must not trigger another multicast reply')
    const labels = ['_nikkisync', '_tcp', 'local'].flatMap(label => [Buffer.from([label.length]), Buffer.from(label)])
    const query = Buffer.concat([Buffer.alloc(12), ...labels, Buffer.from([0, 0, 12, 0, 1])])
    query.writeUInt16BE(1, 4)
    socket.emit('message', query)
    assert.equal(socket.packets.length, 2)
    const response = Buffer.from(query)
    response.writeUInt16BE(0x8000, 2)
    socket.emit('message', response)
    assert.equal(socket.packets.length, 2)
    socket.emit('message', Buffer.alloc(8))
    assert.equal(socket.packets.length, 2, 'short malformed packet is not a DNS query')
    const noQuestions = Buffer.from(query)
    noQuestions.writeUInt16BE(0, 4)
    socket.emit('message', noQuestions)
    assert.equal(socket.packets.length, 2)
    const unsupportedOpcode = Buffer.from(query)
    unsupportedOpcode.writeUInt16BE(0x0800, 2)
    socket.emit('message', unsupportedOpcode)
    assert.equal(socket.packets.length, 2)
  } finally { advertiser.stop() }
})
