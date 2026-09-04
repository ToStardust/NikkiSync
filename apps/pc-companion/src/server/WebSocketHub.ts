import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { WsEvent } from '@nikkisync/protocol'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function textFrame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8')
  if (data.length < 126) return Buffer.concat([Buffer.from([0x81, data.length]), data])
  if (data.length <= 0xffff) {
    const head = Buffer.alloc(4)
    head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2)
    return Buffer.concat([head, data])
  }
  const head = Buffer.alloc(10)
  head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2)
  return Buffer.concat([head, data])
}

function closeFrame(): Buffer { return Buffer.from([0x88, 0x00]) }

export class WebSocketHub {
  private readonly sockets = new Set<Duplex>()

  upgrade(req: IncomingMessage, socket: Duplex): boolean {
    const key = req.headers['sec-websocket-key']
    const version = req.headers['sec-websocket-version']
    if (typeof key !== 'string' || version !== '13') return false
    const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64')
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n'
    ].join('\r\n'))
    this.sockets.add(socket)
    socket.on('close', () => this.sockets.delete(socket))
    socket.on('error', () => this.sockets.delete(socket))
    socket.on('data', (chunk) => this.handleClientFrame(socket, chunk))
    return true
  }

  send(socket: Duplex, event: WsEvent): void {
    if (!socket.destroyed) socket.write(textFrame(JSON.stringify(event)))
  }

  broadcast(event: WsEvent): void {
    const frame = textFrame(JSON.stringify(event))
    for (const socket of this.sockets) if (!socket.destroyed) socket.write(frame)
  }

  close(): void {
    for (const socket of this.sockets) {
      if (!socket.destroyed) { socket.write(closeFrame()); socket.end() }
    }
    this.sockets.clear()
  }

  private handleClientFrame(socket: Duplex, chunk: Buffer): void {
    if (chunk.length < 2) return
    const opcode = chunk[0]! & 0x0f
    if (opcode === 0x8) { socket.write(closeFrame()); socket.end(); return }
    if (opcode === 0x9) {
      const masked = Boolean(chunk[1]! & 0x80)
      let length = chunk[1]! & 0x7f
      let offset = 2
      if (length === 126 && chunk.length >= 4) { length = chunk.readUInt16BE(2); offset = 4 }
      if (length === 127) return
      let payload = chunk.subarray(offset + (masked ? 4 : 0), offset + (masked ? 4 : 0) + length)
      if (masked && chunk.length >= offset + 4 + length) {
        const mask = chunk.subarray(offset, offset + 4)
        payload = Buffer.from(payload)
        for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!
      }
      socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]))
    }
  }
}
