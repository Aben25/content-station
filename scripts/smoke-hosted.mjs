// Explicit hosted pilot test. Uses only preconfigured fictional phone numbers.
// Credentials and resumable test state stay in ignored .runtime/deploy/.
import { readFileSync, writeFileSync, mkdirSync, statSync, createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const argument = name => args[args.indexOf(name) + 1];
if (!args.includes('--project') || argument('--project') !== 'lemekeru') throw new Error('Pass --project lemekeru to target the authorized hosted pilot.');
const base = 'https://contentstation-api-233122534259.us-central1.run.app';
const apiKey = 'AIzaSyAFxKYI_ViLFAxjk2b1EcCn2B9ctYvn6-E';
const dir = resolve('.runtime/deploy');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const codes = JSON.parse(readFileSync(`${dir}/test-phones.json`, 'utf8'));
const phase = args.includes('--phase') ? argument('--phase') : 'upload';
const fixturePrefix = args.includes('--deletion-fixture') ? 'deletion-' : '';
const statePath = `${dir}/${fixturePrefix}hosted-smoke-state.json`;

async function json(url, method = 'GET', body, token) {
  const response = await fetch(url.startsWith('https://') ? url : base + url, {
    method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`${method} ${new URL(response.url).pathname}: HTTP ${response.status} ${(await response.text()).slice(0, 500)}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function signIn(phone) {
  const sent = await json(`https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${apiKey}`, 'POST', { phoneNumber: phone, recaptchaToken: 'test' });
  const result = await json(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${apiKey}`, 'POST', { sessionInfo: sent.sessionInfo, code: codes[phone] });
  return result.idToken;
}
async function upload(url, file, type) {
  if (new URL(url).origin !== new URL(base).origin) throw new Error('Unexpected media origin');
  const response = await fetch(url, { method: 'PUT', headers: { 'content-type': type, 'content-length': String(statSync(file).size) }, body: createReadStream(file), duplex: 'half', signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`Upload HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
}
function probe(file) {
  const data = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
  const video = data.streams.find(s => s.codec_type === 'video');
  return { duration: Number(data.format.duration), width: video.width, height: video.height };
}
const health = await json('/health');
if (health.project_id !== 'lemekeru' || health.emulator) throw new Error('Wrong backend');
const phone = fixturePrefix ? '+14155550197' : '+14155550198';
const token = await signIn(phone);
if (phase === 'upload') {
  if (!args.includes('--input')) throw new Error('Supply --input with authorized test footage');
  const source = resolve(argument('--input'));
  const media = probe(source);
  const me = await json('/me', 'GET', undefined, token);
  if (!me.shop) await json('/shops', 'POST', { name: 'ContentStation Cloud Test', type: 'detailing', timezone: 'America/Los_Angeles' }, token);
  const pair = await json('/pair/token', 'POST', { ssid: 'Cloud test fixture', password: 'fictional-wifi-password' }, token);
  const camera = await json('/pair/claim', 'POST', { pair_token: pair.pair_token, serial: `cloud-smoke-${randomUUID()}`, model: 'API capture simulator', app_version: 'hosted-test' });
  const now = Date.now();
  const stamps = { start_ts: new Date(now - media.duration * 1000).toISOString(), end_ts: new Date(now).toISOString() };
  const grant = await json('/device/segment/upload-url', 'POST', stamps, camera.device_jwt);
  await upload(grant.upload_url, source, 'video/mp4');
  const body = { ...stamps, path: grant.path, bytes: statSync(source).size, width: media.width, height: media.height, fps: 30 };
  const segment = await json('/device/segment/complete', 'POST', body, camera.device_jwt);
  const retry = await json('/device/segment/complete', 'POST', body, camera.device_jwt);
  if (JSON.stringify(segment) !== JSON.stringify(retry)) throw new Error('Duplicate completion changed the job');
  await json('/device/heartbeat', 'POST', { battery: 100, thermal: 'nominal', wifi: 'strong', storage_free_mb: 10000, state: 'idle', app_version: 'hosted-test', recording_seconds_today: Math.round(media.duration) }, camera.device_jwt);
  const state = { project: 'lemekeru', phone, source, input_bytes: body.bytes, input_seconds: media.duration, ...segment, camera, at: new Date().toISOString() };
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  console.log(JSON.stringify({ uploaded: true, input_bytes: body.bytes, input_seconds: media.duration, job_id: segment.job_id, duplicate_completion: 'passed' }, null, 2));
} else if (phase === 'preview') {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const file = `${dir}/${fixturePrefix}hosted-preview.jpg`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '5', '-i', state.source, '-frames:v', '1', '-vf', 'scale=960:-2', file]);
  await json('/camera/framing/start', 'POST', {}, token);
  for (const kind of ['preview', 'thumb']) {
    const response = await fetch(`${base}/device/${kind}`, {
      method: 'POST', headers: { authorization: `Bearer ${state.camera.device_jwt}`, 'content-type': 'image/jpeg' },
      body: readFileSync(file), signal: AbortSignal.timeout(60000),
    });
    if (response.status !== 204) throw new Error(`Test ${kind}: HTTP ${response.status}`);
  }
  console.log('Uploaded a preview from test footage; finish framing and hours in the owner website.');
} else if (phase === 'verify' || phase === 'delete') {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const me = await json('/me', 'GET', undefined, token);
  const expectedId = createHash('sha256').update(`v2/clips/${me.shop.id}/${state.job_id}/0.mp4`).digest('hex');
  let clip;
  for (let i = 0; i < 120; i++) {
    const home = await json('/clips', 'GET', undefined, token);
    const clips = home.clips || [];
    clip = clips.find(c => c.id === expectedId);
    if (clip) break;
    if (i % 6 === 0) console.log('Waiting for the deployed worker to return the test clip…');
    await new Promise(r => setTimeout(r, 5000));
  }
  if (!clip) throw new Error('No clip returned within ten minutes');
  clip = await json(`/clips/${clip.id}`, 'GET', undefined, token);
  const other = await signIn(fixturePrefix ? '+14155550198' : '+14155550197');
  let otherMe = await json('/me', 'GET', undefined, other);
  if (!otherMe.shop) {
    await json('/shops', 'POST', { name: 'ContentStation Isolation Test', type: 'other', timezone: 'America/Los_Angeles' }, other);
    otherMe = await json('/me', 'GET', undefined, other);
  }
  if (!otherMe.shop || otherMe.shop.id === me.shop.id) throw new Error('Isolation test requires two distinct shops');
  const denied = await fetch(`${base}/clips/${clip.id}`, { headers: { authorization: `Bearer ${other}` } });
  if (![403, 404].includes(denied.status)) throw new Error('Second owner was not denied');
  if ((await denied.json()).error?.code !== 'clip_missing') throw new Error('Isolation test did not reach clip ownership check');
  const video = await fetch(clip.video_url);
  if (!video.ok || !video.body) throw new Error('Rendered video unavailable');
  const file = `${dir}/${fixturePrefix}hosted-rendered.mp4`;
  await pipeline(Readable.fromWeb(video.body), createWriteStream(file, { mode: 0o600 }));
  const media = probe(file);
  execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { stdio: 'pipe' });
  if (media.width !== 1080 || media.height !== 1920) throw new Error('Unexpected output dimensions');
  const range = await fetch(clip.video_url, { headers: { range: 'bytes=0-1023' } });
  if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 1024) throw new Error('Video seek failed');
  await json(`/clips/${clip.id}`, 'PATCH', { caption: 'A real clip generated by ContentStation on Google Cloud. Test footage for review.' }, token);
  let deletion = 'retained for owner review';
  if (phase === 'delete') {
    await json(`/clips/${clip.id}`, 'DELETE', undefined, token);
    const oldMedia = await fetch(clip.video_url);
    if (![403, 404, 410].includes(oldMedia.status)) throw new Error('Deleted media capability still works');
    deletion = 'passed';
  }
  const result = { project: 'lemekeru', engine: 'OpenShorts on Google Cloud', selection: 'local motion heuristic', job_id: state.job_id, clip_id: clip.id, input_bytes: state.input_bytes, input_seconds: state.input_seconds, output_seconds: media.duration, width: media.width, height: media.height, sha256: createHash('sha256').update(readFileSync(file)).digest('hex'), full_decode: 'passed', range_playback: 'passed', owner_isolation: 'passed', duplicate_completion: 'passed', deletion, at: new Date().toISOString() };
  writeFileSync(`${dir}/${fixturePrefix}hosted-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} else throw new Error('Use --phase upload, preview, verify or delete');
