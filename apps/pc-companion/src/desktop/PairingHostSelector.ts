export interface NetworkAddressLike {
  address: string
  family: string | number
  internal: boolean
}

export type NetworkInterfacesLike = Record<string, readonly NetworkAddressLike[] | undefined>

const VIRTUAL_ADAPTER = /(?:vethernet|hyper-v|wsl|vmware|virtualbox|tailscale|zerotier|hamachi|wireguard|openvpn|\bvpn\b|loopback|npcap)/i
const PHYSICAL_ADAPTER = /(?:wi-?fi|wlan|wireless|ethernet|以太网|无线)/i

function isIpv4(entry: NetworkAddressLike): boolean {
  return entry.family === 'IPv4' || entry.family === 4
}

function isLinkLocal(address: string): boolean {
  return address.startsWith('169.254.')
}

function isRfc1918(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false
  const [first, second] = parts
  return first === 10
    || (first === 192 && second === 168)
    || (first === 172 && second !== undefined && second >= 16 && second <= 31)
}

interface Candidate {
  address: string
  virtual: boolean
  physical: boolean
  privateLan: boolean
  order: number
}

/**
 * Chooses the address embedded in pairing QR payloads.
 *
 * Windows commonly exposes WSL/Hyper-V/VPN adapters before the real Wi-Fi/Ethernet
 * adapter. A phone cannot normally route to those host-only networks, so prefer a
 * physical RFC1918 interface and retain virtual/private addresses only as fallback.
 */
export function selectPairingHost(interfaces: NetworkInterfacesLike): string | undefined {
  const candidates: Candidate[] = []
  let order = 0

  for (const [name, entries] of Object.entries(interfaces)) {
    const virtual = VIRTUAL_ADAPTER.test(name)
    const physical = PHYSICAL_ADAPTER.test(name) && !virtual
    for (const entry of entries ?? []) {
      if (!isIpv4(entry) || entry.internal || isLinkLocal(entry.address)) continue
      candidates.push({
        address: entry.address,
        virtual,
        physical,
        privateLan: isRfc1918(entry.address),
        order: order++
      })
    }
  }

  candidates.sort((left, right) => {
    const rank = (candidate: Candidate): number => {
      if (candidate.privateLan && candidate.physical) return 0
      if (candidate.privateLan && !candidate.virtual) return 1
      if (candidate.privateLan) return 2
      if (!candidate.virtual && candidate.physical) return 3
      if (!candidate.virtual) return 4
      return 5
    }
    return rank(left) - rank(right) || left.order - right.order
  })

  return candidates[0]?.address
}
