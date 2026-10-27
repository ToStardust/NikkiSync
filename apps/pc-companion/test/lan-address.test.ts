import assert from 'node:assert/strict'
import test from 'node:test'
import { selectLanIpv4, listLanIpv4 } from '../src/server/LanAddress.js'

const ip = (address: string, network: { netmask?: string; cidr?: string | null } = {}) =>
  ({ family: 'IPv4', internal: false, address, ...network })

test('candidate list is ranked, bounded, deduplicated and limited to usable assigned addresses', () => {
  const candidates=listLanIpv4({
    unknown:[ip('172.30.216.166',{netmask:'255.255.255.255'})],
    WLAN:[ip('10.28.113.197',{netmask:'255.255.255.0'}),ip('10.28.113.197')],
    'vEthernet (Default Switch)':[ip('192.168.5.1')],
    extra:Array.from({length:20},(_,i)=>ip(`192.168.1.${i+1}`)),
    ignored:[ip('169.254.1.2'),ip('127.0.0.1')]
  })
  assert.equal(candidates[0],'10.28.113.197');assert.equal(candidates.length,8)
  assert.equal(new Set(candidates).size,8)
  assert.ok(!candidates.includes('192.168.5.1'))
})

test('an unrecognized /32 interface does not outrank the phone hotspot subnet', () => {
  assert.equal(selectLanIpv4({
    'unrecognized interface': [ip('172.30.216.166', { netmask: '255.255.255.255' })],
    WLAN: [ip('10.28.113.197', { netmask: '255.255.255.0' })]
  }), '10.28.113.197')
})

test('CIDR-only /32 information also yields to a shared subnet with an unknown name', () => {
  assert.equal(selectLanIpv4({
    first: [ip('172.30.216.166', { cidr: '172.30.216.166/32' })],
    second: [ip('192.168.43.12', { cidr: '192.168.43.12/24' })]
  }), '192.168.43.12')
})

test('a real 172 subnet and an external switch remain preferable to an unknown /32', () => {
  assert.equal(selectLanIpv4({
    first: [ip('10.10.10.2', { netmask: '255.255.255.255' })],
    'vEthernet (External Switch)': [ip('172.25.9.238', { netmask: '255.255.255.0' })]
  }), '172.25.9.238')
})

test('routed /32 interfaces remain available when no shared subnet is present', () => {
  assert.equal(selectLanIpv4({
    custom: [ip('172.30.216.166', { netmask: '255.255.255.255', cidr: '172.30.216.166/32' })]
  }), '172.30.216.166')
  assert.equal(selectLanIpv4({
    WireGuard: [ip('10.10.10.2', { netmask: '255.255.255.255' })]
  }), '10.10.10.2')
})

test('a /31 link is preserved and unrelated CIDR text is not treated as this address prefix', () => {
  assert.equal(selectLanIpv4({
    first: [ip('172.30.216.166', { netmask: '255.255.255.255' })],
    second: [ip('10.10.10.2', { netmask: '255.255.255.254' })]
  }), '10.10.10.2')
  assert.equal(selectLanIpv4({
    first: [ip('192.168.1.8', { cidr: 'not-this-address/32' })],
    second: [ip('192.168.1.9', { netmask: '255.255.255.0' })]
  }), '192.168.1.8')
})

test('pairing does not advertise Hyper-V before the real Wi-Fi address', () => {
  assert.equal(selectLanIpv4({
    'vEthernet (Default Switch)': [ip('172.25.9.238')],
    'WLAN': [ip('10.1.4.35')]
  }), '10.1.4.35')
})

test('VPN and virtual adapters do not outrank an unknown real adapter name', () => {
  for (const virtual of ['VMware Network Adapter VMnet8', 'VirtualBox Host-Only Network', 'Clash', 'Mihomo', 'Meta', 'Tailscale', 'WireGuard', 'OpenVPN', 'ZeroTier', 'Radmin VPN', 'TAP-Windows Adapter V9']) {
    assert.equal(selectLanIpv4({ [virtual]: [ip('172.25.9.238')], 'custom adapter': [ip('10.1.4.35')] }), '10.1.4.35', virtual)
  }
})

test('a legitimate physical 172.25 LAN remains eligible', () => {
  assert.equal(selectLanIpv4({ 'Ethernet': [ip('172.25.9.238')] }), '172.25.9.238')
})

test('an external Hyper-V switch can still be the real LAN and is not banned by its prefix', () => {
  assert.equal(selectLanIpv4({ 'vEthernet (External Switch)': [ip('172.25.9.238')] }), '172.25.9.238')
})

test('an explicitly virtual-only adapter is not silently made the pairing endpoint', () => {
  assert.equal(selectLanIpv4({ 'vEthernet (Default Switch)': [ip('172.25.9.238')] }), undefined)
})

test('loopback, link-local, unspecified and IPv6 are not usable IPv4 pairing hosts', () => {
  assert.equal(selectLanIpv4({ fixture: [
    { family: 'IPv4', internal: true, address: '127.0.0.1' }, ip('169.254.1.2'), ip('0.0.0.0'),
    { family: 'IPv6', internal: false, address: 'fe80::1' }, ip('224.0.0.251'), ip('255.255.255.255')
  ] }), undefined)
})

test('private address preference and enumeration stability are retained among real adapters', () => {
  assert.equal(selectLanIpv4({ 'first': [ip('203.0.113.2')], 'second': [ip('10.1.4.35')], 'third': [ip('192.168.1.8')] }), '10.1.4.35')
  assert.equal(selectLanIpv4({ Ethernet: [ip('203.0.113.2')] }), '203.0.113.2')
})
