import dgram from 'node:dgram'
import { selectLanIpv4 } from './LanAddress.js'

const MULTICAST = '224.0.0.251'
const PORT = 5353

function dnsName(name: string): Buffer {
  const parts = name.split('.').filter(Boolean)
  return Buffer.concat([...parts.map((part) => Buffer.concat([Buffer.from([Buffer.byteLength(part)]), Buffer.from(part)])), Buffer.from([0])])
}

function rr(name: string, type: number, data: Buffer, ttl = 120): Buffer {
  const head = Buffer.alloc(10)
  head.writeUInt16BE(type, 0)
  head.writeUInt16BE(0x8001, 2)
  head.writeUInt32BE(ttl, 4)
  head.writeUInt16BE(data.length, 8)
  return Buffer.concat([dnsName(name), head, data])
}

function txt(...values: string[]): Buffer {
  return Buffer.concat(values.map((value) => {
    const data = Buffer.from(value, 'utf8')
    return Buffer.concat([Buffer.from([Math.min(data.length, 255)]), data.subarray(0, 255)])
  }))
}

export class MdnsAdvertiser {
  private socket: dgram.Socket | undefined
  private timer: NodeJS.Timeout | undefined

  start(input: { serverId: string; name: string; port: number }): void {
    this.stop()
    const ip = selectLanIpv4()
    if (!ip) { this.timer = setTimeout(() => this.start(input), 10_000); return }
    const service = '_nikkisync._tcp.local'
    const safeName = input.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'NikkiSync'
    const instance = `${safeName}.${service}`
    const host = `${input.serverId.replace(/[^a-zA-Z0-9-]/g, '')}.local`
    const ptr = rr(service, 12, dnsName(instance))
    const srvData = Buffer.alloc(6)
    srvData.writeUInt16BE(0, 0); srvData.writeUInt16BE(0, 2); srvData.writeUInt16BE(input.port, 4)
    const srv = rr(instance, 33, Buffer.concat([srvData, dnsName(host)]))
    const txtRecord = rr(instance, 16, txt(`serverId=${input.serverId}`, 'protocol=1', `port=${input.port}`))
    const addr = Buffer.from(ip.split('.').map(Number))
    const a = rr(host, 1, addr)
    const header = Buffer.alloc(12)
    header.writeUInt16BE(0x8400, 2)
    header.writeUInt16BE(4, 6)
    const packet = Buffer.concat([header, ptr, srv, txtRecord, a])
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.socket = socket
    socket.on('error', () => undefined)
    const send = () => { if (this.socket === socket) socket.send(packet, PORT, MULTICAST, () => undefined) }
    socket.on('message', (message) => {
      // Multicast loopback delivers our own announcements here. Responding to a
      // response creates an unbounded packet loop and can starve service startup.
      if (message.length < 12 || (message.readUInt16BE(2) & 0xf800) !== 0
        || message.readUInt16BE(4) === 0) return
      if (message.includes(Buffer.from('_nikkisync')) && message.includes(Buffer.from('_tcp'))) send()
    })
    socket.bind(PORT, () => {
      if (this.socket !== socket) return
      try {
        socket.setMulticastInterface(ip)
        socket.addMembership(MULTICAST, ip)
      } catch { /* another mDNS daemon may own membership */ }
      socket.setMulticastTTL(255)
      send(); this.timer = setInterval(() => {
        if (this.socket !== socket) return
        if (selectLanIpv4() !== ip) this.start(input)
        else send()
      }, 15_000)
    })
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.socket?.close()
    this.socket = undefined
  }
}
