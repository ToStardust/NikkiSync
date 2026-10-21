import assert from 'node:assert/strict'
import test from 'node:test'
import { selectLanIpv4 } from '../src/server/LanAddress.js'

const ip = (address: string) => ({ family: 'IPv4', internal: false, address })

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
