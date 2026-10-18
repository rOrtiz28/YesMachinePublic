'use strict';
// The viewer's own pointer, for a viewer with a mouse that controls this Windows computer. main.cjs creates this on
// Windows only. A viewer that has a mouse asks for its own pointer with a 'local-cursor' message, which main.cjs
// answers with hide() and show(); stop() runs when a viewer joins or leaves and when sharing stops.
//
// Why: Chromium's screen capture draws the cursor into every frame, where it trails the viewer's own pointer by the
// time frames take to arrive (about 70 ms in the Windows VM), and it has no setting to leave the cursor out. So while
// a viewer with a mouse has control, a small helper blanks Windows' standard cursors, which leaves frames without
// one, and reports which cursor Windows shows, so the viewer's own pointer takes that shape at once.
//
// The cursor belongs to whoever moved last. Windows marks the moves Yes Machine makes as injected, so when the mouse
// at this computer moves, its cursor comes back at once, and it goes blank again only when the viewer moves after
// that mouse has been still for two seconds.
//
// Windows gets its cursors back when the viewer leaves, when sharing stops or Yes Machine closes, and when the helper
// loses Yes Machine (its stdin closes); signing out does too. An app's own cursor, not one of Windows' standard ones,
// still shows in the picture.
const { spawn } = require('node:child_process');

// --- The helper ---
//
// PowerShell compiles this C# class (Add-Type) and runs it. Its protocol, one line at a time:
// - stdin: "hide" (the viewer wants its own pointer) or "show".
// - stdout: "shape <name>" when the cursor changes, where name is a CSS cursor keyword, "none" when Windows shows no
//   cursor, or "custom" for an app's own.
//
// How it works: a low-level mouse hook (WH_MOUSE_LL) notes when the mouse here last moved and when an injected move
// (LLMHF_INJECTED) last came. Every 15 ms the main loop blanks the standard cursors (SetSystemCursor, with
// transparent 32 x 32 cursors) if the viewer wants its own pointer and moved in the last two seconds while the mouse
// here didn't, and gives them back (SystemParametersInfo with SPI_SETCURSORS) when the viewer no longer wants it or
// the mouse here moves. Then it reads the cursor Windows shows (GetCursorInfo) and names its shape by comparing its
// handle with the standard cursors' handles, which SetSystemCursor leaves as they are, as it only replaces their
// images. When stdin closes, the helper gives the cursors back and exits.
const HELPER = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class YesMachineCursor {
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct CursorInfo { public int Size, Flags; public IntPtr Handle; public Point Position; }
  [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr Window; public uint Id; public IntPtr W, L; public uint Time; public Point Position; public uint Private; }
  delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CursorInfo info);
  [DllImport("user32.dll")] static extern IntPtr LoadCursor(IntPtr instance, IntPtr name);
  [DllImport("user32.dll")] static extern IntPtr CreateCursor(IntPtr instance, int x, int y, int width, int height, byte[] and, byte[] xor);
  [DllImport("user32.dll")] static extern bool SetSystemCursor(IntPtr cursor, uint id);
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint value, IntPtr data, uint update);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int kind, HookProc proc, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
  static readonly uint[] Ids = { 32512, 32513, 32514, 32515, 32516, 32642, 32643, 32644, 32645, 32646, 32648, 32649, 32650, 32651 };
  static readonly string[] Names = { "default", "text", "wait", "crosshair", "default", "nwse-resize", "nesw-resize", "ew-resize", "ns-resize", "move", "not-allowed", "pointer", "progress", "help" };
  const int Quiet = 2000;
  static readonly object Lock = new object();
  static volatile bool wanted, blank;
  static int lastLocal = Environment.TickCount - Quiet, lastInjected = Environment.TickCount - Quiet;
  static HookProc hook;
  // SPI_SETCURSORS reloads the cursors the person chose in Windows' settings.
  static void Restore() { SystemParametersInfo(0x57, 0, IntPtr.Zero, 0); }
  static void Blank() {
    byte[] and = new byte[128], xor = new byte[128];
    for (int i = 0; i < and.Length; i++) and[i] = 0xFF;
    foreach (uint id in Ids) SetSystemCursor(CreateCursor(IntPtr.Zero, 0, 0, 32, 32, and, xor), id);
  }
  // Every mouse event on this computer: LLMHF_INJECTED marks the ones Yes Machine (or another program) made.
  static IntPtr OnMouse(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      if ((Marshal.ReadInt32(l, 12) & 1) != 0) Interlocked.Exchange(ref lastInjected, Environment.TickCount);
      else Interlocked.Exchange(ref lastLocal, Environment.TickCount);
    }
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }
  public static void Run() {
    Restore();
    IntPtr[] handles = new IntPtr[Ids.Length];
    for (int i = 0; i < Ids.Length; i++) handles[i] = LoadCursor(IntPtr.Zero, new IntPtr(Ids[i]));
    Thread commands = new Thread(() => {
      string line;
      while ((line = Console.In.ReadLine()) != null) { if (line == "hide") wanted = true; else if (line == "show") wanted = false; }
      wanted = false;
      lock (Lock) { Restore(); blank = false; }
      Environment.Exit(0);
    });
    commands.IsBackground = true;
    commands.Start();
    Thread mouse = new Thread(() => {
      hook = OnMouse;
      SetWindowsHookEx(14, hook, GetModuleHandle(null), 0);   // WH_MOUSE_LL
      Message message;
      while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
    });
    mouse.IsBackground = true;
    mouse.Start();
    string last = null;
    for (;;) {
      int now = Environment.TickCount;
      bool local = unchecked(now - Thread.VolatileRead(ref lastLocal)) < Quiet;
      bool viewer = unchecked(now - Thread.VolatileRead(ref lastInjected)) < Quiet;
      lock (Lock) {
        if (blank && (!wanted || local)) { Restore(); blank = false; }
        else if (!blank && wanted && !local && viewer) { Blank(); blank = true; }
      }
      CursorInfo info = new CursorInfo();
      info.Size = Marshal.SizeOf(info);
      string shape = "none";
      if (GetCursorInfo(ref info) && (info.Flags & 1) != 0 && info.Handle != IntPtr.Zero) {
        shape = "custom";
        for (int i = 0; i < handles.Length; i++) if (info.Handle == handles[i]) { shape = Names[i]; break; }
      }
      if (shape != last) { last = shape; Console.Out.WriteLine("shape " + shape); Console.Out.Flush(); }
      Thread.Sleep(15);
    }
  }
}
'@
[YesMachineCursor]::Run()`;

// --- Controlling the helper ---

/**
 * Creates the cursor control. Nothing runs until hide() or restore().
 *
 * - onShape(name) gets each change of the cursor's shape.
 * - marked(on) is told whether the cursors are blank, so Yes Machine can remember it across a crash (main.cjs keeps
 *   a file for it).
 * - run starts the helper (child_process.spawn; tests pass their own).
 *
 * The helper starts with hide() and stays until stop(). show() gives this computer its cursor back but keeps the
 * helper, which goes on reporting shapes. restore() starts a helper only to give Windows its cursors back, for when a
 * helper was killed along with Yes Machine.
 */
function createWindowsCursor({ run = spawn, onShape = () => {}, marked = () => {} } = {}) {
  // hidden: the viewer wants its own pointer, so a helper that starts is told to blank the cursors.
  let helper = null,
    hidden = false;

  /** Starts the helper in a hidden PowerShell window and passes on the shapes it reports. */
  function start() {
    let current;
    try {
      current = run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', HELPER],
        { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
      );
    } catch {
      return;
    }
    helper = current;
    // Writing to a helper that has gone fails; that is handled by 'exit', so the write error itself is dropped.
    current.stdin.on('error', () => {});
    current.stdout.setEncoding('utf8');
    // Lines can arrive split anywhere. Only well-formed shape lines are passed on, and a run of text without a
    // newline is dropped once it passes 1 KB.
    let pending = '';
    current.stdout.on('data', (chunk) => {
      pending += chunk;
      for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
        const shape = /^shape ([a-z-]{1,20})$/.exec(pending.slice(0, end).trim())?.[1];
        pending = pending.slice(end + 1);
        if (shape) onShape(shape);
      }
      if (pending.length > 1024) pending = '';
    });
    // The helper failed to start or exited: forget it, unless a newer one has taken its place.
    const gone = () => {
      if (helper === current) helper = null;
    };
    current.on('error', gone);
    current.on('exit', gone);
    if (hidden) current.stdin.write('hide\n');
  }

  /**
   * Ends the helper. Closing its stdin makes it give Windows its cursors back and exit. PowerShell can take a few
   * seconds to start, so the helper is killed only if it is still there much later.
   */
  function end() {
    hidden = false;
    const current = helper;
    helper = null;
    if (current) {
      current.stdin.end();
      setTimeout(() => current.kill(), 30000).unref?.();
    }
  }
  return {
    /**
     * The viewer wants its own pointer: tell the helper, starting it if it isn't running. The cursors go blank when
     * the viewer moves, unless the mouse here moved in the last two seconds.
     */
    hide() {
      hidden = true;
      marked(true);
      if (helper) helper.stdin.write('hide\n');
      else start();
    },
    /** The viewer no longer wants its own pointer: give the cursors back, but keep the helper running. */
    show() {
      if (!helper) return;
      hidden = false;
      helper.stdin.write('show\n');
      marked(false);
    },
    /** Ends the helper, which gives the cursors back. The mark is cleared only if there was something to undo. */
    stop() {
      const wasActive = hidden || helper;
      end();
      if (wasActive) marked(false);
    },
    /** Gives Windows its cursors back after a helper was killed with them blank, as after a crash. */
    restore() {
      if (!helper) start();
      end();
      marked(false);
    },
  };
}

module.exports = { createWindowsCursor, HELPER };
