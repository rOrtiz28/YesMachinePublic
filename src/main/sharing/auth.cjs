'use strict';
// Checks a user name and password against this computer's own accounts, as NoMachine does. It is
// the sign-in behind POST /login in sharing/server.cjs; main.cjs creates the check with
// createAuthenticator() and hands it to the server. Only the account running Yes Machine can sign
// in, because that is the desktop being shared.
//
// The check runs in a helper program that ships with each operating system: Python with PAM on
// Linux, osascript with Open Directory on macOS, and PowerShell with LogonUser on Windows. The
// password reaches the helper on its stdin, never in its arguments, which other users of the
// computer can see in the process list. The helper's exit code is the answer: 0 means right.
const { spawn } = require('node:child_process');
const os = require('node:os');

// --- The helpers ---

// Linux: PAM's "login" service through ctypes. pam_unix verifies the calling user's own password
// through its setuid helper, so this works without root.
// The script gets the account as its argument and the password on stdin. Its conversation callback
// answers every prompt PAM shows with echo off (style 1, PAM_PROMPT_ECHO_OFF) with a copy of the
// password, allocated with libc because PAM frees the answers itself. pam_authenticate checks the
// password, and pam_acct_mgmt checks that the account may log in now (for example, not expired).
const LINUX = String.raw`
import ctypes, ctypes.util, sys
from ctypes import CFUNCTYPE, POINTER, Structure, byref, c_char_p, c_int, c_void_p, cast, sizeof
user, password = sys.argv[1].encode(), sys.stdin.buffer.read()
pam = ctypes.CDLL(ctypes.util.find_library('pam') or 'libpam.so.0')
libc = ctypes.CDLL(ctypes.util.find_library('c'))
libc.calloc.restype = libc.strdup.restype = c_void_p
libc.calloc.argtypes = [ctypes.c_size_t, ctypes.c_size_t]
libc.strdup.argtypes = [c_char_p]
class Message(Structure): _fields_ = [('style', c_int), ('text', c_char_p)]
class Response(Structure): _fields_ = [('resp', c_void_p), ('code', c_int)]
CONV = CFUNCTYPE(c_int, c_int, POINTER(POINTER(Message)), POINTER(POINTER(Response)), c_void_p)
class Conversation(Structure): _fields_ = [('conv', CONV), ('data', c_void_p)]
def answer(count, messages, responses, data):
    block = cast(libc.calloc(count, sizeof(Response)), POINTER(Response))
    for i in range(count):
        if messages[i].contents.style == 1: block[i].resp = libc.strdup(password)
    responses[0] = block
    return 0
callback = CONV(answer)
handle = c_void_p()
pam.pam_start.argtypes = [c_char_p, c_char_p, POINTER(Conversation), POINTER(c_void_p)]
for name in ('pam_authenticate', 'pam_acct_mgmt', 'pam_end'): getattr(pam, name).argtypes = [c_void_p, c_int]
result = pam.pam_start(b'login', user, byref(Conversation(callback, None)), byref(handle))
if result == 0: result = pam.pam_authenticate(handle, 0)
if result == 0: result = pam.pam_acct_mgmt(handle, 0)
pam.pam_end(handle, result)
sys.exit(0 if result == 0 else 1)
`;

// macOS: Open Directory through JavaScript for Automation (osascript -l JavaScript). A refused
// password throws, so osascript exits non-zero.
// The script gets the account as its argument and the password on stdin. It looks the user up on
// the authentication search node (0x2201, kODNodeTypeAuthentication) and asks Open Directory to
// verify the password; a missing user throws too.
const MACOS = `
ObjC.import('Foundation'); ObjC.import('OpenDirectory');
function run(argv) {
  const input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  const password = $.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding);
  const node = $.ODNode.nodeWithSessionTypeError($.ODSession.defaultSession, 0x2201, null);
  const record = node.recordWithRecordTypeNameAttributesError($.kODRecordTypeUsers, argv[0], null, null);
  if (record.isNil() || !record.verifyPasswordError(password, null)) throw new Error('refused');
  return 'ok';
}`;

// Windows: LogonUser for a local or Microsoft account. The first stdin line is the account, the
// rest the password.
// In this template literal, \`n is PowerShell's `n, a newline. Add-Type compiles a small C# class
// that calls LogonUser and CloseHandle in the Windows API. LogonUser gets the domain "." (this
// computer's own accounts), logon type 2 (LOGON32_LOGON_INTERACTIVE) and provider 0 (the default).
const WINDOWS = `
$lines = [Console]::In.ReadToEnd() -split "\`n", 2
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class YesMachineLogon { [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool LogonUser(string user, string domain, string password, int type, int provider, out IntPtr token); [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle); }'
$token = [IntPtr]::Zero
if ([YesMachineLogon]::LogonUser($lines[0].Trim(), '.', $lines[1], 2, 0, [ref]$token)) { [YesMachineLogon]::CloseHandle($token) | Out-Null; exit 0 }
exit 1`;

// --- Running a helper ---

/**
 * Runs `command` with `args`, writes `input` to its stdin, and resolves true only if it exits with
 * code 0. It never rejects: a program that can't start, fails, or runs longer than `timeout` ms
 * (it is then killed) resolves false. The helper's output is ignored.
 */
function run(command, args, input, timeout = 20000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, timeout);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    // A helper that exits before reading its input makes the write fail; its exit code still
    // gives the answer.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// --- The check ---

/**
 * Creates the password check for the sharing server: async (user, password) => boolean, true when
 * `user` names the account running Yes Machine and `password` is that account's password.
 *
 * The name is compared exactly on Linux and ignoring case on macOS and Windows, after trimming
 * spaces; the helper then checks `account` itself, never the typed name. refuseDelay matches the
 * pause PAM adds after a wrong password, so timing doesn't reveal the account name: another
 * account is refused only after that pause.
 *
 * `platform`, `account`, `runner` (see run()) and `refuseDelay` can be replaced in tests.
 */
function createAuthenticator({
  platform = process.platform,
  account = os.userInfo().username,
  runner = run,
  refuseDelay = 2500,
} = {}) {
  return async (user, password) => {
    if (
      typeof user !== 'string' ||
      typeof password !== 'string' ||
      !password ||
      password.length > 1024
    )
      return false;
    const name = user.trim(),
      same = platform === 'linux' ? name === account : name.toLowerCase() === account.toLowerCase();
    if (!same) {
      await new Promise((resolve) => setTimeout(resolve, refuseDelay));
      return false;
    }
    // python3 -I runs isolated, ignoring PYTHON* variables and the user's site-packages, and
    // PowerShell skips the person's profile, so no other code runs beside the password.
    if (platform === 'linux') return runner('python3', ['-I', '-c', LINUX, account], password);
    if (platform === 'darwin')
      return runner('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MACOS, account], password);
    // PowerShell reads both from stdin: the account on the first line, then the password.
    if (platform === 'win32')
      return runner(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS],
        `${account}\n${password}`,
      );
    return false;
  };
}

module.exports = { createAuthenticator, run, HELPERS: { LINUX, MACOS, WINDOWS } };
