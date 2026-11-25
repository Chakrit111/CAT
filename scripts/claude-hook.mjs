// Claude Code runs this for the hooks that `npm run claude-hooks -- install` registers. It tells
// the pet what a session is doing: started, working, waiting for you, done, closed.
//
// It is an observer only. It prints nothing (Claude Code would read stdout of some hooks as
// context), always exits 0, and gives up after a moment if the pet is not running.
//
// What it passes on is the session's id and name, the event's name, the working directory, the
// kind of notification, the name of the tool in use (not what it was given or returned), the
// Claude desktop app's id for the session and the opening of Claude's final answer, for the pet's
// bubble. It goes to the pet on this machine only
// (127.0.0.1). The prompt and everything else in the report never leave this process.
//
//   node scripts/claude-hook.mjs [port]      (the report arrives on stdin)
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import http from 'node:http';

const port = Number(process.env.PET_CLAUDE_PORT) || Number(process.argv[2]) || 47625;
const KEEP = ['session_id', 'hook_event_name', 'cwd', 'notification_type', 'session_title', 'tool_name', 'last_assistant_message', 'app_session_id'];
/** The pet shows one line of the answer: the opening is all it is sent. */
const ANSWER_OPENING = 600;

/** A title record in a session's transcript, at the start of a line. */
const TITLE_RECORD = '\n{"type":"custom-title"';
/** How far back from the end of the transcript to look: a short stretch first, then a long one. */
const TITLE_SPANS = [256 * 1024, 8 * 1024 * 1024];

/**
 * The session's name as the Claude app shows it in its list ("CAT repository clone"). Some reports
 * carry it; the others only say where the transcript is, and the app writes the name there every
 * time it changes. Only that one record is read. The transcript's format is the app's own business
 * and may change: then there is no name, and the pet falls back to the folder's.
 */
function sessionTitle(report) {
  if (typeof report.session_title === 'string' && report.session_title.trim() !== '') return report.session_title;
  if (typeof report.transcript_path !== 'string') return undefined;
  let fd;
  try {
    fd = openSync(report.transcript_path, 'r');
    const { size } = fstatSync(fd);
    for (const span of TITLE_SPANS) {
      const length = Math.min(size, span);
      const tail = Buffer.alloc(length);
      readSync(fd, tail, 0, length, size - length);
      const text = `\n${tail.toString('utf8')}`;
      // The newest record that reads: the very last one may still be half written.
      for (let at = text.lastIndexOf(TITLE_RECORD); at !== -1; at = at === 0 ? -1 : text.lastIndexOf(TITLE_RECORD, at - 1)) {
        const end = text.indexOf('\n', at + 1);
        try {
          const title = JSON.parse(text.slice(at + 1, end === -1 ? undefined : end)).customTitle;
          if (typeof title === 'string' && title.trim() !== '') return title;
        } catch {
          // try the one before
        }
      }
      if (length === size) break;
    }
  } catch {
    // No transcript yet, or a record still being written: no name this time.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return undefined;
}

const done = () => process.exit(0);
setTimeout(done, 1500).unref();

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('error', done);
process.stdin.on('end', () => {
  let report;
  try {
    report = JSON.parse(input);
  } catch {
    return done();
  }
  if (typeof report !== 'object' || report === null) return done();
  report.session_title = sessionTitle(report);
  // A session of the Claude desktop app runs its hooks with the app's own id for it: with that the
  // pet's menu can open the session in the app. A session in a terminal has none.
  const appSession = process.env.CLAUDE_CODE_HOST_SESSION_ID;
  report.app_session_id = typeof appSession === 'string' && /^local_[A-Za-z0-9-]{1,64}$/.test(appSession) ? appSession : undefined;
  if (typeof report.last_assistant_message === 'string') {
    report.last_assistant_message = report.last_assistant_message.trimStart().slice(0, ANSWER_OPENING);
  }
  const body = JSON.stringify(Object.fromEntries(KEEP.filter((key) => typeof report[key] === 'string').map((key) => [key, report[key]])));
  const request = http.request(
    {
      host: '127.0.0.1',
      port,
      path: '/event',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 800,
    },
    (response) => {
      response.resume();
      response.on('end', done);
    },
  );
  request.on('timeout', () => request.destroy());
  request.on('error', done); // the pet is not running: nothing to tell
  request.end(body);
});
