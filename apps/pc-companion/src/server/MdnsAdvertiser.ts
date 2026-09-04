import dgram from 'node:dgram'
import os from 'node:os'

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

function isLanIpv4(address: string): boolean {
  const [first, second] = address.split('.').map(Number)
  return first === 10
    || (first === 192 && second === 168)
    || (first === 172 && second !== undefined && second >= 16 && second <= 31)
}

function preferredLanIpv4(): string | undefined {
  const candidates = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
  return candidates.find(isLanIpv4) ?? candidates[0]
}

export class MdnsAdvertiser {
  private socket: dgram.Socket | undefined
  private timer: NodeJS.Timeout | undefined

  start(input: { serverId: string; name: string; port: number }): void {
    this.stop()
    const ip = preferredLanIpv4()
    if (!ip) return
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
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.socket.on('error', () => undefined)
    const send = () => this.socket?.send(packet, PORT, MULTICAST, () => undefined)
    this.socket.on('message', (message) => {
      if (message.includes(Buffer.from('_nikkisync')) && message.includes(Buffer.from('_tcp'))) send()
    })
    this.socket.bind(PORT, () => {
      try {
        this.socket?.setMulticastInterface(ip)
        this.socket?.addMembership(MULTICAST, ip)
      } catch { /* another mDNS daemon may own membership */ }
      this.socket?.setMulticastTTL(255)
      send(); this.timer = setInterval(send, 30_000)
    })
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.socket?.close()
    this.socket = undefined
  }
}
