import { describe, it, expect } from 'vitest';
import { parseAddress, isIPv4, isIPv6, isIPAddress, DEFAULT_PORT } from '../address-resolver';

/**
 * Address parsing is the first thing that happens when someone joins a
 * workspace, and it had no tests. A wrong answer here does not surface as a
 * parse error — it surfaces as a connection that times out against an address
 * the user never typed, which is a much worse thing to debug.
 */
describe('isIPv4', () => {
  it('accepts dotted quads in range', () => {
    expect(isIPv4('127.0.0.1')).toBe(true);
    expect(isIPv4('255.255.255.255')).toBe(true);
  });

  it('rejects octets out of range and malformed quads', () => {
    expect(isIPv4('256.0.0.1')).toBe(false);
    expect(isIPv4('1.2.3')).toBe(false);
    expect(isIPv4('1.2.3.4.5')).toBe(false);
    expect(isIPv4('example.com')).toBe(false);
  });
});

describe('isIPv6', () => {
  it('accepts the forms people actually type', () => {
    expect(isIPv6('::1')).toBe(true);
    expect(isIPv6('::')).toBe(true);
    expect(isIPv6('2001:db8:0:0:0:0:2:1')).toBe(true);
  });

  it('does not mistake a hostname for an address', () => {
    expect(isIPv6('example.com')).toBe(false);
    expect(isIPAddress('example.com')).toBe(false);
    expect(isIPAddress('127.0.0.1')).toBe(true);
  });
});

describe('parseAddress', () => {
  it('reads a bare host with no port', () => {
    expect(parseAddress('example.com')).toEqual({ host: 'example.com', port: null });
    expect(parseAddress('127.0.0.1')).toEqual({ host: '127.0.0.1', port: null });
  });

  it('reads host and port', () => {
    expect(parseAddress('example.com:12349')).toEqual({ host: 'example.com', port: 12349 });
    expect(parseAddress('127.0.0.1:8080')).toEqual({ host: '127.0.0.1', port: 8080 });
  });

  it('treats a bare IPv6 address as a host, not a host:port', () => {
    // The colons are part of the address; splitting on the last one would take
    // the final group as a port number and connect somewhere arbitrary.
    expect(parseAddress('::1')).toEqual({ host: '::1', port: null });
    expect(parseAddress('2001:db8::2:1')).toEqual({ host: '2001:db8::2:1', port: null });
  });

  it('reads a bracketed IPv6 address with and without a port', () => {
    expect(parseAddress('[::1]')).toEqual({ host: '::1', port: null });
    expect(parseAddress('[::1]:12349')).toEqual({ host: '::1', port: 12349 });
  });

  it('rejects a bracketed address that is not closed', () => {
    expect(() => parseAddress('[::1')).toThrow(/Invalid IPv6/);
  });

  it('rejects an empty port rather than guessing', () => {
    expect(() => parseAddress('example.com:')).toThrow(/Invalid port/);
  });

  it('rejects a port with trailing rubbish', () => {
    // parseInt('12349abc', 10) is 12349, so without an explicit check this
    // silently connects to a port the user did not type.
    expect(() => parseAddress('example.com:12349abc')).toThrow(/Invalid port/);
  });

  it('tolerates whitespace around the port', () => {
    // parseInt used to accept this, and it has exactly one sensible reading, so
    // tightening the parser should not turn it into an error.
    expect(parseAddress('example.com: 12349')).toEqual({ host: 'example.com', port: 12349 });
  });

  it('rejects a port outside the valid range', () => {
    expect(() => parseAddress('example.com:0')).toThrow(/Invalid port/);
    expect(() => parseAddress('example.com:65536')).toThrow(/Invalid port/);
    expect(() => parseAddress('example.com:-1')).toThrow(/Invalid port/);
  });

  it('has a default port to fall back on', () => {
    expect(typeof DEFAULT_PORT).toBe('number');
    expect(DEFAULT_PORT).toBeGreaterThan(0);
  });
});
