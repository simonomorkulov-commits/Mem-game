import { authenticatedFetch } from './player-session.js';
import { createProfileUI } from './player-profile.js';
export { authenticatedFetch } from './player-session.js';
const $ = id => document.getElementById(id);
export async function requestAPI(path, options = {}, token) {
  const headers = new Headers(options.headers); if (typeof options.body === 'string') headers.set('Content-Type', 'application/json');
  if (token) headers.set('X-Game-Token', token);
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { response = await authenticatedFetch(path, { ...options, headers, cache: 'no-store' }); break; }
    catch { if (attempt) throw Error('Нет соединения. Проверь интернет и попробуй ещё раз.'); }
  }
  let data; try { data = await response.json(); } catch { throw Error('Сервер пока не отвечает. Попробуй ещё раз.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Не удалось сохранить изменения.'), { status: response.status });
  return data;
}
export const startRun = () => requestAPI('/api/runs', { method: 'POST', body: '{}' });
export async function answerRun(run, index) {
  const data = await requestAPI(`/api/runs/${run.runId}/answer`, { method: 'POST', body: JSON.stringify({
    optionId: run.challenge.options[index].id, revision: run.revision, requestId: crypto.randomUUID() }) }, run.token);
  return { ...data, token: run.token };
}
export async function currentRun(run) { return { ...(run.next || await requestAPI('/api/runs/' + run.runId, {}, run.token)), token: run.token }; }
export const finishRun = run => requestAPI(`/api/runs/${run.runId}/finish`, { method: 'POST', body: '{}' }, run.token);

export function initAccountUI(options) { return createProfileUI({ ...options, api: requestAPI }); }
