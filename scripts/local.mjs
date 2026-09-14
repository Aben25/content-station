#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(root, '.runtime');
mkdirSync(runtime, { recursive: true });
const file = resolve(runtime, 'local-env.json');
const command = process.argv[2] ?? 'start';
const project = 'demo-contentstation-v2';
const children = [];
let stopping = false;
let cronTimer;

function configuration() {
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  for (const key of ['ENGINE_API_KEY', 'DEVICE_JWT_SECRET', 'MEDIA_SECRET', 'CRON_SECRET']) {
    saved[key] ||= randomBytes(32).toString('hex');
  }
  if (process.env.OPENSHORTS_HOME) saved.OPENSHORTS_HOME = resolve(process.env.OPENSHORTS_HOME);
  writeFileSync(file, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 });
  const openshorts = resolve(saved.OPENSHORTS_HOME || resolve(runtime, 'openshorts'));
  const env = { ...process.env, ...saved,
    GCLOUD_PROJECT: project, GOOGLE_CLOUD_PROJECT: project,
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199', FIREBASE_STORAGE_BUCKET: `${project}.appspot.com`,
    API_BASE_URL: 'http://127.0.0.1:4310', PORT: '4310', HOST: '127.0.0.1',
    OWNER_APP_URL: 'http://127.0.0.1:4311', OWNER_ORIGIN: 'http://127.0.0.1:4311,http://localhost:4311', SMS_MODE: 'dry-run',
    ENGINE_MODE: 'local', OPENSHORTS_HOME: openshorts,
    OPENSHORTS_PYTHON: process.env.OPENSHORTS_PYTHON || resolve(openshorts, '.venv/bin/python'),
    ENGINE_WORK_DIR: resolve(runtime, 'jobs') };
  // Local setup must never accidentally pick up a hosted messaging/model credential.
  for (const key of Object.keys(env)) {
    if (/^(TWILIO_|GEMINI_API_KEY$|GOOGLE_API_KEY$|GOOGLE_APPLICATION_CREDENTIALS$)/.test(key)) delete env[key];
  }
  const owner = {
    VITE_FIREBASE_API_KEY: 'demo-key', VITE_FIREBASE_PROJECT_ID: project,
    VITE_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`, VITE_API_BASE_URL: env.API_BASE_URL,
    VITE_FIREBASE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099', VITE_DEMO_MODE: 'false' };
  // Vite variables below are public configuration, never backend secrets.
  writeFileSync(resolve(root, 'owner-app/.env.local'), Object.entries(owner).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  const candidates = ['/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'];
  if (!env.JAVA_HOME && candidates.some(existsSync)) env.JAVA_HOME = candidates.find(existsSync);
  if (env.JAVA_HOME) env.PATH = `${env.JAVA_HOME}/bin:${env.PATH}`;
  return env;
}

function run(bin, args, cwd = root, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${bin} exited ${code}`)));
  });
}

function service(name, bin, args, env) {
  const log = createWriteStream(resolve(runtime, `${name}.log`), { flags: 'a', mode: 0o600 });
  const child = spawn(bin, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.push(child);
  child.stdout.pipe(log); child.stderr.pipe(log);
  child.on('error', error => { console.error(`${name}: ${error.message}`); shutdown(1); });
  child.on('exit', code => { if (!stopping) { console.error(`${name} stopped (${code}). See .runtime/${name}.log`); shutdown(1); } });
  return child;
}

async function healthy(url) {
  try { const result = await fetch(url, { signal: AbortSignal.timeout(1500) }); return result.ok; }
  catch { return false; }
}

async function waitFor(url, seconds = 120) {
  const deadline = Date.now() + seconds * 1000;
  while (!stopping && Date.now() < deadline) {
    if (await healthy(url)) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Service did not become ready: ${url}. Check .runtime logs.`);
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(cronTimer);
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  setTimeout(() => process.exit(code), 1500);
}
process.on('SIGINT', () => shutdown()); process.on('SIGTERM', () => shutdown());

try {
  const env = configuration();
  if (command === 'setup') {
    await run('npm', ['ci', '--ignore-scripts'], resolve(root, 'firebase-api'));
    await run('npm', ['ci', '--ignore-scripts'], resolve(root, 'owner-app'));
    await run('bash', ['scripts/setup-openshorts.sh'], root, env);
    console.log('Local dependencies and public app configuration are ready. Run npm run dev.');
  } else if (command === 'config') {
    console.log('Local configuration written. Secrets are in ignored .runtime/local-env.json.');
  } else if (command === 'start') {
    if (!existsSync(resolve(root, 'firebase-api/node_modules')) || !existsSync(resolve(root, 'owner-app/node_modules'))) {
      throw new Error('Run npm run setup first.');
    }
    if (!await healthy('http://127.0.0.1:4400/emulators')) {
      const args = ['-y', 'firebase-tools@latest', 'emulators:start', '--only', 'auth,firestore,storage',
        '--project', project, '--non-interactive', '--export-on-exit', resolve(runtime, 'firebase-data')];
      if (existsSync(resolve(runtime, 'firebase-data/firebase-export-metadata.json'))) args.push('--import', resolve(runtime, 'firebase-data'));
      service('emulators', 'npx', args, env);
      await waitFor('http://127.0.0.1:4400/emulators');
    }
    if (await healthy(`${env.API_BASE_URL}/health`)) {
      const health = await (await fetch(`${env.API_BASE_URL}/health`)).json();
      if (health.project_id !== project) throw new Error('Port 4310 belongs to another backend. Stop it before local testing.');
    } else {
      service('api', 'npm', ['--prefix', 'firebase-api', 'run', 'dev'], env);
      await waitFor(`${env.API_BASE_URL}/health`);
    }
    if (!await healthy('http://127.0.0.1:4311/')) {
      service('owner', 'npm', ['--prefix', 'owner-app', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '4311', '--strictPort'], env);
      await waitFor('http://127.0.0.1:4311/');
    }
    if (!process.argv.includes('--no-worker')) {
      if (!existsSync(env.OPENSHORTS_PYTHON)) throw new Error('Run setup-openshorts.sh or set OPENSHORTS_HOME to the pinned installed checkout.');
      service('worker', env.OPENSHORTS_PYTHON, ['engine-worker/contentstation_worker.py'], env);
    }
    let ticking = false;
    cronTimer = setInterval(async () => {
      if (ticking || stopping) return;
      ticking = true;
      try {
        const response = await fetch(`${env.API_BASE_URL}/internal/cron/tick`, {
          method: 'POST', headers: { 'x-cron-secret': env.CRON_SECRET }, signal: AbortSignal.timeout(55000) });
        if (!response.ok) console.error(`Local maintenance returned HTTP ${response.status}.`);
      } catch { console.error('Local maintenance could not reach the API.'); }
      finally { ticking = false; }
    }, 60000);
    console.log('Owner app: http://127.0.0.1:4311/');
    console.log('Firebase emulator: http://127.0.0.1:4000/');
    console.log('Local data and real clip rendering; SMS/model calls disabled. Ctrl+C stops services started here.');
    await new Promise(() => {});
  } else throw new Error('Use setup, config or start.');
} catch (error) { console.error(error.message); shutdown(1); }
