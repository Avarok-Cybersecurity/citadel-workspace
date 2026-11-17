/**
 * Debug formatter utilities to prevent large byte arrays from polluting console logs
 * Mirrors the Rust debug formatting logic for bytes and maps
 */

const SAMPLE_ENDS_COUNT: number = 5;

/**
 * Format byte arrays for debug output, showing only first and last few bytes
 */
// Named for what it does. It shared a name with the byte-SIZE formatter while
// formatting byte ARRAYS for debug output -- two unrelated jobs, one grep.
function formatByteArray(bytes: number[] | Uint8Array): string {
  const len: number = bytes.length;
  if (len <= SAMPLE_ENDS_COUNT * 2) {
    return `{BytesLike(len: ${len}, values: [${Array.from(bytes).join(', ')}])}`;
  }
  
  const first: number[] = Array.from(bytes).slice(0, SAMPLE_ENDS_COUNT);
  const last: number[] = Array.from(bytes).slice(-SAMPLE_ENDS_COUNT);
  
  return `{BytesLike(len: ${len}, First ${SAMPLE_ENDS_COUNT} bytes: [${first.join(', ')}], Last ${SAMPLE_ENDS_COUNT} bytes: [${last.join(', ')}])}`;
}

/**
 * Format maps with byte array values for debug output
 */
function formatBytesMap(map: Record<string, number[] | Uint8Array>): string {
  const entries: string[] = Object.entries(map).map(([key, value]) => {
    return `(K: ${key}, V: ${formatByteArray(value)})`;
  });
  
  return `{MapLike: ${entries.join(', ')}}`;
}

/**
 * Recursively format an object for debug output, replacing byte arrays with formatted strings
 */
export function formatForDebug(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  // Handle BigInt values by converting to string
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    // Check if it's a byte array (all elements are numbers 0-255)
    if (obj.length > 0 && obj.every(v => typeof v === 'number' && v >= 0 && v <= 255)) {
      return formatByteArray(obj);
    }
    return obj.map(item => formatForDebug(item));
  }

  if (typeof obj === 'string') {
    // Try converting to json map
    try {
      const json: unknown = JSON.parse(obj);
      obj = json;
    } catch {
      return obj;
    }
  }
  
  // Handle objects
  if (typeof obj === 'object' && obj !== null) {
    const formatted: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Secrets first, and on the NAME alone.
      //
      // Redaction used to happen only inside shouldFormatAsBytes, which starts
      // `if (!Array.isArray(value)) return false` — so a password that is a
      // STRING fell through to the recursive branch and was printed verbatim.
      // StoredSession.password is a string, and it is logged on every session
      // write: auth success, auto-reconnect, logout, role update, active-index
      // change. `serverPassword` was in no list at all, so it was never
      // redacted anywhere.
      //
      // Whether a secret is safe to print must not depend on how it happens to
      // be encoded at the moment.
      if (isSecretField(key)) {
        formatted[key] = value === undefined || value === null ? value : '<redacted>';
      }
      // Special handling for known byte fields
      else if (shouldFormatAsBytes(key, value)) {
        formatted[key] = formatByteArray(value as number[]);
      }
      // Special handling for known map fields with byte values
      else if (shouldFormatAsBytesMap(key, value)) {
        formatted[key] = formatBytesMap(value as Record<string, number[]>);
      }
      // Recursively format other fields
      else {
        formatted[key] = formatForDebug(value);
      }
    }
    
    return formatted;
  }
  
  return obj;
}

/**
 * Field names whose VALUE must never reach a log, whatever its type.
 *
 * Matched case-insensitively on the whole name, plus a suffix rule so
 * `serverPassword`, `proposed_password` and `workspace_master_password` are
 * covered without having to enumerate every variant someone adds later. A new
 * credential field should be redacted by default rather than by remembering to
 * add it here.
 */
const SECRET_FIELD_PATTERN: RegExp = /^(pass(word|phrase)|secret|token|psk|credential)$|pass(word|phrase)$|^.*_?secret$/i;

export function isSecretField(fieldName: string): boolean {
  return SECRET_FIELD_PATTERN.test(fieldName);
}

/**
 * Check if a field should be formatted as bytes based on its name and value
 */
function shouldFormatAsBytes(fieldName: string, value: unknown): boolean {
  // Check if it's an array of numbers
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }

  // Known byte fields from Rust structs
  const byteFields: string[] = [
    'value',      // LocalDBGetKVSuccess, LocalDBSetKV
    'message',    // GroupMessageNotification, Message, GroupMessage
    'password',   // Connect
    'proposed_password', // Register
    'metadata',   // Workspace types: Workspace, Office, Room
    'contents',   // SendMessage in workspace protocol
  ];

  // Check if field name matches and all elements are byte values
  return byteFields.includes(fieldName) &&
         value.every((v: unknown) => typeof v === 'number' && v >= 0 && v <= 255);
}

/**
 * Check if a field should be formatted as a map of bytes
 */
function shouldFormatAsBytesMap(fieldName: string, value: unknown): boolean {
  // Check if it's an object
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  // Known map fields from Rust structs
  if (fieldName !== 'map') {
    return false;
  }

  // Check if all values in the map are byte arrays
  for (const val of Object.values(value)) {
    if (!Array.isArray(val) || !val.every((v: unknown) => typeof v === 'number' && v >= 0 && v <= 255)) {
      return false;
    }
  }

  return true;
}