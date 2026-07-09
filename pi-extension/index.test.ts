import assert from "node:assert/strict";
import test from "node:test";

import {
  completedPipeName,
  getZellijPaneId,
  sendCompletedNotification,
  sendDesktopNotification,
  type ExecCommand,
  type ExecZellij,
} from "./index.ts";

test("getZellijPaneId returns numeric Zellij pane ids", () => {
  assert.equal(getZellijPaneId({ ZELLIJ_PANE_ID: "16" }), "16");
});

test("getZellijPaneId rejects missing, empty, and non-numeric ids", () => {
  assert.equal(getZellijPaneId({}), undefined);
  assert.equal(getZellijPaneId({ ZELLIJ_PANE_ID: "" }), undefined);
  assert.equal(getZellijPaneId({ ZELLIJ_PANE_ID: "terminal_16" }), undefined);
  assert.equal(getZellijPaneId({ ZELLIJ_PANE_ID: "16\n" }), undefined);
});

test("completedPipeName uses the existing zellij-attention completed protocol", () => {
  assert.equal(
    completedPipeName("16"),
    "zellij-attention::completed::16",
  );
});

test("sendCompletedNotification is quiet when not inside Zellij", async () => {
  const calls: string[][] = [];
  const execZellij: ExecZellij = async (args) => {
    calls.push(args);
    return { code: 0, stdout: "", stderr: "" };
  };

  const result = await sendCompletedNotification(execZellij, {});

  assert.deepEqual(calls, []);
  assert.deepEqual(result, { ok: false, reason: "not-in-zellij" });
});

test("sendCompletedNotification runs zellij pipe for the current pane", async () => {
  const calls: string[][] = [];
  const execZellij: ExecZellij = async (args) => {
    calls.push(args);
    return { code: 0, stdout: "", stderr: "" };
  };

  const result = await sendCompletedNotification(execZellij, {
    ZELLIJ_PANE_ID: "16",
  });

  assert.deepEqual(calls, [
    ["pipe", "--name", "zellij-attention::completed::16"],
  ]);
  assert.deepEqual(result, { ok: true });
});

test("sendCompletedNotification reports zellij command failures", async () => {
  const execZellij: ExecZellij = async () => ({
    code: 1,
    stdout: "",
    stderr: "plugin not loaded",
  });

  const result = await sendCompletedNotification(execZellij, {
    ZELLIJ_PANE_ID: "16",
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "zellij-failed",
    message: "plugin not loaded",
  });
});

test("sendDesktopNotification prefers terminal-notifier", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const execCommand: ExecCommand = async (command, args) => {
    calls.push({ command, args });
    return { code: 0, stdout: "", stderr: "" };
  };

  const result = await sendDesktopNotification(execCommand, {
    PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    TERM_PROGRAM: "iTerm.app",
    ZELLIJ_SESSION_NAME: "demo-session",
    ZELLIJ_PANE_ID: "16",
  });

  assert.equal(calls[0]?.command, "terminal-notifier");
  assert.deepEqual(calls[0]?.args.slice(0, 8), [
    "-title",
    "Pi",
    "-message",
    "Pi finished in Zellij pane 16",
    "-group",
    "zellij-attention-pi-16",
    "-activate",
    "com.googlecode.iterm2",
  ]);
  assert.equal(calls[0]?.args[8], "-execute");
  const executeCommand = calls[0]?.args[9] || "";
  assert.match(executeCommand, /^\/bin\/sh -c /);
  assert.match(executeCommand, /zellij --session demo-session action focus-pane-id terminal_16/);
  assert.match(executeCommand, /osascript/);
  assert.match(executeCommand, /select t/);
  assert.deepEqual(result, { ok: true, notifier: "terminal-notifier", clickAction: true });
});

test("sendDesktopNotification falls back to alerter then osascript", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const execCommand: ExecCommand = async (command, args) => {
    calls.push({ command, args });
    return command === "osascript"
      ? { code: 0, stdout: "", stderr: "" }
      : { code: 127, stdout: "", stderr: `${command} missing` };
  };

  const result = await sendDesktopNotification(execCommand, {
    PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    TERM_PROGRAM: "iTerm.app",
    ZELLIJ_SESSION_NAME: "demo-session",
    ZELLIJ_PANE_ID: "16",
  });

  assert.equal(calls[0]?.command, "terminal-notifier");
  assert.deepEqual(calls[0]?.args.slice(0, 8), [
    "-title",
    "Pi",
    "-message",
    "Pi finished in Zellij pane 16",
    "-group",
    "zellij-attention-pi-16",
    "-activate",
    "com.googlecode.iterm2",
  ]);
  assert.equal(calls[0]?.args[8], "-execute");
  const executeCommand = calls[0]?.args[9] || "";
  assert.match(executeCommand, /zellij --session demo-session action focus-pane-id terminal_16/);
  assert.match(executeCommand, /osascript/);

  assert.deepEqual(calls.slice(1), [
    {
      command: "alerter",
      args: [
        "-title",
        "Pi",
        "-message",
        "Pi finished in Zellij pane 16",
      ],
    },
    {
      command: "osascript",
      args: [
        "-e",
        'display notification "Pi finished in Zellij pane 16" with title "Pi"',
      ],
    },
  ]);
  assert.deepEqual(result, { ok: true, notifier: "osascript", clickAction: false });
});

test("sendDesktopNotification shell-quotes click command session and PATH", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const execCommand: ExecCommand = async (command, args) => {
    calls.push({ command, args });
    return { code: 0, stdout: "", stderr: "" };
  };

  await sendDesktopNotification(execCommand, {
    PATH: "/opt/homebrew/bin:/weird path/bin",
    ZELLIJ_SESSION_NAME: "team's session",
    ZELLIJ_PANE_ID: "16",
  });

  const executeCommand = calls[0]?.args.at(-1) || "";
  assert.match(executeCommand, /^\/bin\/sh -c /);
  assert.match(executeCommand, /zellij --session/);
  assert.match(executeCommand, /team/);
  assert.match(executeCommand, /s session/);
  assert.match(executeCommand, /focus-pane-id terminal_16/);
  assert.match(executeCommand, /weird path\/bin/);
});

test("sendDesktopNotification continues to fallback notifiers after exec throws", async () => {
  const calls: string[] = [];
  const execCommand: ExecCommand = async (command) => {
    calls.push(command);
    if (command === "terminal-notifier") {
      throw new Error("terminal-notifier crashed");
    }
    return { code: 0, stdout: "", stderr: "" };
  };

  const result = await sendDesktopNotification(execCommand, {
    ZELLIJ_PANE_ID: "16",
  });

  assert.deepEqual(calls, ["terminal-notifier", "alerter"]);
  assert.deepEqual(result, { ok: true, notifier: "alerter", clickAction: false });
});

test("sendDesktopNotification omits click command without a valid pane id", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const execCommand: ExecCommand = async (command, args) => {
    calls.push({ command, args });
    return { code: 0, stdout: "", stderr: "" };
  };

  const result = await sendDesktopNotification(execCommand, {});

  assert.deepEqual(calls, [
    {
      command: "terminal-notifier",
      args: [
        "-title",
        "Pi",
        "-message",
        "Pi finished in Zellij",
      ],
    },
  ]);
  assert.deepEqual(result, { ok: true, notifier: "terminal-notifier", clickAction: false });
});

test("sendDesktopNotification reports failures from all notifiers", async () => {
  const execCommand: ExecCommand = async (command) => ({
    code: 1,
    stdout: "",
    stderr: `${command} failed`,
  });

  const result = await sendDesktopNotification(execCommand, {
    ZELLIJ_PANE_ID: "16",
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "notification-failed",
    message: "terminal-notifier failed; alerter failed; osascript failed",
  });
});
