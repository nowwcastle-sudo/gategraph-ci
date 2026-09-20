const EXPRESSION = /\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/g;
const plain = (value) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Expand only unambiguous literal check identities, committing budget on success. */
export function expandStaticMatrix(job, limits, budget) {
  if (!plain(job) || typeof job.name !== 'string' || !job.name.trim()) return { error: 'unsupported' };
  const name = job.name;
  if (name.length > limits.maxNameLength) return { error: 'resource-limit' };
  const expressions = [...name.matchAll(EXPRESSION)];
  let cells = [{ axes: {}, checkName: name }];
  if (expressions.length === 0) {
    if (name.includes('${{') || Object.hasOwn(job, 'strategy')) return { error: 'unsupported' };
  } else {
    if (!plain(job.strategy) || Object.keys(job.strategy).some((key) => key !== 'matrix') ||
      !plain(job.strategy.matrix)) return { error: 'unsupported' };
    const matrix = job.strategy.matrix;
    const keys = Object.keys(matrix).sort();
    if (!keys.length || keys.some((key) => key === 'include' || key === 'exclude' ||
      !/^[A-Za-z0-9_-]+$/.test(key))) return { error: 'unsupported' };
    if (keys.length > 4) return { error: 'resource-limit' };
    const referenced = new Set(expressions.map((expression) => expression[1]));
    if (referenced.size !== keys.length || keys.some((key) => !referenced.has(key)) ||
      name.replace(EXPRESSION, '').includes('${{')) return { error: 'unsupported' };
    let count = 1;
    for (const key of keys) {
      const values = matrix[key];
      if (!Array.isArray(values) || !values.length || values.some((value) =>
        !['string', 'number', 'boolean'].includes(typeof value) ||
        (typeof value === 'number' && !Number.isFinite(value)) ||
        (typeof value === 'string' && value.includes('${{')))) return { error: 'unsupported' };
      if (values.length > limits.maxValues || values.some((value) => String(value).length > limits.maxValueLength)) {
        return { error: 'resource-limit' };
      }
      count *= values.length;
      if (!Number.isSafeInteger(count) || count > limits.maxValues) return { error: 'resource-limit' };
    }
    const occurrences = new Map(keys.map((key) => [key, expressions.filter((expression) => expression[1] === key).length]));
    const unchanged = name.length - expressions.reduce((sum, expression) => sum + expression[0].length, 0);
    const longest = unchanged + keys.reduce((sum, key) => sum + occurrences.get(key) *
      Math.max(...matrix[key].map((value) => String(value).length)), 0);
    const prospectiveTotal = count * unchanged + keys.reduce((sum, key) => sum +
      occurrences.get(key) * (count / matrix[key].length) *
      matrix[key].reduce((valueSum, value) => valueSum + String(value).length, 0), 0);
    if (longest > (limits.maxExpandedNameLength ?? 2048) ||
      !Number.isSafeInteger(prospectiveTotal) || budget.expandedChars + prospectiveTotal > limits.maxExpandedChars) {
      return { error: 'resource-limit' };
    }
    cells = [{ axes: {}, checkName: '' }];
    for (const key of keys) cells = cells.flatMap((cell) => matrix[key].map((value) => ({
      axes: { ...cell.axes, [key]: value }, checkName: '',
    })));
    cells = cells.map((cell) => ({ ...cell, checkName: name.replace(EXPRESSION, (_, key) => String(cell.axes[key])) }));
  }
  const names = cells.map((cell) => cell.checkName);
  if (names.some((value) => !value.trim() || value.includes('${{')) || new Set(names).size !== names.length) {
    return { error: 'unsupported' };
  }
  const total = names.reduce((sum, value) => sum + value.length, 0);
  if (names.some((value) => value.length > (limits.maxExpandedNameLength ?? 2048)) ||
    !Number.isSafeInteger(total) || budget.expandedChars + total > limits.maxExpandedChars) {
    return { error: 'resource-limit' };
  }
  budget.expandedChars += total;
  return { cells };
}
