/**
 * Structured Logger — writes only to stderr to protect MCP JSON-RPC stdout.
 *
 * Format: ISO-TS [Tag] LEVEL message {args}
 * Levels: INFO, WARN, ERROR, DEBUG (DEBUG requires process.env.DEBUG to be set)
 */

export class Logger {
  /**
   * @param {string} tag
   * @param {import('node:stream').Writable} [stream]
   */
  constructor(tag, stream = process.stderr) {
    this._tag    = tag;
    this._stream = stream;
  }

  _write(level, message, args) {
    if (level === 'DEBUG' && !process.env.DEBUG) return;
    const ts       = new Date().toISOString();
    const argsPart = args.length
      ? ' ' + JSON.stringify(args.length === 1 ? args[0] : args)
      : '';
    this._stream.write(`${ts} [${this._tag}] ${level} ${message}${argsPart}\n`);
  }

  info (msg, ...args) { this._write('INFO',  msg, args); }
  warn (msg, ...args) { this._write('WARN',  msg, args); }
  error(msg, ...args) { this._write('ERROR', msg, args); }
  debug(msg, ...args) { this._write('DEBUG', msg, args); }

  /**
   * Returns a child logger with tag `parent:childTag`, sharing the same stream.
   * @param {string} childTag
   */
  child(childTag) {
    return new Logger(`${this._tag}:${childTag}`, this._stream);
  }
}

export default new Logger('app');
