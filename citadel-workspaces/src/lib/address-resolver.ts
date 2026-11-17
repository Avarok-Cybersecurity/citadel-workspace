import { debugLog } from '@/lib/debug-config';
import { DEFAULT_WORKSPACE_PORT, isTenantHost, isWebSocketUrl } from './workspace-address';
/**
 * Address Resolver
 *
 * Resolves server addresses for Connect/Register commands.
 * - If address is already IPv4 or IPv6, returns as-is
 * - If address is a hostname, resolves via DNS
 * - Default port is DEFAULT_WORKSPACE_PORT (workspace-address.ts) if not specified: the one
 *   default, so an address compares (same-server.ts) as Register sends it. This file used to
 *   assume 12349 while the address field assumed 12400.
 */

const DEFAULT_PORT: number = DEFAULT_WORKSPACE_PORT;

// IPv4 regex: matches 0-255 in each octet
const IPV4_REGEX: RegExp = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

// IPv6 regex: simplified pattern that matches common IPv6 formats
const IPV6_REGEX: RegExp = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}$|^(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}$|^(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}$|^:(?::[0-9a-fA-F]{1,4}){1,7}$|^::$|^\[(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\]$/;

/**
 * Check if a string is a valid IPv4 address
 */
function isIPv4(address: string): boolean {
  return IPV4_REGEX.test(address);
}

/**
 * Check if a string is a valid IPv6 address
 * Handles both bare and bracketed formats
 */
function isIPv6(address: string): boolean {
  // Remove brackets if present
  const cleaned: string = address.startsWith('[') && address.endsWith(']')
    ? address.slice(1, -1)
    : address;
  return IPV6_REGEX.test(cleaned) || IPV6_REGEX.test(`[${cleaned}]`);
}

/**
 * Check if a string is an IP address (IPv4 or IPv6)
 */
function isIPAddress(address: string): boolean {
  return isIPv4(address) || isIPv6(address);
}

/**
 * Parse address into host and port components
 * Handles:
 * - hostname
 * - hostname:port
 * - IPv4
 * - IPv4:port
 * - [IPv6]
 * - [IPv6]:port
 */
/**
 * Parse the port half of an address, strictly.
 *
 * parseInt is too forgiving for this: parseInt('12349abc', 10) is 12349, so a
 * typo used to be accepted silently and the client connected to a port the user
 * never typed. That does not surface as a parse error — it surfaces as a
 * connection timing out against an address nobody entered, which is a far worse
 * thing to debug. Out-of-range values had the same problem.
 */
function parsePort(rawPort: string, address: string): number {
  // Surrounding whitespace is unambiguous, and parseInt used to tolerate it —
  // rejecting "host: 12349" would be a regression for a typo that has exactly
  // one sensible reading. Anything else is genuinely ambiguous and refused.
  const portStr: string = rawPort.trim();

  if (!/^\d+$/.test(portStr)) {
    throw new Error(`Invalid port in address: ${address}`);
  }
  const port: number = Number(portStr);
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid port in address: ${address} (must be 1-65535)`);
  }
  return port;
}

function parseAddress(address: string): { host: string; port: number | null } {
  // Handle IPv6 with brackets: [::1] or [::1]:port
  if (address.startsWith('[')) {
    const closeBracket: number = address.indexOf(']');
    if (closeBracket === -1) {
      throw new Error(`Invalid IPv6 address format: ${address}`);
    }
    const host: string = address.slice(1, closeBracket);
    const afterBracket: string = address.slice(closeBracket + 1);

    if (afterBracket === '') {
      return { host, port: null };
    } else if (afterBracket.startsWith(':')) {
      return { host, port: parsePort(afterBracket.slice(1), address) };
    } else {
      throw new Error(`Invalid IPv6 address format: ${address}`);
    }
  }

  // Handle IPv4 or hostname with optional port
  const lastColon: number = address.lastIndexOf(':');

  // No colon = no port
  if (lastColon === -1) {
    return { host: address, port: null };
  }

  // Check if it's IPv6 without brackets (multiple colons)
  const colonCount: number = (address.match(/:/g) || []).length;
  if (colonCount > 1) {
    // Bare IPv6 address without port
    return { host: address, port: null };
  }

  // Single colon = IPv4:port or hostname:port
  const host: string = address.slice(0, lastColon);
  return { host, port: parsePort(address.slice(lastColon + 1), address) };
}

// `LOCAL_HOSTNAMES` lived here, mapping localhost -> 127.0.0.1 for the
// browser-side resolver. The agent resolves names now, and `localhost` is one
// its own resolver handles, so the table has nothing left to do.


/**
 * Resolve a server address for Connect/Register commands.
 *
 * @param serverAddr - The original server address (hostname, hostname:port, IP, IP:port)
 * @returns The resolved address in IP:port format
 * @throws Error if DNS resolution fails
 *
 * Examples:
 *   "example.com" -> "example.com:12400"
 *   "example.com:8080" -> "93.184.216.34:8080"
 *   "192.168.1.1" -> "192.168.1.1:12400"
 *   "192.168.1.1:8080" -> "192.168.1.1:8080"
 *   "localhost:12349" -> DNS resolved IP:12349
 */
export async function resolveServerAddress(serverAddr: string): Promise<string> {
  const trimmed: string = serverAddr.trim();

  if (!trimmed) {
    throw new Error('Server address cannot be empty');
  }

  // Named by the agent itself, so passed through untouched: a WebSocket URL is dialled as
  // given, and a bare hosted-workspace host becomes `wss://<host>/` there
  // (server_address.rs). Appending the socket port made the agent dial the Cloudflare edge
  // over raw TCP on 12349, so joining a hosted workspace by its address never connected.
  if (isWebSocketUrl(trimmed) || isTenantHost(trimmed)) {
    debugLog('AddressResolver', `Address resolver: ${serverAddr} -> ${trimmed} (the agent dials it as named)`);
    return trimmed;
  }

  const { host, port } = parseAddress(trimmed);
  const effectivePort: number = port ?? DEFAULT_PORT;

  // If already an IP address, return with port
  if (isIPAddress(host)) {
    const result: string = isIPv6(host) ? `[${host}]:${effectivePort}` : `${host}:${effectivePort}`;
    debugLog('AddressResolver', `Address resolver: ${serverAddr} -> ${result} (already IP)`);
    return result;
  }

  // A hostname is passed THROUGH, with its port normalised. The agent resolves
  // it.
  //
  // This used to fetch `https://dns.google/resolve`. A hosted UI's own
  // Content-Security-Policy refuses that connection -- `connect-src` lists the
  // page's origin and the loopback agent, and nothing else -- so on
  // work.avarok.net every hostname address failed with a 30-second
  // "Registration timed out" while a raw IP worked. Where the fetch did
  // succeed, it told Google which server each user was joining.
  //
  // The agent has a resolver and no CSP, and `Register.server_addr` is a
  // string on the wire, so nothing else changes.
  const result: string = `${host}:${effectivePort}`;
  debugLog('AddressResolver', `Address resolver: ${serverAddr} -> ${result} (hostname; the agent resolves it)`);
  return result;
}

// Export for testing
export { isIPv4, isIPv6, isIPAddress, parseAddress, DEFAULT_PORT };
