/**
 * What the pet knows about the Claude Code sessions running on this machine. Pure logic, like Pet:
 * it is fed the reports of Claude Code's hooks (scripts/claude-hook.mjs posts them to the pet) and
 * answers with what changed. A report is a session's id, name and folder and what just happened;
 * no prompt, tool call or answer ever gets here.
 */

/**
 * idle: open, nothing asked yet. working: Claude is on a turn. waiting: it needs the user (a
 * permission prompt or a question). done: the turn is finished.
 */
export type SessionStatus = 'idle' | 'working' | 'waiting' | 'done';

export interface Session {
  id: string;
  /**
   * What the pet calls it: the session's name in the Claude app ("CAT repository clone") once a
   * report carries one; until then the folder name of its working directory, numbered when two
   * sessions share a folder.
   */
  label: string;
  /** `label` is the session's own name, not the folder's. */
  named: boolean;
  status: SessionStatus;
  /** Why it waits. Only meaningful while status is 'waiting'. */
  waitingFor: 'permission' | 'answer';
  /** The turn ended on an error instead of an answer. Only meaningful while status is 'done'. */
  failed: boolean;
  /** Date.now() when the status last changed. */
  since: number;
  /** Date.now() of the last report from it. */
  heardAt: number;
}

export type SessionChange =
  | { kind: 'working' | 'waiting' | 'done' | 'failed'; session: Session }
  | { kind: 'ended'; session: Session };

/** Words the pet uses for sessions; a pack overrides any of them in the `claude` section of pet.json. */
export interface ClaudeText {
  /** Bubbles. {project} is the session's label. */
  done: string;
  failed: string;
  permission: string;
  waiting: string;
  /** Menu words, one per status. */
  statusWorking: string;
  statusWaiting: string;
  statusDone: string;
  statusFailed: string;
  statusIdle: string;
}

export const DEFAULT_CLAUDE_TEXT: ClaudeText = {
  done: '{project}: done',
  failed: '{project}: stopped on an error',
  permission: '{project}: needs your OK',
  waiting: '{project}: waiting for you',
  statusWorking: 'working',
  statusWaiting: 'waiting for you',
  statusDone: 'done',
  statusFailed: 'error',
  statusIdle: 'idle',
};

const MAX_ID = 128;
const MAX_LABEL = 60;
/** Most sessions the pet keeps track of; a flood of made-up ids cannot grow the list without end. */
const MAX_SESSIONS = 50;

/** Notification types that mean Claude cannot go on without the user. */
const ASKING = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);

const ORDER: Record<SessionStatus, number> = { waiting: 0, working: 1, done: 2, idle: 3 };

/** A name fit for the menu and the bubble: one line, no control characters, not endless. '' if nothing is left. */
function cleanName(name: unknown): string {
  if (typeof name !== 'string') return '';
  // A hook report is outside input.
  const clean = name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return clean.length > MAX_LABEL ? `${clean.slice(0, MAX_LABEL - 1)}…` : clean;
}

/** Folder name of a working directory, whichever slashes it uses. */
export function projectName(cwd: unknown): string {
  if (typeof cwd !== 'string') return 'Claude';
  const name = cwd
    .split(/[\\/]+/)
    .filter((part) => part !== '')
    .pop();
  return cleanName(name) || 'Claude';
}

/** "45s", "12m", "1h 05m". */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** The pack's word for a session's status. */
export function statusWord(session: Session, text: ClaudeText): string {
  if (session.status === 'done') return session.failed ? text.statusFailed : text.statusDone;
  return { working: text.statusWorking, waiting: text.statusWaiting, idle: text.statusIdle }[session.status];
}

/**
 * One session as a menu row: "●  SFNEX · working · 3m".
 * @param now Date.now() to add how long it has been in its status, or null to leave that out
 */
export function sessionRow(session: Session, text: ClaudeText, now: number | null): string {
  const mark = session.status === 'done' ? (session.failed ? '✗' : '✓') : { working: '●', waiting: '!', idle: '○' }[session.status];
  const age = now === null ? '' : ` · ${formatAge(now - session.since)}`;
  return `${mark}  ${session.label} · ${statusWord(session, text)}${age}`;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /** Those that need the user first, then the busy ones, then the rest; longest in its status first. */
  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.since - b.since);
  }

  /**
   * Takes one hook report (the hook's JSON, or the few fields the forwarder keeps of it).
   * @returns what changed, or null when the report changes nothing worth telling.
   */
  apply(report: unknown, now: number): SessionChange | null {
    if (typeof report !== 'object' || report === null) return null;
    const r = report as Record<string, unknown>;
    const id = r['session_id'];
    const event = r['hook_event_name'];
    if (typeof id !== 'string' || id === '' || id.length > MAX_ID || typeof event !== 'string') return null;

    if (event === 'SessionEnd') {
      const gone = this.sessions.get(id);
      if (!gone) return null;
      this.sessions.delete(id);
      return { kind: 'ended', session: gone };
    }

    // A first report of any kind opens the session: that is also how one that was already open
    // when the pet started shows up.
    const known = this.sessions.get(id);
    if (!known && this.sessions.size >= MAX_SESSIONS) return null;
    const session: Session = known ?? {
      id,
      label: this.labelFor(r['cwd']),
      named: false,
      status: 'idle',
      waitingFor: 'answer',
      failed: false,
      since: now,
      heardAt: now,
    };
    this.sessions.set(id, session);
    session.heardAt = now;
    // The name can arrive late (the app names a new session during its first turn) and can change.
    // A report without one says nothing about it: the last name heard stays.
    const title = cleanName(r['session_title']);
    if (title !== '') {
      session.label = title;
      session.named = true;
    }

    const set = (status: SessionStatus): boolean => {
      if (session.status === status) return false;
      session.status = status;
      session.since = now;
      return true;
    };

    switch (event) {
      case 'UserPromptSubmit':
      case 'PreToolUse':
      case 'PostToolUse':
      case 'PostToolUseFailure':
        // A tool that ran also means a permission prompt was answered.
        return set('working') ? { kind: 'working', session } : null;

      case 'Notification': {
        const type = r['notification_type'];
        const asking = typeof type === 'string' && ASKING.has(type);
        // idle_prompt after a finished turn says nothing new; after an interrupted one (no Stop
        // is reported for those) it is the only sign that Claude is no longer working.
        const stalled = type === 'idle_prompt' && session.status === 'working';
        if (!asking && !stalled) return null;
        const waitingFor = type === 'permission_prompt' ? 'permission' : 'answer';
        const changed = set('waiting') || session.waitingFor !== waitingFor;
        session.waitingFor = waitingFor;
        return changed ? { kind: 'waiting', session } : null;
      }

      case 'Stop':
      case 'StopFailure': {
        const failed = event === 'StopFailure';
        const changed = set('done') || session.failed !== failed;
        session.failed = failed;
        return changed ? { kind: failed ? 'failed' : 'done', session } : null;
      }

      default:
        // SessionStart (including the one after a compaction, mid-turn), SubagentStop and anything
        // newer: the session is alive, its status is unchanged.
        return null;
    }
  }

  /** Forgets sessions not heard from for `maxSilenceMs`: closed without a SessionEnd. */
  prune(now: number, maxSilenceMs: number): SessionChange[] {
    const ended: SessionChange[] = [];
    for (const [id, session] of this.sessions) {
      if (now - session.heardAt < maxSilenceMs) continue;
      this.sessions.delete(id);
      ended.push({ kind: 'ended', session });
    }
    return ended;
  }

  private labelFor(cwd: unknown): string {
    const name = projectName(cwd);
    const taken = new Set([...this.sessions.values()].filter((s) => !s.named).map((s) => s.label));
    if (!taken.has(name)) return name;
    for (let n = 2; ; n++) {
      if (!taken.has(`${name} #${n}`)) return `${name} #${n}`;
    }
  }
}
