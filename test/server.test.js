import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server.js';

describe('HTTP server', () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /health returns 200 with status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });

  it('GET /tasks returns 200 with an array of 2 tasks', async () => {
    const res = await fetch(`${baseUrl}/tasks`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body), 'response should be an array');
    assert.equal(body.length, 2);
    assert.ok(body[0].id);
    assert.ok(body[0].title);
    assert.ok(body[0].type);
  });

  it('POST /tasks returns 201 with a task containing a uuid id', async () => {
    const res = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test task', type: 'code' }),
    });
    assert.equal(res.status, 201);
    const task = await res.json();
    assert.ok(task.id, 'task should have an id');
    assert.equal(task.title, 'Test task');
    assert.equal(task.type, 'code');
  });

  it('POST /tasks returns 400 when title or type is missing', async () => {
    const res = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'code' }),
    });
    assert.equal(res.status, 400);
  });
});
