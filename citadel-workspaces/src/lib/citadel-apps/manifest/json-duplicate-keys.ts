/**
 * Whether any JSON object in `text` names a key twice. `JSON.parse` keeps the last silently;
 * serde refuses the manifest, so a manifest the kernel would refuse must not be shown as valid.
 * Assumes `text` is JSON (`JSON.parse` already accepted it); it reads only strings and braces.
 */
export function hasDuplicateKeys(text: string): boolean {
  const stack: Array<{ keys: Set<string>; expectKey: boolean } | null> = [];
  let i: number = 0;
  while (i < text.length) {
    const c: string = text[i];
    if (c === '"') {
      let j: number = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const top: { keys: Set<string>; expectKey: boolean } | null = stack[stack.length - 1] ?? null;
      if (top !== null && top.expectKey) {
        const key: string = JSON.parse(text.slice(i, j + 1)) as string;
        if (top.keys.has(key)) return true;
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === '{') stack.push({ keys: new Set<string>(), expectKey: true });
    else if (c === '[') stack.push(null);
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') {
      const top: { keys: Set<string>; expectKey: boolean } | null = stack[stack.length - 1] ?? null;
      if (top !== null) top.expectKey = true;
    }
    i += 1;
  }
  return false;
}
