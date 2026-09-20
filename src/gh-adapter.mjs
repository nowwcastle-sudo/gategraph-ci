import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/i;
const NUMERIC_ID = /^\d+$/;
const BRANCH_NAME = /^[A-Za-z0-9._\-/]+$/;
const BRANCH_REF = /^refs\/heads\/[A-Za-z0-9._\-/]+$/;
const RUN_ID = /^[1-9][0-9]*$/;

function isRunId(value) {
  return typeof value === 'string' && RUN_ID.test(value) && Number.isSafeInteger(Number(value));
}

function isWorkflowPath(value) {
  return typeof value === 'string' && /^\.github\/workflows\/.+\.ya?ml$/.test(value) &&
    !value.includes('\\') && value.split('/').every((part) => part && part !== '.' && part !== '..');
}
const ENDPOINT_ALLOWLIST = [
  /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
  /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/git\/trees\/[0-9a-f]{40}\?recursive=1$/i,
  /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/contents\/[A-Za-z0-9._~%+-]+\?ref=[0-9a-f]{40}$/i,
  /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/rulesets\?includes_parents=true&targets=branch&per_page=100&page=\d+$/,
  /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/rulesets\/\d+\?includes_parents=true$/,
  /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/branches\/[A-Za-z0-9._~%+-]+\/protection$/,
  /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\?head_sha=[0-9a-f]{40}&per_page=100&page=\d+$/i,
  /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+\/jobs\?per_page=100&page=\d+$/,
  /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*\/attempts\/[1-9][0-9]*\/jobs\?per_page=100&page=\d+$/,
  /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/check-runs\/\d+$/,
];
const ANALYSIS_IDENTITY = Object.freeze({
  analyzer: 'gategraph-ci',
  version: '0.2.0-experimental.1',
  contract: 'gategraph-audit/v1',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function evidenceError(reasonCode, endpoint, code = 'INVALID_EVIDENCE') {
  const error = new Error('GitHub evidence could not be normalized');
  error.reasonCode = reasonCode;
  error.endpoint = endpoint;
  error.code = code;
  return error;
}

function isAllowedEndpoint(endpoint) {
  return typeof endpoint === 'string' && ENDPOINT_ALLOWLIST.some((pattern) => pattern.test(endpoint));
}

async function ghGet(endpoint, { execFileImpl = execFileAsync, headers = [] } = {}) {
  if (!isAllowedEndpoint(endpoint)) {
    throw evidenceError('ENDPOINT_NOT_ALLOWED', 'endpoint-allowlist', 'ENDPOINT_NOT_ALLOWED');
  }
  if (
    !Array.isArray(headers) ||
    headers.some((header) => header !== 'Accept: application/vnd.github.raw+json')
  ) {
    throw evidenceError('ENDPOINT_NOT_ALLOWED', endpoint, 'HEADER_NOT_ALLOWED');
  }
  const args = ['api', '--method', 'GET'];
  for (const header of headers) args.push('-H', header);
  args.push(endpoint);
  try {
    const { stdout } = await execFileImpl('gh', args, {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (error?.reasonCode) throw error;
    const sanitized = evidenceError(
      'GH_COLLECTION_FAILED',
      endpoint,
      typeof error?.code === 'string' || typeof error?.code === 'number' ? String(error.code) : 'UNKNOWN',
    );
    sanitized.notFound = String(error?.stderr ?? '').includes('HTTP 404');
    throw sanitized;
  }
}

function parseJson(text, endpoint) {
  try {
    return JSON.parse(text);
  } catch {
    throw evidenceError('GH_COLLECTION_FAILED', endpoint, 'INVALID_JSON');
  }
}

function observedSource(name, endpoint, extra = {}) {
  return { name, outcome: 'observed', complete: true, endpoint, ...extra };
}

function branchRef(name) {
  return typeof name === 'string' && BRANCH_NAME.test(name) ? `refs/heads/${name}` : null;
}

function resolveTargetRef(run) {
  if (run.event === 'push') return branchRef(run.head_branch);
  if (!['pull_request', 'pull_request_target', 'merge_group'].includes(run.event)) return null;
  if (!Array.isArray(run.pull_requests) || run.pull_requests.length === 0) return null;
  const refs = run.pull_requests.map((item) => branchRef(item?.base?.ref));
  return refs.every(Boolean) && new Set(refs).size === 1 ? refs[0] : null;
}

function checkRunEndpoint(checkRunUrl, repository) {
  try {
    const url = new URL(checkRunUrl);
    const match = url.pathname.match(/^\/repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/check-runs\/(\d+)$/);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'api.github.com' ||
      url.search !== '' ||
      !match ||
      match[1] !== repository
    ) {
      return null;
    }
    return `repos/${repository}/check-runs/${match[2]}`;
  } catch {
    return null;
  }
}

function normalizeRuleset(document, endpoint) {
  if (
    !isPlainObject(document) ||
    !NUMERIC_ID.test(String(document.id ?? '')) ||
    typeof document.target !== 'string' ||
    typeof document.enforcement !== 'string' ||
    !isPlainObject(document.conditions?.ref_name) ||
    !Array.isArray(document.conditions.ref_name.include) ||
    !Array.isArray(document.conditions.ref_name.exclude) ||
    !document.conditions.ref_name.include.every((item) => typeof item === 'string' && item.length > 0) ||
    !document.conditions.ref_name.exclude.every((item) => typeof item === 'string' && item.length > 0) ||
    !Array.isArray(document.rules)
  ) {
    throw evidenceError('GH_COLLECTION_FAILED', endpoint, 'INVALID_RULESET');
  }
  const requiredStatusChecks = [];
  for (const rule of document.rules) {
    if (rule?.type !== 'required_status_checks') continue;
    const checks = rule.parameters?.required_status_checks;
    if (!Array.isArray(checks)) {
      throw evidenceError('GH_COLLECTION_FAILED', endpoint, 'INVALID_RULESET_CHECKS');
    }
    for (const check of checks) {
      const integrationId = check?.integration_id ?? null;
      if (
        typeof check?.context !== 'string' ||
        check.context.length === 0 ||
        (integrationId !== null && (!Number.isSafeInteger(integrationId) || integrationId <= 0))
      ) {
        throw evidenceError('GH_COLLECTION_FAILED', endpoint, 'INVALID_RULESET_CHECK');
      }
      requiredStatusChecks.push({ context: check.context, integrationId });
    }
  }
  return {
    id: Number(document.id),
    target: document.target,
    enforcement: document.enforcement,
    conditions: {
      refName: {
        include: [...document.conditions.ref_name.include],
        exclude: [...document.conditions.ref_name.exclude],
      },
    },
    requiredStatusChecks,
  };
}

function normalizeClassic(document, targetRef, endpoint) {
  if (!isPlainObject(document)) throw evidenceError('GH_COLLECTION_FAILED', endpoint, 'INVALID_PROTECTION');
  const required = document.required_status_checks;
  if (required === null || required === undefined) {
    return { state: 'observed', targetRef, requiredStatusChecks: [] };
  }
  if (!isPlainObject(required)) {
    throw evidenceError('GH_COLLECTION_FAILED', endpoint, 'INVALID_PROTECTION_CHECKS');
  }
  const normalized = new Map();
  if (required.checks !== undefined && !Array.isArray(required.checks)) {
    throw evidenceError('GH_COLLECTION_FAILED', endpoint, 'INVALID_PROTECTION_CHECKS');
  }
  for (const check of required.checks ?? []) {
    const integrationId = check?.app_id ?? null;
    if (
      typeof check?.context !== 'string' ||
      check.context.length === 0 ||
      (integrationId !== null && (!Number.isSafeInteger(integrationId) || integrationId <= 0))
    ) {
      throw evidenceError('GH_COLLECTION_FAILED', endpoint, 'INVALID_PROTECTION_CHECK');
    }
    normalized.set(`${check.context}\0${integrationId ?? '*'}`, {
      context: check.context,
      integrationId,
    });
  }
  if (required.contexts !== undefined && !Array.isArray(required.contexts)) {
    throw evidenceError('GH_COLLECTION_FAILED', endpoint, 'INVALID_PROTECTION_CONTEXTS');
  }
  for (const context of required.contexts ?? []) {
    if (typeof context !== 'string' || context.length === 0) {
      throw evidenceError('GH_COLLECTION_FAILED', endpoint, 'INVALID_PROTECTION_CONTEXT');
    }
    if (![...normalized.values()].some((check) => check.context === context)) {
      normalized.set(`${context}\0*`, { context, integrationId: null });
    }
  }
  return { state: 'observed', targetRef, requiredStatusChecks: [...normalized.values()] };
}

function result(analysis, subject, workflows, controlPlane, observedRuns, sources, complete, scope) {
  const policySource = {
    name: 'policy',
    outcome: 'not-supplied',
    complete: true,
  };
  return {
    analysis,
    subject,
    workflows,
    controlPlane,
    observedRuns,
    policy: { jobs: [] },
    collection: { complete, sources: [...sources, policySource], ...(scope ? { scope } : {}) },
  };
}

/**
 * Collect immutable GitHub control-plane evidence with allowlisted GET requests.
 *
 * @param {{repository: string, sha: string, runIds?: string[], targetRef?: string, requireRunAttempt?: boolean}} coordinate
 * @param {{execFileImpl?: Function}} dependencies
 * @returns {Promise<object>}
 */
export async function collectWithGh({ repository, sha, runIds, targetRef, requireRunAttempt = false }, dependencies = {}) {
  if (typeof repository !== 'string' || !REPOSITORY.test(repository)) throw new TypeError('repository must be owner/name');
  if (typeof sha !== 'string' || !SHA.test(sha)) throw new TypeError('sha must be a 40-character hexadecimal commit');
  if (runIds !== undefined && (!Array.isArray(runIds) || !runIds.length ||
    ![...runIds].every(isRunId) || new Set(runIds).size !== runIds.length)) {
    throw new TypeError('run selection must contain unique positive safe-integer IDs');
  }
  if (targetRef !== undefined && (typeof targetRef !== 'string' || !BRANCH_REF.test(targetRef))) {
    throw new TypeError('target ref must be a fully qualified branch');
  }
  if (typeof requireRunAttempt !== 'boolean' || (requireRunAttempt && (runIds === undefined || targetRef === undefined))) {
    throw new TypeError('attempt-bound collection requires explicit run IDs and target');
  }

  const analysis = {
    ...ANALYSIS_IDENTITY,
    analyzedAt: new Date().toISOString(),
  };
  const subject = {
    kind: 'github',
    id: `${repository}@${sha}`,
    repository,
    ref: undefined,
    defaultBranchRef: undefined,
    sha,
  };
  const workflows = [];
  const controlPlane = {
    rulesets: [],
    classicProtection: { state: 'unknown', reasonCode: 'CLASSIC_PROTECTION_UNKNOWN' },
  };
  const observedRuns = [];
  const sources = [];
  let scope;
  let currentSource = 'repository';
  let currentEndpoint = `repos/${repository}`;
  const finish = (complete) => result(analysis, subject, workflows, controlPlane, observedRuns, sources, complete, scope);
  async function collectWorkflows(paths) {
    for (const path of paths) {
      currentSource = 'workflow';
      currentEndpoint = `repos/${repository}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(sha)}`;
      const text = await ghGet(currentEndpoint, {
        ...dependencies, headers: ['Accept: application/vnd.github.raw+json'],
      });
      if (typeof text !== 'string') throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'INVALID_WORKFLOW');
      workflows.push({ path, sha, text });
      sources.push(observedSource(currentSource, currentEndpoint, { path, sha }));
    }
  }

  try {
    const repositoryDocument = parseJson(await ghGet(currentEndpoint, dependencies), currentEndpoint);
    const defaultRef = branchRef(repositoryDocument?.default_branch);
    if (!defaultRef) throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'INVALID_REPOSITORY');
    subject.defaultBranchRef = defaultRef;
    sources.push(observedSource(currentSource, currentEndpoint, { defaultBranchRef: defaultRef }));

    currentSource = 'tree';
    currentEndpoint = `repos/${repository}/git/trees/${sha}?recursive=1`;
    const tree = parseJson(await ghGet(currentEndpoint, dependencies), currentEndpoint);
    if (!isPlainObject(tree) || !Array.isArray(tree.tree)) {
      throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'INVALID_TREE');
    }
    if (tree.truncated === true) {
      sources.push({
        name: currentSource,
        outcome: 'incomplete',
        complete: false,
        reasonCode: 'TREE_TRUNCATED',
        endpoint: currentEndpoint,
        sha,
      });
      return finish(false);
    }
    if (tree.truncated !== false || tree.tree.some((entry) => !isPlainObject(entry) || typeof entry.path !== 'string')) {
      throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'INVALID_TREE');
    }
    sources.push(observedSource(currentSource, currentEndpoint, { sha }));
    const workflowPaths = tree.tree
      .filter((entry) => entry.type === 'blob' && /^\.github\/workflows\/.*\.ya?ml$/.test(entry.path))
      .map((entry) => entry.path);
    if (workflowPaths.length === 0 || new Set(workflowPaths).size !== workflowPaths.length) {
      throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'WORKFLOWS_NOT_FOUND');
    }

    if (runIds === undefined) await collectWorkflows(workflowPaths);

    currentSource = 'actions-runs';
    const runDocuments = [];
    let runTotal = null;
    for (let page = 1; ; page += 1) {
      currentEndpoint = `repos/${repository}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100&page=${page}`;
      const envelope = parseJson(await ghGet(currentEndpoint, dependencies), currentEndpoint);
      if (
        !isPlainObject(envelope) ||
        !Number.isSafeInteger(envelope.total_count) ||
        envelope.total_count < 0 ||
        !Array.isArray(envelope.workflow_runs)
      ) {
        throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'INVALID_RUN_ENVELOPE');
      }
      if (runTotal === null) runTotal = envelope.total_count;
      if (envelope.total_count !== runTotal) {
        throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'RUN_TOTAL_CHANGED');
      }
      runDocuments.push(...envelope.workflow_runs);
      sources.push(observedSource(currentSource, currentEndpoint, {
        page,
        count: envelope.workflow_runs.length,
        totalCount: runTotal,
        pagesComplete: true,
        sha,
      }));
      if (runDocuments.length >= runTotal) break;
      if (envelope.workflow_runs.length === 0) {
        throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'RUN_PAGINATION_INCOMPLETE');
      }
    }
    if (runTotal === 0 || runDocuments.length !== runTotal) {
      throw evidenceError('RUN_LIFECYCLE_AMBIGUOUS', currentEndpoint, 'NO_COMPLETED_RUN');
    }
    const selected = runIds === undefined ? runDocuments : [...runIds].sort().map((runId) => {
      const matches = runDocuments.filter((run) => String(run?.id ?? '') === runId);
      if (matches.length !== 1) throw evidenceError('RUN_SELECTION_MISMATCH', currentEndpoint);
      return matches[0];
    });
    if (selected.some((run) => !isRunId(String(run?.id ?? '')) || run.head_sha !== sha ||
      !isWorkflowPath(run.path) || !workflowPaths.includes(run.path) || typeof run.event !== 'string')) {
      throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'INVALID_RUN');
    }
    if (requireRunAttempt && selected.some((run) => !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0)) {
      throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'INVALID_RUN_ATTEMPT');
    }
    if (selected.some((run) => run?.status !== 'completed' || typeof run?.conclusion !== 'string')) {
      throw evidenceError('RUN_LIFECYCLE_AMBIGUOUS', currentEndpoint, 'RUN_NOT_COMPLETED');
    }
    const targetRefs = [...new Set(selected.map(resolveTargetRef).filter(Boolean))];
    if (targetRefs.length !== 1 || selected.some((run) => !resolveTargetRef(run))) {
      throw evidenceError('TARGET_REF_UNRESOLVED', currentEndpoint, 'TARGET_REF_UNRESOLVED');
    }
    subject.ref = targetRefs[0];
    if (targetRef !== undefined && targetRef !== subject.ref) {
      throw evidenceError('TARGET_REF_MISMATCH', currentEndpoint);
    }
    if (runIds !== undefined) {
      const selectedPaths = [...new Set(selected.map((run) => run.path))].sort();
      if (selectedPaths.length !== selected.length) throw evidenceError('RUN_SELECTION_AMBIGUOUS', currentEndpoint);
      const allIds = runDocuments.map((run) => String(run?.id ?? ''));
      if (!allIds.every(isRunId) || new Set(allIds).size !== allIds.length || !workflowPaths.every(isWorkflowPath)) {
        throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'INVALID_RUN_ENUMERATION');
      }
      scope = {
        kind: 'selected-runs', repository, sha, targetRef: subject.ref,
        runIds: [...runIds].sort(),
        excludedRunIds: allIds.filter((id) => !runIds.includes(id)).sort(),
        excludedWorkflowPaths: workflowPaths.filter((path) => !selectedPaths.includes(path)).sort(),
      };
      await collectWorkflows(selectedPaths);
    }

    for (const run of selected) {
      const runId = String(run?.id ?? '');
      const jobs = [];
      let jobTotal = null;
      for (let page = 1; ; page += 1) {
        currentSource = 'jobs';
        const attemptPath = requireRunAttempt ? `/attempts/${run.run_attempt}` : '';
        currentEndpoint = `repos/${repository}/actions/runs/${runId}${attemptPath}/jobs?per_page=100&page=${page}`;
        const envelope = parseJson(await ghGet(currentEndpoint, dependencies), currentEndpoint);
        if (
          !isPlainObject(envelope) ||
          !Number.isSafeInteger(envelope.total_count) ||
          envelope.total_count < 0 ||
          !Array.isArray(envelope.jobs)
        ) {
          throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'INVALID_JOB_ENVELOPE');
        }
        if (jobTotal === null) jobTotal = envelope.total_count;
        if (envelope.total_count !== jobTotal) {
          throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'JOB_TOTAL_CHANGED');
        }
        jobs.push(...envelope.jobs);
        sources.push(observedSource(currentSource, currentEndpoint, {
          runId,
          page,
          count: envelope.jobs.length,
          totalCount: jobTotal,
          pagesComplete: true,
        }));
        if (jobs.length >= jobTotal) break;
        if (envelope.jobs.length === 0) {
          throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'JOB_PAGINATION_INCOMPLETE');
        }
      }
      if (jobTotal === 0 || jobs.length !== jobTotal) {
        throw evidenceError('RUN_LIFECYCLE_AMBIGUOUS', currentEndpoint, 'JOBS_NOT_COMPLETE');
      }

      const checkRuns = [];
      for (const job of jobs) {
        if (requireRunAttempt && (String(job?.run_id) !== runId || job?.head_sha !== sha)) {
          throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'JOB_RUN_COORDINATE_MISMATCH');
        }
        const endpoint = checkRunEndpoint(job?.check_run_url, repository);
        if (!endpoint) throw evidenceError('ENDPOINT_NOT_ALLOWED', 'check-run-url', 'ENDPOINT_NOT_ALLOWED');
        currentSource = 'check-run';
        currentEndpoint = endpoint;
        const check = parseJson(await ghGet(currentEndpoint, dependencies), currentEndpoint);
        if (
          !isPlainObject(check) ||
          String(check.id ?? '') !== endpoint.split('/').at(-1) ||
          check.name !== job.name ||
          check.head_sha !== sha ||
          check.status !== job.status ||
          check.conclusion !== job.conclusion ||
          check.status !== 'completed' ||
          typeof check.conclusion !== 'string' ||
          !Number.isSafeInteger(check.app?.id) ||
          check.app.id <= 0
        ) {
          throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'INVALID_CHECK_RUN');
        }
        checkRuns.push({
          name: check.name,
          sha: check.head_sha,
          status: check.status,
          conclusion: check.conclusion,
          provider: { kind: 'github-app', integrationId: check.app.id },
        });
        sources.push(observedSource(currentSource, currentEndpoint, {
          runId,
          providerId: check.app.id,
          sha,
        }));
      }
      observedRuns.push({
        event: run.event,
        sha: run.head_sha,
        runId,
        workflowPath: run.path,
        targetRef: subject.ref,
        status: run.status,
        conclusion: run.conclusion,
        checkRuns,
        ...(requireRunAttempt ? { runAttempt: run.run_attempt } : {}),
      });
    }

    currentSource = 'rulesets';
    const rulesetItems = [];
    for (let page = 1; ; page += 1) {
      currentEndpoint = `repos/${repository}/rulesets?includes_parents=true&targets=branch&per_page=100&page=${page}`;
      const items = parseJson(await ghGet(currentEndpoint, dependencies), currentEndpoint);
      if (!Array.isArray(items)) throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'INVALID_RULESET_LIST');
      rulesetItems.push(...items);
      sources.push(observedSource(currentSource, currentEndpoint, {
        page,
        count: items.length,
        pagesComplete: true,
      }));
      if (items.length < 100) break;
    }
    for (const item of rulesetItems) {
      const rulesetId = String(item?.id ?? '');
      if (!NUMERIC_ID.test(rulesetId)) {
        throw evidenceError('GH_COLLECTION_FAILED', currentEndpoint, 'INVALID_RULESET_ID');
      }
      currentEndpoint = `repos/${repository}/rulesets/${rulesetId}?includes_parents=true`;
      const document = parseJson(await ghGet(currentEndpoint, dependencies), currentEndpoint);
      controlPlane.rulesets.push(normalizeRuleset(document, currentEndpoint));
      sources.push(observedSource(currentSource, currentEndpoint, { rulesetId }));
    }

    currentSource = 'classic-protection';
    const branch = subject.ref.slice('refs/heads/'.length);
    currentEndpoint = `repos/${repository}/branches/${encodeURIComponent(branch)}/protection`;
    try {
      const document = parseJson(await ghGet(currentEndpoint, dependencies), currentEndpoint);
      controlPlane.classicProtection = normalizeClassic(document, subject.ref, currentEndpoint);
      sources.push(observedSource(currentSource, currentEndpoint, { ref: subject.ref }));
    } catch (error) {
      if (!error?.notFound) throw error;
      controlPlane.classicProtection = {
        state: 'unknown',
        reasonCode: 'CLASSIC_PROTECTION_UNKNOWN',
      };
      sources.push({
        name: currentSource,
        outcome: 'unknown',
        complete: false,
        reasonCode: 'CLASSIC_PROTECTION_UNKNOWN',
        endpoint: currentEndpoint,
        code: error.code,
        ref: subject.ref,
      });
      return finish(false);
    }
  } catch (error) {
    sources.push({
      name: currentSource,
      outcome: 'failed',
      complete: false,
      reasonCode: error?.reasonCode ?? 'GH_COLLECTION_FAILED',
      endpoint: error?.endpoint ?? currentEndpoint,
      code: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
    });
    return finish(false);
  }

  const complete = (
    workflows.length > 0 &&
    observedRuns.length > 0 &&
    controlPlane.classicProtection.state === 'observed' &&
    sources.every((source) => source.outcome === 'observed' && source.complete === true)
  );
  return finish(complete);
}
