// The packages a crate's build can reach in a Cargo.lock, as comparable lines.
//
// Dev-dependencies are listed in the lock alongside normal ones and are kept, which errs toward
// "changed": a false "needs a bump" costs a release, a false "unchanged" ships a stale agent.

/** Parse the [[package]] entries of a Cargo.lock (TOML, in the fixed shape cargo writes). */
function packages(lock) {
  return lock.split(/^\[\[package\]\]$/m).slice(1).map((block) => {
    const field = (key) => new RegExp(`^${key} = "([^"]*)"$`, "m").exec(block)?.[1] ?? "";
    const deps = /^dependencies = \[\n([\s\S]*?)^\]/m.exec(block)?.[1] ?? "";
    return {
      name: field("name"),
      version: field("version"),
      source: field("source"),
      checksum: field("checksum"),
      dependencies: [...deps.matchAll(/^ "([^"]+)",?$/gm)].map((m) => m[1]),
    };
  });
}

/** Every package reachable from `root`, as "name version source checksum", sorted. */
export function lockClosure(lock, root) {
  const all = packages(lock);
  // A dependency is written "name", "name version" or "name version (source)".
  const resolve = (ref) => {
    const [name, version] = ref.split(" ");
    const hits = all.filter((p) => p.name === name && (version === undefined || p.version === version));
    if (hits.length !== 1) throw new Error(`Cargo.lock: cannot resolve dependency "${ref}" (${hits.length} matches)`);
    return hits[0];
  };
  const start = all.filter((p) => p.name === root);
  if (start.length !== 1) throw new Error(`Cargo.lock has ${start.length} packages named ${root}`);
  const seen = new Map();
  const queue = [start[0]];
  while (queue.length > 0) {
    const p = queue.pop();
    const key = `${p.name} ${p.version} ${p.source} ${p.checksum}`;
    if (seen.has(key)) continue;
    seen.set(key, p);
    queue.push(...p.dependencies.map(resolve));
  }
  return [...seen.keys()].sort();
}
