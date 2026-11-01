import dgram from 'node:dgram'
import { listLanIpv4 } from './LanAddress.js'

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
  private readonly sockets = new Map<string, { socket: dgram.Socket; send(): void }>()
  private timer: NodeJS.Timeout | undefined
  private generation = 0

  start(input: { serverId: string; name: string; port: number }): void {
    this.stop()
    const generation = this.generation
    const refresh = () => {
      if (this.generation !== generation) return
      const addresses = new Set(listLanIpv4())
      for (const [ip, entry] of this.sockets) if (!addresses.has(ip)) this.retire(ip, entry.socket)
      for (const ip of addresses) {
        const entry = this.sockets.get(ip)
        if (entry) entry.send()
        else this.advertise(input, ip)
      }
    }
    // Keep retrying even if bind/membership fails before the listening callback.
    // A secondary Wi-Fi/hotspot must be discoverable while Ethernet stays up.
    this.timer = setInterval(refresh, 15_000)
    refresh()
  }

  private advertise(input: { serverId: string; name: string; port: number }, ip: string): void {
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
    let socket: dgram.Socket
    try { socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }) } catch { return }
    let listening = false
    const current = () => this.sockets.get(ip)?.socket === socket
    const send = () => {
      if (!current() || !listening) return
      try { socket.send(packet, PORT, MULTICAST, error => { if (error) this.retire(ip, socket) }) }
      catch { this.retire(ip, socket) }
    }
    this.sockets.set(ip, { socket, send })
    socket.on('error', () => this.retire(ip, socket))
    socket.on('message', (message) => {
      // Multicast loopback delivers our own announcements here. Responding to a
      // response creates an unbounded packet loop and can starve service startup.
      if (message.length < 12 || (message.readUInt16BE(2) & 0xf800) !== 0
        || message.readUInt16BE(4) === 0) return
      if (message.includes(Buffer.from('_nikkisync')) && message.includes(Buffer.from('_tcp'))) send()
    })
    try { socket.bind(PORT, () => {
      if (!current()) return
      try {
        socket.setMulticastInterface(ip)
        socket.addMembership(MULTICAST, ip)
        socket.setMulticastTTL(255)
        listening = true
        send()
      } catch { this.retire(ip, socket) }
    }) } catch { this.retire(ip, socket) }
  }

  private retire(ip: string, socket: dgram.Socket): void {
    if (this.sockets.get(ip)?.socket !== socket) return
    this.sockets.delete(ip)
    try { socket.close() } catch { /* a failed bind may already have closed it */ }
  }

  stop(): void {
    this.generation++
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    for (const [ip, entry] of this.sockets) this.retire(ip, entry.socket)
  }
}
