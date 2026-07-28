#!/usr/bin/env node
import {appendFileSync, readFileSync} from 'node:fs';
import {createSign} from 'node:crypto';
import process from 'node:process';

const ASC_BASE_URL = 'https://api.appstoreconnect.apple.com';
const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} secret이 필요합니다.`);
  return value;
}

function parseArgs(argv) {
  const result = {tag: '', start: false};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--tag') {
      result.tag = argv[index + 1] ?? '';
      index += 1;
    } else if (value.startsWith('--tag=')) {
      result.tag = value.slice('--tag='.length);
    } else if (value === '--start') {
      result.start = true;
    } else {
      throw new Error(`지원하지 않는 인자입니다: ${value}`);
    }
  }
  if (!TAG_PATTERN.test(result.tag)) {
    throw new Error(`릴리스 태그는 vX.Y.Z 형식이어야 합니다: ${result.tag || 'empty'}`);
  }
  return result;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function mintToken() {
  const keyId = requiredEnvironment('APP_STORE_CONNECT_API_KEY_ID');
  const issuerId = requiredEnvironment('APP_STORE_CONNECT_ISSUER_ID');
  const privateKey = Buffer.from(
    requiredEnvironment('APP_STORE_CONNECT_PRIVATE_KEY_BASE64'),
    'base64',
  ).toString('utf8');
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({alg: 'ES256', kid: keyId, typ: 'JWT'});
  const payload = base64UrlJson({
    iss: issuerId,
    iat: now,
    exp: now + 20 * 60,
    aud: 'appstoreconnect-v1',
  });
  const signingInput = `${header}.${payload}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${signingInput}.${signature}`;
}

async function request(path, init = {}) {
  const response = await fetch(`${ASC_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${mintToken()}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const body = await response.text();
  const document = body ? JSON.parse(body) : {};
  if (!response.ok) {
    const detail = document.errors
      ?.map(error => error.detail ?? error.title)
      .filter(Boolean)
      .join('; ') || body;
    throw new Error(`App Store Connect API ${response.status}: ${detail}`);
  }
  return document;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function findProduct(bundleId) {
  const document = await request('/v1/ciProducts?include=app&limit=200');
  const apps = document.included ?? [];
  const product = asArray(document.data).find(candidate => {
    const appId = candidate.relationships?.app?.data?.id;
    const app = apps.find(included => included.id === appId);
    return app?.attributes?.bundleId === bundleId;
  });
  if (!product) {
    throw new Error(`Xcode Cloud 제품이 없습니다(bundleId=${bundleId}).`);
  }
  return product;
}

async function findWorkflow(productId) {
  const document = await request(`/v1/ciProducts/${productId}/workflows?limit=200`);
  const workflows = asArray(document.data);
  const expectedName = process.env.XCODE_CLOUD_WORKFLOW_NAME?.trim();
  const workflow = expectedName
    ? workflows.find(candidate => candidate.attributes?.name === expectedName)
    : workflows.find(candidate => candidate.attributes?.isEnabled === true);
  if (!workflow || workflow.attributes?.isEnabled !== true) {
    throw new Error(`활성 Xcode Cloud workflow를 찾지 못했습니다: ${expectedName || 'empty'}`);
  }
  return workflow;
}

async function findTagReference(productId, tag) {
  const repositories = await request(
    `/v1/ciProducts/${productId}/primaryRepositories?limit=10`,
  );
  const repository = asArray(repositories.data)[0];
  if (!repository) throw new Error('Xcode Cloud primary repository가 없습니다.');
  const references = await request(
    `/v1/scmRepositories/${repository.id}/gitReferences?limit=200`,
  );
  const reference = asArray(references.data).find(candidate => (
    candidate.attributes?.kind === 'TAG' &&
    candidate.attributes?.name === tag
  ));
  if (!reference) {
    throw new Error(`Xcode Cloud에 태그가 동기화되지 않았습니다: ${tag}`);
  }
  return reference;
}

function writeGithubOutput(entries) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(entries)
    .map(([key, value]) => `${key}=${value ?? ''}`)
    .join('\n');
  appendFileSync(outputPath, `${lines}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(readFileSync('app-store/app-store.config.json', 'utf8'));
  const product = await findProduct(config.bundleId);
  const [workflow, reference] = await Promise.all([
    findWorkflow(product.id),
    findTagReference(product.id, args.tag),
  ]);
  let buildRun = null;
  if (args.start) {
    const document = await request('/v1/ciBuildRuns', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'ciBuildRuns',
          relationships: {
            workflow: {data: {type: 'ciWorkflows', id: workflow.id}},
            sourceBranchOrTag: {
              data: {type: 'scmGitReferences', id: reference.id},
            },
          },
        },
      }),
    });
    buildRun = asArray(document.data)[0] ?? null;
  }
  const values = {
    tag: args.tag,
    product_id: product.id,
    workflow_id: workflow.id,
    build_run_id: buildRun?.id ?? '',
    build_number: buildRun?.attributes?.number ?? '',
    started: String(args.start),
  };
  writeGithubOutput(values);
  console.log(JSON.stringify(values, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
