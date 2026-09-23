#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { collectWithGh } from '../src/gh-adapter.mjs';
import { createDemoInput, DEMO_SCENARIOS } from '../src/demo-evidence.mjs';
import { readAuthoredPolicy, policyMatchesRequest, createPolicyErrorInput, applyAuthoredPolicy } from '../src/policy-input.mjs';
import { readSavedReport } from '../src/report-input.mjs';
import { compareCoverage } from '../src/coverage-snapshot.mjs';

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/i;
const BRANCH_REF = /^refs\/heads\/[A-Za-z0-9._\-/]+$/;
const RUN_ID = /^[1-9][0-9]*$/;
const USAGE = 'Usage: gategraph audit --repo owner/name --sha 40-hex-commit\n';
const DEMO_USAGE = 'Usage: gategraph demo [--scenario finding|policy-review|unknown|collection-error]\n';
const COMPARE_USAGE = 'Usage: gategraph compare --before FILE --after FILE\n';
const HELP = [
  'GateGraph CI - experimental, read-only merge-gate analysis', '',
  'First task: gategraph demo',
  'The demo uses synthetic fixtures through the real audit core.',
  'Its runtime needs no credentials, network, GitHub CLI, or source checkout.',
  'Default demo result: finding; exit 2 is expected.', '',
  DEMO_USAGE.trimEnd(), USAGE.trimEnd(), COMPARE_USAGE.trimEnd(),
  'Usage: gategraph --help', 'Usage: gategraph --version', '',
  'Audit and demo write one JSON report to stdout.',
  'Help and version write text to stdout without collecting evidence.',
  'Status exits: unknown=0, finding=2, policy-review=3, collection-error=4.',
  'Usage errors and unexpected failures exit 1. Unknown is not a safety claim.',
  'Live audits require GitHub CLI authentication and read permissions.',
  'Audit options may be reordered; --run-id ID is repeatable and --target-ref REF asserts the observed target.',
  'Explicit selection records excluded runs/workflows; all active required contexts still apply.',
  'Optional --policy-file FILE requires --target-ref and --run-id; it binds reviewed policy to the observed run attempt.',
  'Authored policy is an operator assertion, not authenticated maintainer approval. Retain its evidence.',
  'Never mark all-needs propagation from dependency ancestry alone.',
  'Optional --explain on audit or demo adds a bounded coverage snapshot and review-only suggestions.',
  'Compare reads two local saved reports only; it never collects evidence or changes GitHub state.',
  'Compare exits: comparable=0; unavailable or invalid saved evidence=4; usage/failure=1.',
  'GateGraph does not execute workflows or change GitHub state.', '',
].join('\n');
const EXIT_BY_STATUS = new Map([
  ['unknown', 0],
  ['finding', 2],
  ['policy-review', 3],
  ['collection-error', 4],
]);

function parseCommand(argv) {
  if (!Array.isArray(argv) || !argv.every((value) => typeof value === 'string')) return null;
  if ((argv.length === 1 && argv[0] === '--help') ||
    (argv.length === 2 && ['demo', 'audit', 'compare'].includes(argv[0]) && argv[1] === '--help')) {
    return { kind: 'help' };
  }
  if (argv.length === 1 && argv[0] === '--version') return { kind: 'version' };
  if (argv[0] === 'compare') {
    if (argv.length !== 5) return null;
    const options = new Map();
    for (let index = 1; index < argv.length; index += 2) {
      if (!['--before', '--after'].includes(argv[index]) || options.has(argv[index]) ||
        !argv[index + 1] || argv[index + 1].startsWith('--')) return null;
      options.set(argv[index], argv[index + 1]);
    }
    if (options.size !== 2) return null;
    return { kind: 'compare', before: options.get('--before'), after: options.get('--after') };
  }
  if (argv[0] === 'demo') {
    let scenario = 'finding';
    let explain = false;
    let hasScenario = false;
    for (let index = 1; index < argv.length; index += 1) {
      if (argv[index] === '--explain' && !explain) explain = true;
      else if (argv[index] === '--scenario' && !hasScenario && DEMO_SCENARIOS.includes(argv[index + 1])) {
        scenario = argv[++index];
        hasScenario = true;
      } else return null;
    }
    return { kind: 'demo', scenario, explain };
  }
  if (argv[0] !== 'audit') return null;
  const options = new Map();
  const runIds = [];
  let explain = false;
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--explain') {
      if (explain) return null;
      explain = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined) return null;
    if (value.startsWith('--')) return null;
    if (!['--repo', '--sha', '--run-id', '--target-ref', '--policy-file'].includes(option)) return null;
    if (option === '--run-id') {
      if (!RUN_ID.test(value) || !Number.isSafeInteger(Number(value)) || runIds.includes(value)) return null;
      runIds.push(value);
    } else {
      if (options.has(option)) return null;
      options.set(option, value);
    }
  }
  if (!options.has('--repo') || !REPOSITORY.test(options.get('--repo')) ||
    !options.has('--sha') || !SHA.test(options.get('--sha')) ||
    (options.has('--target-ref') && !BRANCH_REF.test(options.get('--target-ref')))) return null;
  if (options.has('--policy-file') && (!options.get('--policy-file') || !runIds.length || !options.has('--target-ref'))) return null;
  return { kind: 'audit', explain, ...(options.has('--policy-file') ? { policyFile: options.get('--policy-file') } : {}), coordinate: {
    repository: options.get('--repo'), sha: options.get('--sha'),
    ...(runIds.length ? { runIds: [...runIds].sort() } : {}),
    ...(options.has('--target-ref') ? { targetRef: options.get('--target-ref') } : {}),
  } };
}

/**
 * Run the GateGraph CLI with injectable orchestration dependencies.
 *
 * @param {string[]} argv
 * @param {object} dependencies
 * @returns {Promise<number>}
 */
export async function runCli(argv, dependencies = {}) {
  const collector = dependencies.collectWithGh ?? collectWithGh;
  const audit = dependencies.auditControlPlane ?? auditControlPlane;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;

  const command = parseCommand(argv);
  if (!command) {
    stderr.write(argv?.[0] === 'demo' ? DEMO_USAGE : argv?.[0] === 'compare' ? COMPARE_USAGE : USAGE);
    return 1;
  }

  try {
    if (command.kind === 'help') {
      stdout.write(HELP);
      return 0;
    }
    if (command.kind === 'version') {
      const { name, version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
      stdout.write(`${name} ${version}\n`);
      return 0;
    }
    if (command.kind === 'compare') {
      const reader = dependencies.readSavedReport ?? readSavedReport;
      let result;
      try {
        const before = await reader(command.before);
        const after = await reader(command.after);
        result = compareCoverage(before, after);
      } catch (error) {
        if (error?.message !== 'SAVED_REPORT_INVALID') throw error;
        result = { comparable: false, changes: [], before: null, after: null,
          unresolved: ['SAVED_REPORT_INVALID'] };
      }
      stdout.write(`${JSON.stringify(result)}\n`);
      return result.comparable ? 0 : 4;
    }
    let input;
    if (command.kind === 'demo') input = createDemoInput(command.scenario);
    else if (command.policyFile !== undefined) {
      const document = await readAuthoredPolicy(command.policyFile);
      if (document === null) input = createPolicyErrorInput(command.coordinate, 'POLICY_INPUT_INVALID');
      else if (!policyMatchesRequest(document, command.coordinate)) {
        input = createPolicyErrorInput(command.coordinate, 'POLICY_COORDINATE_MISMATCH');
      } else {
        input = applyAuthoredPolicy(await collector({ ...command.coordinate, requireRunAttempt: true }), document);
      }
    } else input = await collector(command.coordinate);
    const report = command.explain ? await audit(input, { explain: true }) : await audit(input);
    const exitCode = EXIT_BY_STATUS.get(report?.status);
    if (exitCode === undefined) throw new TypeError('unsupported report status');
    stdout.write(`${JSON.stringify(report)}\n`);
    return exitCode;
  } catch {
    stderr.write('INTERNAL_ERROR\n');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
