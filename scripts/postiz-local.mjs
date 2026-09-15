#!/usr/bin/env node
// Local self-hosted Postiz for ContentStation publishing work.
//
//   node scripts/postiz-local.mjs setup     write postiz/.env and postiz/postiz.env with random secrets
//   node scripts/postiz-local.mjs up        docker compose up -d, then wait for the API
//   node scripts/postiz-local.mjs down      stop the stack (data volumes are kept; add --wipe to delete them)
//   node scripts/postiz-local.mjs status    container state and API reachability
//   node scripts/postiz-local.mjs verify    two-organization isolation check against the running stack
//
// The verify command talks only to the local instance and never contacts a social
// platform. It creates two organizations through the enterprise provisioning route,
// inserts labelled fake channel rows directly into the local database, and proves
// that one organization's API key cannot read or change the other's channels, posts
// or media. Fake channels are a local fixture, not evidence that a platform accepted
// anything.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'postiz');
const envPath = join(dir, '.env');
const appEnvPath = join(dir, 'postiz.env');
const command = process.argv[2] || 'status';
const flags = new Set(process.argv.slice(3));

const readEnv = (path) =>
  Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
const fill = (example, values) =>
  readFileSync(example, 'utf8')
    .split('\n')
    .map((line) => {
      const key = line.split('=')[0];
      return key in values && !line.startsWith('#') ? `${key}=${values[key]}` : line;
    })
    .join('\n');
const compose = (args, opts = {}) =>
  spawnSync('docker', ['compose', ...args], { cwd: dir, stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', ...opts });

const baseUrl = () => {
  const env = existsSync(envPath) ? readEnv(envPath) : {};
  return `http://${env.POSTIZ_BIND || '127.0.0.1'}:${env.POSTIZ_PORT || '4007'}/api`;
};

async function waitForApi(url, seconds) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${url}/public/v1/integrations`, { headers: { authorization: 'probe' }, signal: AbortSignal.timeout(3000) });
      if (r.status === 401) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

function setup() {
  if (existsSync(envPath) && existsSync(appEnvPath) && !flags.has('--force')) {
    console.log('postiz/.env and postiz/postiz.env already exist. Use --force to regenerate (this invalidates the running database passwords).');
    return;
  }
  const secret = () => randomBytes(32).toString('base64url');
  writeFileSync(envPath, fill(join(dir, '.env.example'), { POSTIZ_DB_PASSWORD: secret(), TEMPORAL_DB_PASSWORD: secret() }));
  writeFileSync(appEnvPath, fill(join(dir, 'postiz.env.example'), { JWT_SECRET: secret() }));
  console.log('Wrote postiz/.env and postiz/postiz.env with random local secrets. Both are ignored by Git.');
}

async function up() {
  if (!existsSync(envPath) || !existsSync(appEnvPath)) setup();
  const r = compose(['up', '-d', ...(flags.has('--debug') ? ['--profile', 'debug'] : [])]);
  if (r.status !== 0) process.exit(r.status || 1);
  const url = baseUrl();
  process.stdout.write(`Waiting for ${url} `);
  const ok = await waitForApi(url, 300);
  console.log(ok ? 'ready.' : 'not ready after 5 minutes. Check: docker compose -f postiz/docker-compose.yml logs postiz');
  if (!ok) process.exit(1);
}

function down() {
  const r = compose(['down', ...(flags.has('--wipe') ? ['-v'] : [])]);
  process.exit(r.status || 0);
}

async function status() {
  compose(['ps']);
  const url = baseUrl();
  console.log(`API ${url}: ${(await waitForApi(url, 1)) ? 'reachable (401 for an unknown key, as expected)' : 'not reachable'}`);
}

// Minimal HS256 JWT, the same shape jsonwebtoken produces for sign(value, secret).
function signJwt(payload, secret) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ ...payload, iat: Math.floor(Date.now() / 1000) })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

// 1x1 PNG so uploads exercise the real type sniffing without shipping a binary fixture.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function verify() {
  const url = baseUrl();
  const app = readEnv(appEnvPath);
  if (!app.JWT_SECRET) throw new Error('postiz/postiz.env has no JWT_SECRET');
  const env = readEnv(envPath);
  const dbUser = env.POSTIZ_DB_USER || 'postiz', dbName = env.POSTIZ_DB_NAME || 'postiz';
  const results = [];
  const check = (name, ok, detail = '') => {
    ok = !!ok;
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
    if (!ok) process.exitCode = 1;
  };
  const call = async (method, path, key, body, headers = {}) => {
    const r = await fetch(`${url}${path}`, {
      method,
      headers: { ...(key ? { authorization: key } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  };
  const psql = (sql) =>
    execFileSync('docker', ['compose', 'exec', '-T', 'postiz-postgres', 'psql', '-U', dbUser, '-d', dbName, '-At', '-c', sql], { cwd: dir, encoding: 'utf8' }).trim();

  if (!(await waitForApi(url, 5))) throw new Error(`Postiz API is not reachable at ${url}. Run: node scripts/postiz-local.mjs up`);
  check('unknown API key is rejected', (await call('GET', '/public/v1/integrations', 'not-a-key')).status === 401);

  // Provision two organizations the same way the ContentStation API will: a JWT signed
  // with the instance secret, one deterministic synthetic email per organization.
  const run = randomUUID().slice(0, 8);
  const orgs = {};
  for (const label of ['A', 'B']) {
    const id = `verify-${run}-${label}`;
    const r = await call('POST', '/enterprise/create-user', null, {
      params: signJwt({ id, name: `Isolation test ${label}`, saasName: 'contentstation', email: `${id}@verify.contentstation.invalid` }, app.JWT_SECRET),
    });
    check(`organization ${label} provisioned through /enterprise/create-user`, r.status === 201 && r.json?.id && r.json?.apiKey, `status ${r.status}`);
    orgs[label] = { id: r.json?.id, key: r.json?.apiKey };
  }
  const dup = await call('POST', '/enterprise/create-user', null, {
    params: signJwt({ id: `verify-${run}-A`, name: 'dup', saasName: 'contentstation', email: `verify-${run}-A@verify.contentstation.invalid` }, app.JWT_SECRET),
  });
  check('repeating provisioning with the same email does not create a second organization', dup.json?.create === false, JSON.stringify(dup.json));
  const badSig = await call('POST', '/enterprise/create-user', null, { params: signJwt({ id: 'x', name: 'x', saasName: 'x', email: 'x@x.invalid' }, 'wrong-secret') });
  check('provisioning with a wrong signature is refused', badSig.json?.success === false, JSON.stringify(badSig.json));

  // Media: each organization uploads its own file.
  const media = {};
  for (const label of ['A', 'B']) {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'pixel.png');
    const r = await call('POST', '/public/v1/upload', orgs[label].key, form);
    check(`organization ${label} uploads media`, r.status === 201 && r.json?.id && r.json?.path, `status ${r.status}`);
    media[label] = r.json;
  }
  check('uploads return distinct media records per organization', media.A?.id && media.B?.id && media.A.id !== media.B.id && media.A.path !== media.B.path, `A ${Object.keys(media.A || {}).join(',')}`);

  // Local fixture: fake channel rows. These are not connected social accounts.
  const chan = {};
  for (const label of ['A', 'B']) {
    const id = `fake${run}${label}`.toLowerCase();
    psql(`INSERT INTO "Integration" (id, "internalId", "organizationId", name, "providerIdentifier", type, token, "postingTimes", "additionalSettings", "createdAt") VALUES ('${id}', 'fake-${run}-${label}', '${orgs[label].id}', 'FAKE ${label} (local fixture)', 'facebook', 'social', 'fake-token', '[]', '[]', now())`);
    chan[label] = id;
  }
  const listA = await call('GET', '/public/v1/integrations', orgs.A.key);
  const listB = await call('GET', '/public/v1/integrations', orgs.B.key);
  check('each organization lists only its own channel', listA.json?.length === 1 && listA.json[0].id === chan.A && listB.json?.length === 1 && listB.json[0].id === chan.B, JSON.stringify([listA.json?.map((i) => i.id), listB.json?.map((i) => i.id)]));
  const foreignSettings = await call('GET', `/public/v1/integration-settings/${chan.B}`, orgs.A.key);
  check("organization A cannot read organization B's channel settings", foreignSettings.status === 404, `status ${foreignSettings.status}`);

  // Drafts only: a draft is stored without scheduling, so nothing is sent to a platform.
  const date = new Date(Date.now() + 3600000).toISOString();
  const draft = (label) => ({
    type: 'draft', date, shortLink: false, tags: [],
    posts: [{ integration: { id: chan[label] }, value: [{ content: `Isolation draft ${label} ${run}`, image: [{ id: media[label].id, path: media[label].path }] }], settings: { __type: 'facebook' } }],
  });
  const postA = await call('POST', '/public/v1/posts', orgs.A.key, draft('A'));
  check('organization A stores a draft on its channel', postA.status === 201 && postA.json?.[0]?.postId, `status ${postA.status} ${JSON.stringify(postA.json).slice(0, 200)}`);
  const cross = await call('POST', '/public/v1/posts', orgs.B.key, draft('A'));
  check("organization B cannot post to organization A's channel", cross.status === 400, `status ${cross.status} ${JSON.stringify(cross.json).slice(0, 160)}`);
  const window = `startDate=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&endDate=${encodeURIComponent(new Date(Date.now() + 2 * 86400000).toISOString())}`;
  const postsA = await call('GET', `/public/v1/posts?${window}`, orgs.A.key);
  const postsB = await call('GET', `/public/v1/posts?${window}`, orgs.B.key);
  check("organization B's post list does not include organization A's draft", postsA.json?.posts?.some((p) => p.id === postA.json?.[0]?.postId) && !postsB.json?.posts?.some((p) => p.id === postA.json?.[0]?.postId), JSON.stringify([postsA.json?.posts?.length, postsB.json?.posts?.length]));
  const delCross = await call('DELETE', `/public/v1/posts/${postA.json?.[0]?.postId}`, orgs.B.key);
  const stillThere = await call('GET', `/public/v1/posts?${window}`, orgs.A.key);
  check("organization B cannot delete organization A's draft", delCross.status >= 400 && stillThere.json?.posts?.some((p) => p.id === postA.json?.[0]?.postId), `delete status ${delCross.status}`);
  const delChanCross = await call('DELETE', `/public/v1/integrations/${chan.A}`, orgs.B.key);
  const listAAfter = await call('GET', '/public/v1/integrations', orgs.A.key);
  check("organization B cannot remove organization A's channel", listAAfter.json?.some((i) => i.id === chan.A), `delete status ${delChanCross.status}`);

  // Restart the application container and confirm the data and keys survive.
  compose(['restart', 'postiz'], { capture: true });
  const back = await waitForApi(url, 240);
  const afterA = back ? await call('GET', `/public/v1/posts?${window}`, orgs.A.key) : { json: null };
  check('data and API keys survive a container restart', back && afterA.json?.posts?.some((p) => p.id === postA.json?.[0]?.postId));

  // Optional: a real MP4 (generated with FFmpeg) passes the upload type sniffing.
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  if (ffmpeg) {
    const mp4 = join(root, '.runtime', `postiz-verify-${run}.mp4`);
    mkdirSync(join(root, '.runtime'), { recursive: true });
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:d=2:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
    const form = new FormData();
    form.append('file', new Blob([readFileSync(mp4)], { type: 'video/mp4' }), 'clip.mp4');
    const r = await call('POST', '/public/v1/upload', orgs.A.key, form);
    check('organization A uploads a real MP4 (generated locally)', r.status === 201 && /\.mp4$/.test(r.json?.path || ''), `status ${r.status} ${r.json?.path || ''}`);
  } else {
    console.log('SKIP  MP4 upload check (ffmpeg not installed)');
  }

  // Clean up the fixtures so repeated runs do not accumulate rows. Postiz keeps
  // soft-deleted posts, so their rows go first.
  await call('DELETE', `/public/v1/posts/${postA.json?.[0]?.postId}`, orgs.A.key);
  psql(`DELETE FROM "Post" WHERE "integrationId" IN ('${chan.A}', '${chan.B}')`);
  psql(`DELETE FROM "Integration" WHERE id IN ('${chan.A}', '${chan.B}')`);
  const report = { checked_at: new Date().toISOString(), postiz_url: url, organizations: { A: orgs.A.id, B: orgs.B.id }, results };
  mkdirSync(join(root, '.runtime'), { recursive: true });
  writeFileSync(join(root, '.runtime', 'postiz-verify.json'), JSON.stringify(report, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed. Report: .runtime/postiz-verify.json (organization IDs only, no keys).`);
}

const commands = { setup, up, down, status, verify };
if (!commands[command]) {
  console.error(`Unknown command ${command}. Use setup, up, down, status or verify.`);
  process.exit(2);
}
await commands[command]();
