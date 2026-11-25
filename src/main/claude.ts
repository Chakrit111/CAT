import { BrowserWindow, type MenuItemConstructorOptions, type Rectangle } from 'electron';
import type { Server } from 'node:http';
import path from 'node:path';
import { IPC, type BubbleMessage, type BubbleTone, type FieldMessage, type MouseActivity } from '../shared/types';
import type { PetPack } from './pack';
import type { Pet } from './pet';
import { Prey } from './prey';
import { listenForReports } from './session-server';
import { formatAge, sessionRow, SessionStore, statusWord, type Session, type SessionChange } from './sessions';
import type { SoundName } from './sounds';

/** The bubble's window. The bubble itself is as wide as its words, up to this. */
const BUBBLE_WIDTH = 300;
/** Room for two lines of words and two of detail, and the tail. */
const BUBBLE_HEIGHT = 112;
/** Room in the strip of mice above the mouse squares, so a label never touches the strip's top edge. */
const LABEL_ROOM = 6;
const PRUNE_EVERY_MS = 60_000;
/** With more than one thing to say, each bubble gets this long before the next takes its turn. */
const BUBBLE_TURN_MS = 3_000;
/** Two mice's stretches of floor keep this far apart. */
const LANE_GAP = 8;

/**
 * What the user picked for the mice (the menu's "Session mice"). names: every mouse has its
 * session's name over it. quiet: only a session that waits for the user is named. hidden: no mice.
 */
export type MiceMode = 'names' | 'quiet' | 'hidden';
export const MICE_MODES: readonly MiceMode[] = ['names', 'quiet', 'hidden'];

export interface ClaudeHost {
  pack: PetPack;
  pet: Pet;
  play(name: SoundName): void;
  /** The list of sessions changed: a menu built ahead of time (the tray's) is out of date. */
  onChange(): void;
  /** Show this session in the Claude desktop app. `appId` is the app's own id for it. */
  openInApp(appId: string): void;
}

/** Where the pet is this tick. */
export interface PetBox {
  x: number;
  y: number;
  /** Empty rows above the pet in its current pose. */
  headroom: number;
}

interface Bubble {
  sessionId: string;
  text: string;
  /** A smaller second line; '' = none. */
  detail: string;
  tone: BubbleTone;
  /** How much longer it is to be shown. */
  ms: number;
}

/**
 * A session's mouse. stay: the session is at work. catch: its turn is done and the cat is to get
 * it. leave: it runs off by itself (the session was closed, or this pet does not hunt).
 */
interface Mouse {
  prey: Prey;
  label: string;
  note: string;
  activity: MouseActivity;
  waiting: boolean;
  fate: 'stay' | 'catch' | 'leave';
  /** The cat is after it: the pet moves it now. */
  hunted: boolean;
  /** Which stretch of the floor is its own, counted from the left. */
  lane: number;
}

/**
 * How every window of the pet asks to be on all desktops. Without skipTransformProcessType the
 * call also turns the app back into a regular Dock app on macOS, undoing app.dock.hide(), and the
 * windows of a regular app stay on the desktop (Space) they were opened on: only the first window
 * to ask, the pet's, would follow the user to another desktop.
 */
export const ON_ALL_DESKTOPS = { skipTransformProcessType: true } as const;

function overlayWindow(width: number, height: number): BrowserWindow {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setVisibleOnAllWorkspaces(true, ON_ALL_DESKTOPS);
  win.setIgnoreMouseEvents(true); // never in the way of a click
  return win;
}

/**
 * Claude Code sessions on the pet's screen (pet.json `features.claude`): a bubble over the pet when
 * a session finishes or needs the user, a mouse on the floor for every session at work, and the
 * list for the menus. Sessions report through Claude Code's hooks (see scripts/claude-hooks.mjs).
 */
export class ClaudeSessions {
  private readonly store = new SessionStore();
  private readonly server: Server;
  private readonly pruneTimer: NodeJS.Timeout;
  private readonly port: number;
  /** false once the port turned out to be taken. */
  private listening = true;
  private hidden = false;

  private readonly bubbleWin = overlayWindow(BUBBLE_WIDTH, BUBBLE_HEIGHT);
  private bubbleLoaded = false;
  private bubbleShown = false;
  private bubbleSent = '';
  private bubbleAt = '';
  private bubble: (Bubble & { since: number }) | null = null;
  private queue: Bubble[] = [];
  /** Sessions that wait for the user: when (performance.now()) to say so again, and how many times more. */
  private readonly reminders = new Map<string, { at: number; left: number }>();

  private readonly fieldWin: BrowserWindow;
  private fieldLoaded = false;
  private fieldShown = false;
  private fieldSent = '';
  private fieldAt = '';
  private readonly mice = new Map<string, Mouse>();
  /** The mice the floor was last shared out between. */
  private laneKey = '';
  /** Session mice exist only for pets that have a mouse at all; only a hunter catches them. */
  private readonly useMice: boolean;
  private readonly canCatch: boolean;
  private miceMode: MiceMode = 'names';

  constructor(private readonly host: ClaudeHost) {
    const { config, features } = host.pack;
    this.useMice = features.hunt;
    this.canCatch = features.hunt && config.runMode === 'hunt';
    this.fieldWin = overlayWindow(config.hunt.mouseSize, config.hunt.mouseSize + LABEL_ROOM);

    this.bubbleWin.webContents.once('did-finish-load', () => {
      this.bubbleLoaded = true;
    });
    this.fieldWin.webContents.once('did-finish-load', () => {
      this.fieldLoaded = true;
    });
    // The pet works without these, so a page that fails to load is only logged.
    this.bubbleWin.loadFile(path.join(__dirname, 'bubble.html')).catch((err: unknown) => {
      console.error('[claude] Failed to load the bubble window.', err);
    });
    this.fieldWin.loadFile(path.join(__dirname, 'field.html')).catch((err: unknown) => {
      console.error('[claude] Failed to load the session mice.', err);
    });

    // Development: PET_CLAUDE_PORT moves the port without touching pet.json (the hook reads it too).
    this.port = Number(process.env['PET_CLAUDE_PORT']) || config.claude.port;
    this.server = listenForReports(
      this.port,
      (report) => {
        const change = this.store.apply(report, Date.now());
        if (change) this.changed(change);
      },
      (err) => {
        this.listening = false;
        console.warn(`[claude] cannot listen on 127.0.0.1:${this.port} (${err.message}); sessions are off`);
        this.host.onChange();
      },
    );
    this.pruneTimer = setInterval(() => {
      for (const change of this.store.prune(Date.now(), config.claude.forgetMs)) this.changed(change);
    }, PRUNE_EVERY_MS);
    this.pruneTimer.unref();
  }

  /** True for a session's mouse: the strip draws it, not the hunt game's mouse window. */
  owns(prey: Prey | null): boolean {
    if (!prey) return false;
    for (const mouse of this.mice.values()) if (mouse.prey === prey) return true;
    return false;
  }

  /** Once per tick of the pet, after the pet itself has moved. */
  tick(dtMs: number, area: Rectangle, pet: PetBox): void {
    if (this.hidden) return;
    this.tickReminders();
    this.tickBubble(area, pet);
    if (this.useMice) this.tickMice(dtMs, area, pet.x + this.host.pack.config.size / 2);
  }

  /**
   * The sessions as menu rows, those that need the user first. A click opens the session in the
   * Claude desktop app; for one that runs in a terminal it repeats the session's bubble.
   * @param withAge how long each has been in its status; leave out for a menu that is built ahead
   *                of time and would show a stale figure
   */
  menuItems(withAge: boolean): MenuItemConstructorOptions[] {
    if (!this.listening) {
      return [{ label: `Claude sessions: port ${this.port} is in use`, enabled: false }, { type: 'separator' }];
    }
    const sessions = this.store.list();
    if (sessions.length === 0) return [{ label: 'No Claude sessions', enabled: false }, { type: 'separator' }];
    const now = Date.now();
    const text = this.host.pack.claudeText;
    return [
      { label: 'Claude sessions', enabled: false },
      ...sessions.map((session): MenuItemConstructorOptions => {
        return {
          label: sessionRow(session, text, withAge ? now : null),
          click: () => (session.appId !== '' ? this.host.openInApp(session.appId) : this.repeat(session)),
        };
      }),
      { type: 'separator' },
    ];
  }

  /** The user's choice for the mice; takes effect on the next tick. */
  setMice(mode: MiceMode): void {
    this.miceMode = mode;
  }

  /** True where a session's mouse stands: the hunt game's mouse does not stop to sniff there. */
  occupied(centerX: number): boolean {
    const reach = this.host.pack.config.hunt.mouseSize;
    for (const mouse of this.mice.values()) if (Math.abs(mouse.prey.centerX - centerX) < reach) return true;
    return false;
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (!hidden) return;
    // Nothing is said to a hidden pet, and nothing is saved up for when it comes back.
    this.queue = [];
    this.bubble = null;
    this.hideBubble();
    this.hideField();
  }

  dispose(): void {
    clearInterval(this.pruneTimer);
    this.server.close();
    if (!this.bubbleWin.isDestroyed()) this.bubbleWin.destroy();
    if (!this.fieldWin.isDestroyed()) this.fieldWin.destroy();
  }

  // --- what the pet says ------------------------------------------------------

  private changed(change: SessionChange): void {
    const { session } = change;
    const { claudeText: text, config } = this.host.pack;
    console.log(`[claude] ${session.label}: ${change.kind}${session.appId !== '' ? ' (Claude app)' : ''}`);
    // Whatever was said or about to be said of this session is old news now.
    this.queue = this.queue.filter((bubble) => bubble.sessionId !== session.id);
    if (this.bubble?.sessionId === session.id) this.bubble = null;

    const { remindMs, remindMax } = config.claude;
    if (change.kind === 'waiting' && remindMs > 0 && remindMax > 0) {
      this.reminders.set(session.id, { at: performance.now() + remindMs, left: remindMax });
    } else {
      this.reminders.delete(session.id);
    }

    switch (change.kind) {
      case 'done':
        this.say(session, text.done, 'done', config.claude.bubbleMs, this.summary(session));
        this.host.play('meow');
        break;
      case 'failed':
        this.say(session, text.failed, 'failed', config.claude.bubbleMs);
        this.host.play('annoyed');
        break;
      case 'waiting':
        this.say(session, session.waitingFor === 'permission' ? text.permission : text.waiting, 'waiting', config.claude.waitingBubbleMs);
        this.host.play('question');
        break;
      case 'working':
      case 'ended':
        break; // the mouse says it
    }
    this.host.onChange();
  }

  private say(session: Session, template: string, tone: BubbleTone, ms: number, detail = ''): void {
    if (this.hidden) return;
    const text = template.replaceAll('{project}', session.label).replaceAll('{age}', formatAge(Date.now() - session.since));
    this.queue.push({ sessionId: session.id, text, detail, tone, ms });
  }

  /** How the session's answer began, as the bubble's second line; '' when that is off or unknown. */
  private summary(session: Session): string {
    const max = this.host.pack.config.claude.summaryMax;
    if (max <= 0 || session.failed) return '';
    return session.summary.length > max ? `${session.summary.slice(0, max - 1).trimEnd()}…` : session.summary;
  }

  /** A session still waiting for the user is said again now and then, with the sound: the first bubble is easy to miss. */
  private tickReminders(): void {
    if (this.reminders.size === 0) return;
    const now = performance.now();
    const { claudeText: text, config } = this.host.pack;
    for (const [id, reminder] of this.reminders) {
      if (now < reminder.at) continue;
      const session = this.store.get(id);
      if (!session || session.status !== 'waiting') {
        this.reminders.delete(id);
        continue;
      }
      this.queue = this.queue.filter((bubble) => bubble.sessionId !== id);
      this.say(session, text.reminder, 'waiting', config.claude.bubbleMs);
      this.host.play('question');
      reminder.left -= 1;
      reminder.at = now + config.claude.remindMs;
      if (reminder.left <= 0) this.reminders.delete(id);
    }
  }

  /** From the menu: the session's status once more, as a bubble. */
  private repeat(session: Session): void {
    const { claudeText: text, config } = this.host.pack;
    const template =
      session.status === 'done'
        ? session.failed
          ? text.failed
          : text.done
        : session.status === 'waiting'
          ? session.waitingFor === 'permission'
            ? text.permission
            : text.waiting
          : `{project}: ${statusWord(session, text)}`;
    const tone: BubbleTone = session.status === 'waiting' ? 'waiting' : session.status === 'done' && session.failed ? 'failed' : 'done';
    this.queue = this.queue.filter((bubble) => bubble.sessionId !== session.id);
    this.bubble = null;
    this.say(session, template, tone, config.claude.bubbleMs, session.status === 'done' ? this.summary(session) : '');
  }

  private tickBubble(area: Rectangle, pet: PetBox): void {
    const now = performance.now();
    if (this.bubble) {
      const shown = now - this.bubble.since;
      if (shown >= this.bubble.ms) {
        this.bubble = null;
      } else if (this.queue.length > 0 && shown >= BUBBLE_TURN_MS) {
        // Something else to say: this one steps back and returns for the rest of its time.
        const { sessionId, text, detail, tone, ms } = this.bubble;
        this.queue.push({ sessionId, text, detail, tone, ms: ms - shown });
        this.bubble = null;
      }
    }
    if (!this.bubble) {
      const next = this.queue.shift();
      if (next) this.bubble = { ...next, since: now };
    }
    const win = this.bubbleWin;
    if (win.isDestroyed()) return;
    if (!this.bubble || !this.bubbleLoaded) {
      this.hideBubble();
      return;
    }

    // Over the pet's head, pushed back inside the screen; the tail still points at the pet.
    const middle = pet.x + this.host.pack.config.size / 2;
    const x = Math.round(Math.min(Math.max(middle - BUBBLE_WIDTH / 2, area.x), Math.max(area.x, area.x + area.width - BUBBLE_WIDTH)));
    const y = Math.round(Math.max(area.y, pet.y + pet.headroom - BUBBLE_HEIGHT + 2));
    const at = `${x}:${y}`;
    if (at !== this.bubbleAt) {
      win.setBounds({ x, y, width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT });
      this.bubbleAt = at;
    }
    const msg: BubbleMessage = { text: this.bubble.text, detail: this.bubble.detail, tone: this.bubble.tone, tail: Math.round(middle - x) };
    const sent = `${msg.tone}:${msg.tail}:${msg.text}\n${msg.detail}`;
    if (sent !== this.bubbleSent) {
      win.webContents.send(IPC.bubble, msg);
      this.bubbleSent = sent;
    }
    if (!this.bubbleShown) {
      win.showInactive();
      this.bubbleShown = true;
    }
  }

  private hideBubble(): void {
    if (!this.bubbleShown || this.bubbleWin.isDestroyed()) return;
    this.bubbleWin.hide();
    this.bubbleShown = false;
    this.bubbleAt = '';
  }

  // --- a mouse per session ----------------------------------------------------

  private tickMice(dtMs: number, area: Rectangle, catCenterX: number): void {
    const { pet, pack } = this.host;
    const { hunt, claude, size } = pack.config;
    const penMargin = Math.max(0, (size - hunt.mouseSize) / 2);

    // Sessions at work get a mouse; a mouse whose session stopped gets its fate.
    const now = Date.now();
    for (const session of this.store.list()) {
      const atWork = session.status === 'working' || session.status === 'waiting';
      let mouse = this.mice.get(session.id);
      if (atWork && this.miceMode !== 'hidden') {
        if (!mouse) {
          mouse = {
            // Penned: it keeps clear of the edges by as much as the pet's own half-width, so a pounce can reach it.
            prey: new Prey(hunt, area, catCenterX, Math.random, {
              margin: penMargin,
              fleeSpeed: claude.mouseFleeSpeed,
              enter: this.entrance(area, catCenterX),
            }),
            label: '',
            note: '',
            activity: 'none',
            waiting: false,
            fate: 'stay',
            hunted: false,
            lane: 0,
          };
          this.mice.set(session.id, mouse);
        } else if (!mouse.hunted && mouse.fate !== 'stay') {
          // Back at work before the cat got to it, or before it reached the edge.
          mouse.fate = 'stay';
          mouse.prey.lure();
        }
        mouse.waiting = session.status === 'waiting' && mouse.fate === 'stay' && !mouse.hunted;
        mouse.prey.frozen = mouse.waiting;
        // Every tick: the session's name can arrive, or change, while its mouse is out.
        const named = this.miceMode === 'names' || mouse.waiting;
        mouse.label = !named ? '' : session.label.length > claude.labelMax ? `${session.label.slice(0, claude.labelMax - 1)}…` : session.label;
        mouse.note = named ? formatAge(now - session.turnSince, true) : '';
        mouse.activity = named && session.status === 'working' ? session.activity : 'none';
      } else if (mouse && mouse.fate === 'stay') {
        // Its turn is over, or the user wants no mice.
        this.release(mouse, !atWork && session.status === 'done' && !session.failed && this.canCatch ? 'catch' : 'leave');
      }
    }
    for (const [id, mouse] of this.mice) {
      if (mouse.fate === 'stay' && !this.store.has(id)) this.release(mouse, 'leave'); // closed while at work
    }

    this.shareFloor(area, penMargin);

    for (const [id, mouse] of this.mice) {
      if (mouse.hunted) {
        // The pet moves the mouse it is after; once it lets go, the mouse was caught or got away.
        if (pet.prey !== mouse.prey) this.mice.delete(id);
        continue;
      }
      if (mouse.fate === 'catch' && pet.hunt(mouse.prey)) {
        mouse.hunted = true;
        continue;
      }
      if (!mouse.prey.update(dtMs, area, catCenterX)) this.mice.delete(id);
    }

    const win = this.fieldWin;
    if (win.isDestroyed()) return;
    if (this.mice.size === 0 || !this.fieldLoaded) {
      this.hideField();
      return;
    }
    // One strip along the floor of the pet's screen holds every mouse.
    const height = hunt.mouseSize + LABEL_ROOM;
    const bounds = { x: area.x, y: area.y + area.height - height, width: area.width, height };
    const at = `${bounds.x}:${bounds.y}:${bounds.width}`;
    if (at !== this.fieldAt) {
      win.setBounds(bounds);
      this.fieldAt = at;
    }
    const msg: FieldMessage = {
      size: hunt.mouseSize,
      labelHeight: LABEL_ROOM,
      mice: [...this.mice.values()].map((mouse) => ({
        x: Math.round((mouse.prey.x - area.x) * 2) / 2,
        flip: mouse.prey.facing === -1,
        moving: mouse.prey.moving,
        label: mouse.label,
        note: mouse.note,
        activity: mouse.activity,
        waiting: mouse.waiting,
        lane: mouse.prey.lane
          ? [Math.round(mouse.prey.lane.lo - area.x), Math.round(mouse.prey.lane.hi + hunt.mouseSize - area.x)]
          : null,
      })),
    };
    const sent = JSON.stringify(msg.mice);
    if (sent !== this.fieldSent) {
      win.webContents.send(IPC.field, msg);
      this.fieldSent = sent;
    }
    if (!this.fieldShown) {
      win.showInactive();
      this.fieldShown = true;
    }
  }

  /**
   * Where a new mouse comes in: from the side with fewer mice, so the floor fills from both ends,
   * and behind any mouse still on its way in from that side, so several that start at once (the
   * pet was just opened) walk in as a line instead of a heap.
   */
  private entrance(area: Rectangle, catCenterX: number): { from: 'left' | 'right'; behind: number } {
    const middle = area.x + area.width / 2;
    const count = { left: 0, right: 0 };
    const outside = { left: 0, right: 0 };
    for (const mouse of this.mice.values()) {
      if (mouse.fate === 'leave') continue;
      const centre = mouse.prey.centerX;
      count[centre < middle ? 'left' : 'right'] += 1;
      if (centre < area.x) outside.left += 1;
      else if (centre > area.x + area.width) outside.right += 1;
    }
    // Even: the side farther from the cat, as a mouse of the hunt game does.
    const from = count.left === count.right ? (catCenterX > middle ? 'left' : 'right') : count.left < count.right ? 'left' : 'right';
    return { from, behind: outside[from] * (this.host.pack.config.hunt.mouseSize + LANE_GAP) };
  }

  /**
   * Every mouse that is not leaving gets a stretch of the floor to itself, side by side: mice never
   * stand on each other, and each name stays over its own mouse. The stretches are dealt out again
   * only when a mouse comes or goes, in the order the mice stand in, so none has to cross another.
   */
  private shareFloor(area: Rectangle, penMargin: number): void {
    const staying = [...this.mice.entries()].filter(([, mouse]) => mouse.fate !== 'leave');
    const key = staying.map(([id]) => id).join('\n');
    if (key !== this.laneKey) {
      this.laneKey = key;
      [...staying].sort(([, a], [, b]) => a.prey.x - b.prey.x).forEach(([, mouse], i) => (mouse.lane = i));
    }
    const { mouseSize } = this.host.pack.config.hunt;
    const left = area.x + penMargin;
    const each = Math.max(0, area.width - penMargin * 2) / Math.max(1, staying.length);
    for (const [, mouse] of staying) {
      const lo = left + mouse.lane * each + LANE_GAP / 2;
      mouse.prey.lane = { lo, hi: Math.max(lo, left + (mouse.lane + 1) * each - LANE_GAP / 2 - mouseSize) };
    }
  }

  private release(mouse: Mouse, fate: 'catch' | 'leave'): void {
    mouse.fate = fate;
    mouse.waiting = false;
    mouse.prey.frozen = false;
    if (fate === 'leave') {
      mouse.prey.lane = null;
      mouse.prey.escape();
    }
  }

  private hideField(): void {
    if (!this.fieldShown || this.fieldWin.isDestroyed()) return;
    this.fieldWin.hide();
    this.fieldShown = false;
    this.fieldAt = '';
  }
}
