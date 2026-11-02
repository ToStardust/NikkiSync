import os from 'node:os'
import { isIPv4 } from 'node:net'

export interface LanInterfaceAddress {
  family: string | number
  internal: boolean
  address: string
  netmask?: string
  cidr?: string | null
}
export type LanInterfaces = Record<string, readonly LanInterfaceAddress[] | undefined>

// Names are hints, not a claim that every private 172.* or tunnel address is bad.
// In particular, Hyper-V external switches can carry the real LAN connection.
const isolated = /vEthernet.*(?:Default Switch|WSL|Docker|Internal|\bNAT\b|默认|内部)|VMware.*VMnet[18]\b|VirtualBox.*Host.Only|DockerNAT/i
const virtual = /vEthernet|VMware|VirtualBox|Hyper.V|WSL|Docker|Clash|Mihomo|^Meta$|Tailscale|WireGuard|OpenVPN|ZeroTier|Radmin|VPN|\bTUN\b|\bTAP\b|^utun\d*$/i

/** Prefer a usable real LAN over retained host-only/VPN interfaces. No network settings are changed. */
export function selectLanIpv4(interfaces: LanInterfaces = os.networkInterfaces()): string | undefined {
  return listLanIpv4(interfaces)[0]
}

/** Only this computer's assigned addresses, never a subnet scan. */
export function listLanIpv4(interfaces: LanInterfaces = os.networkInterfaces()): string[] {
  const candidates = Object.entries(interfaces).flatMap(([name, entries]) => {
    if (isolated.test(name)) return []
    return (entries ?? []).filter(entry => {
      if ((entry.family !== 'IPv4' && entry.family !== 4) || entry.internal || !isIPv4(entry.address)) return false
      const [first, second] = entry.address.split('.').map(Number)
      return first !== 0 && first !== 127 && first! < 224 && !(first === 169 && second === 254)
    }).map(entry => {
      const [first, second] = entry.address.split('.').map(Number)
      const privateAddress = first === 10 || (first === 192 && second === 168)
        || (first === 172 && second !== undefined && second >= 16 && second <= 31)
      // Unknown/renamed tunnel interfaces can evade the name hints above. A /32
      // describes only this host, so prefer a shared subnet for phone pairing.
      // Keep /32 as a fallback: intentionally routed VPNs can still be usable.
      const singleHostPrefix = entry.netmask === '255.255.255.255' || entry.cidr === `${entry.address}/32`
      return { address: entry.address, rank: (singleHostPrefix ? 20 : 0)
        + (virtual.test(name) ? 10 : 0) + (privateAddress ? 0 : 1) }
    })
  })
  return [...new Set(candidates.sort((a, b) => a.rank - b.rank).map(candidate => candidate.address))].slice(0, 8)
}
