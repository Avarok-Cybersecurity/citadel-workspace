import { formatForDebug } from './debug-formatter';
import { eventEmitter } from './event-emitter';
import { debugLog } from '@/lib/debug-config';

declare global {
  interface Window {
    wasmDebugLog: (logStr: string) => void;
    onWasmWebSocketDisconnected: (reason: string) => void;
  }
}

/**
 * Parses a string that may contain mixed text and JSON objects.
 * Extracts JSON objects, formats them with formatForDebug, and reconstructs the string.
 * 
 * @param input - The input string that may contain text and JSON objects
 * @returns The reconstructed string with formatted JSON objects
 */
export function parseAndFormatMixedContent(input: unknown): string {
  // If input is not a string, format it directly
  if (typeof input !== 'string') {
    const formatted: unknown = formatForDebug(input);
    return typeof formatted === 'string' ? formatted : JSON.stringify(formatted);
  }
  
  // First, check if the entire string is valid JSON
  try {
    const parsed: unknown = JSON.parse(input);
    const formatted: unknown = formatForDebug(parsed);
    return typeof formatted === 'string' ? formatted : JSON.stringify(formatted);
  } catch {
    // Not valid JSON as a whole, continue with mixed parsing
  }
  
  // More robust regex to match JSON objects and arrays
  // This handles nested structures better
  const jsonRegex: RegExp = /(\{(?:[^{}]|(?:\{[^{}]*\})|(?:\[[^\[\]]*\]))*\})|(\[(?:[^\[\]]|(?:\{[^{}]*\})|(?:\[[^\[\]]*\]))*\])/g;
  
  // Track the parts of the string and their positions
  const parts: Array<{type: 'text' | 'json', content: string, start: number, end: number}> = [];
  let lastIndex: number = 0;
  
  // Find all JSON matches
  const matches: RegExpExecArray[] = Array.from(input.matchAll(jsonRegex));
  
  for (const match of matches) {
    const jsonStr: string = match[0];
    const startIndex: number = match.index!;
    
    // Add any text before this JSON object
    if (startIndex > lastIndex) {
      parts.push({
        type: 'text',
        content: input.substring(lastIndex, startIndex),
        start: lastIndex,
        end: startIndex
      });
    }
    
    // Try to parse the JSON to validate it
    try {
      JSON.parse(jsonStr); // Just validate, we'll parse again when formatting
      // It's valid JSON, add it as a JSON part
      parts.push({
        type: 'json',
        content: jsonStr,
        start: startIndex,
        end: startIndex + jsonStr.length
      });
      lastIndex = startIndex + jsonStr.length;
    } catch {
      // Not valid JSON, treat it as text
      // Don't update lastIndex, let it be captured as text in next iteration
    }
  }
  
  // Add any remaining text after the last JSON object
  if (lastIndex < input.length) {
    parts.push({
      type: 'text',
      content: input.substring(lastIndex),
      start: lastIndex,
      end: input.length
    });
  }
  
  // If no parts were found, the entire string is text
  if (parts.length === 0) {
    return input;
  }
  
  // Sort parts by their start position to maintain order
  parts.sort((a, b) => a.start - b.start);
  
  // Reconstruct the string with formatted JSON parts
  return parts.map(part => {
    if (part.type === 'json') {
      try {
        const parsed: unknown = JSON.parse(part.content);
        // formatForDebug returns the formatted object, we need to stringify it
        const formatted: unknown = formatForDebug(parsed);
        return typeof formatted === 'string' ? formatted : JSON.stringify(formatted);
      } catch {
        // If parsing fails somehow, return the original content
        return part.content;
      }
    } else {
      return part.content;
    }
  }).join('');
}

/**
 * Set up the global wasmDebugLog function that the WASM module can call
 * This bridges the WASM debug logs to use our TypeScript debug formatter
 */
export function setupWasmDebugBridge(): void {
  // Make the debug log function available globally for WASM to call
  window.wasmDebugLog = (logStr: string): void => {
    try {
      const mappedLog: string = parseAndFormatMixedContent(logStr);
      debugLog('WasmDebugBridge', "sanitized log: " + mappedLog);
    } catch (_error) {
      // If any error occurs, just log the original string
      debugLog('WasmDebugBridge', logStr);
    }
  };

  // Set up the WebSocket disconnection callback
  // This is called by the WASM module when the WebSocket connection dies
  window.onWasmWebSocketDisconnected = (reason: string): void => {
    debugLog('WasmDebugBridge', 'WebSocket disconnected:', reason);

    // Emit connection-failure event to show the retry modal
    eventEmitter.emit('connection-failure', {
      error: `WebSocket connection lost: ${reason}`,
      isDisconnect: true
    });

    // Also emit a specific event for services to stop background operations
    eventEmitter.emit('websocket-disconnected', { reason });
  };

  debugLog('WasmDebugBridge', 'WASM debug bridge set up');
}