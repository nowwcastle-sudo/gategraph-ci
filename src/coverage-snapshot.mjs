import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const RESOURCE_LIMIT = 'COVERAGE_RESOURCE_LIMIT';
const sortByIdentity = (items, key) => [...items].sort((a, b) => {
  const left = key(a);
  const right = key(b);
  return left < right ? -1 : left > right ? 1 : 0;
});

function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('unsupported canonical value');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError('unsupported canonical object');
  }
  ancestors.add(value);
  let serialized;
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) {
      throw new TypeError('unsupported canonical array');
    }
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('unsupported canonical array');
      }
      items.push(canonicalJson(descriptor.value, ancestors));
    }
    serialized = `[${items.join(',')}]`;
  } else {
    serialized = `{${Reflect.ownKeys(value).sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('unsupported canonical property');
      }
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, ancestors)}`;
    }).join(',')}}`;
  }
  ancestors.delete(value);
  return serialized;
}

/** SHA-256 of strictly serializable, recursively key-sorted JSON. */
export function canonicalDigest(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** Build a complete, deterministically ordered snapshot; never truncate. */
export function buildCoverageSnapshot(model) {
  if (model.producers.length > 4096 || model.edges.length > 16384) throw new RangeError(RESOURCE_LIMIT);
  const snapshot = {
    ...model,
    scope: [...model.scope].sort(),
    workflows: sortByIdentity(model.workflows, (item) => item.path),
    producers: sortByIdentity(model.producers, (item) => item.id),
    gates: sortByIdentity(model.gates, (item) => item.id),
    edges: sortByIdentity(model.edges, (item) => canonicalJson([item.workflowPath, item.fromJobId, item.toJobId])),
    links: sortByIdentity(model.links, (item) => canonicalJson([item.producerId, item.gateId, item.kind])),
    schema: 'gategraph-coverage/1',
    complete: true,
  };
  snapshot.digest = canonicalDigest(snapshot);
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 1024 * 1024) throw new RangeError(RESOURCE_LIMIT);
  return snapshot;
}
