import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { Logger } from './index.js';

/** Creates a Writable that collects all written chunks into a string. */
function makeCapture() {
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) { buf += chunk.toString(); cb(); },
  });
  return { stream, output: () => buf };
}

describe('Logger', () => {
  let savedDebug;
  beforeEach(() => { savedDebug = process.env.DEBUG; delete process.env.DEBUG; });
  afterEach(()  => {
    if (savedDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = savedDebug;
  });

  test('INFO writes ISO timestamp, tag, level, and message', () => {
    const { stream, output } = makeCapture();
    new Logger('test', stream).info('hello');
    const line = output();
    assert.match(line, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/);
    assert.ok(line.includes('[test]'));
    assert.ok(line.includes('INFO'));
    assert.ok(line.includes('hello'));
  });

  test('WARN writes correctly', () => {
    const { stream, output } = makeCapture();
    new Logger('test', stream).warn('watch out');
    assert.ok(output().includes('WARN'));
    assert.ok(output().includes('watch out'));
  });

  test('ERROR writes correctly', () => {
    const { stream, output } = makeCapture();
    new Logger('test', stream).error('boom');
    assert.ok(output().includes('ERROR'));
    assert.ok(output().includes('boom'));
  });

  test('DEBUG is suppressed when process.env.DEBUG is not set', () => {
    const { stream, output } = makeCapture();
    new Logger('test', stream).debug('secret');
    assert.equal(output(), '');
  });

  test('DEBUG writes when process.env.DEBUG is set', () => {
    process.env.DEBUG = '1';
    const { stream, output } = makeCapture();
    new Logger('test', stream).debug('visible');
    assert.ok(output().includes('DEBUG'));
    assert.ok(output().includes('visible'));
  });

  test('single extra arg is serialized as a JSON object (not array)', () => {
    const { stream, output } = makeCapture();
    new Logger('test', stream).info('msg', { code: 42 });
    assert.ok(output().includes('{"code":42}'));
  });

  test('multiple extra args are serialized as a JSON array', () => {
    const { stream, output } = makeCapture();
    new Logger('test', stream).info('msg', 'a', 'b');
    assert.ok(output().includes('["a","b"]'));
  });

  test('child() produces parent:child tag', () => {
    const { stream, output } = makeCapture();
    new Logger('orchestrator', stream).child('T1').info('hi');
    assert.ok(output().includes('[orchestrator:T1]'));
  });

  test('child logger shares the same stream as parent', () => {
    const { stream, output } = makeCapture();
    const parent = new Logger('root', stream);
    parent.child('sub').warn('shared');
    assert.ok(output().includes('shared'));
    assert.ok(output().includes('[root:sub]'));
  });
});
