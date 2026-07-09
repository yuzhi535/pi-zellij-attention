import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type ExecResult = {
  code: number | null;
  stdout?: string;
  stderr?: string;
};

export type ExecZellij = (args: string[]) => Promise<ExecResult>;
export type ExecCommand = (command: string, args: string[]) => Promise<ExecResult>;

export type PipeResult =
  | { ok: true }
  | { ok: false; reason: "not-in-zellij" }
  | { ok: false; reason: "zellij-failed"; message: string };

export type DesktopNotificationResult =
  | { ok: true; notifier: string; clickAction: boolean }
  | { ok: false; reason: "notification-failed"; message: string };

export function getZellijPaneId(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const paneId = env.ZELLIJ_PANE_ID;
  if (typeof paneId !== "string") return undefined;
  if (!/^\d+$/.test(paneId)) return undefined;
  return paneId;
}

export function completedPipeName(paneId: string): string {
  return `zellij-attention::completed::${paneId}`;
}

// Keep the message stable for tests and short enough for notification banners.
function notificationMessage(
  env: Record<string, string | undefined> = process.env,
): string {
  const paneId = getZellijPaneId(env);
  return paneId
    ? `Pi finished in Zellij pane ${paneId}`
    : "Pi finished in Zellij";
}

// Escape is defensive: current messages are generated from safe strings and
// validated pane IDs, but this protects future user-controlled message text.
function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function iTermSelectSessionCommand(sessionName: string): string {
  const escapedSessionName = escapeAppleScriptString(sessionName);
  const appleScript = `tell application "iTerm"
activate
repeat with w in windows
repeat with t in tabs of w
repeat with s in sessions of t
if (name of s as text) starts with "${escapedSessionName}" then
select w
select t
return
end if
end repeat
end repeat
end repeat
end tell`;
  return `/usr/bin/osascript -e ${shellEscape(appleScript)}`;
}

function focusPaneClickCommand(
  paneId: string,
  env: Record<string, string | undefined> = process.env,
  ): string | undefined {
  const sessionName = env.ZELLIJ_SESSION_NAME;
  if (!sessionName) return undefined;
  const path = env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  const focusCommand = [
    "/usr/bin/env",
    `PATH=${shellEscape(path)}`,
    "zellij",
    "--session",
    shellEscape(sessionName),
    "action",
    "focus-pane-id",
    `terminal_${paneId}`,
  ].join(" ");
  const commands = [focusCommand];
  if (terminalActivateBundleId(env) === "com.googlecode.iterm2") {
    commands.push(iTermSelectSessionCommand(sessionName));
  }
  return `/bin/sh -c ${shellEscape(commands.join("; "))}`;
}

function terminalActivateBundleId(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (env.TERM_PROGRAM === "iTerm.app" || env.LC_TERMINAL === "iTerm2") {
    return "com.googlecode.iterm2";
  }
  if (env.TERM_PROGRAM === "Apple_Terminal") {
    return "com.apple.Terminal";
  }
  return "com.googlecode.iterm2";
}

function desktopNotificationCommands(
  env: Record<string, string | undefined> = process.env,
): Array<{ command: string; args: string[]; clickAction: boolean }> {
  const title = "Pi";
  const message = notificationMessage(env);
  const paneId = getZellijPaneId(env);
  const terminalNotifierArgs = ["-title", title, "-message", message];
  const clickCommand = paneId ? focusPaneClickCommand(paneId, env) : undefined;
  const activateBundleId = terminalActivateBundleId(env);
  if (paneId && clickCommand) {
    terminalNotifierArgs.push("-group", `zellij-attention-pi-${paneId}`);
    if (activateBundleId) {
      terminalNotifierArgs.push("-activate", activateBundleId);
    }
    terminalNotifierArgs.push("-execute", clickCommand);
  }

  return [
    {
      command: "terminal-notifier",
      args: terminalNotifierArgs,
      clickAction: Boolean(clickCommand),
    },
    {
      command: "alerter",
      args: ["-title", title, "-message", message],
      clickAction: false,
    },
    {
      command: "osascript",
      args: [
        "-e",
        `display notification "${escapeAppleScriptString(message)}" with title "${escapeAppleScriptString(title)}"`,
      ],
      clickAction: false,
    },
  ];
}

// Best-effort desktop notification: try installed native helpers first, then osascript.
export async function sendDesktopNotification(
  execCommand: ExecCommand,
  env: Record<string, string | undefined> = process.env,
): Promise<DesktopNotificationResult> {
  const failures: string[] = [];
  for (const { command, args, clickAction } of desktopNotificationCommands(env)) {
    try {
      const result = await execCommand(command, args);
      if (result.code === 0) return { ok: true, notifier: command, clickAction };

      const message = (result.stderr || result.stdout || `${command} failed`).trim();
      failures.push(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${command}: ${message}`);
    }
  }

  return {
    ok: false,
    reason: "notification-failed",
    message: failures.join("; "),
  };
}

export async function sendCompletedNotification(
  execZellij: ExecZellij,
  env: Record<string, string | undefined> = process.env,
): Promise<PipeResult> {
  const paneId = getZellijPaneId(env);
  if (!paneId) return { ok: false, reason: "not-in-zellij" };

  const result = await execZellij(["pipe", "--name", completedPipeName(paneId)]);
  if (result.code === 0) return { ok: true };

  const message = (result.stderr || result.stdout || "zellij pipe failed").trim();
  return { ok: false, reason: "zellij-failed", message };
}

export default function zellijAttentionPiExtension(pi: ExtensionAPI) {
  const execZellij: ExecZellij = async (args) => {
    return pi.exec("zellij", args, { timeout: 3000 });
  };
  const execCommand: ExecCommand = async (command, args) => {
    return pi.exec(command, args, { timeout: 3000 });
  };

  pi.on("agent_end", async () => {
    try {
      const result = await sendCompletedNotification(execZellij);
      if (result.ok) await sendDesktopNotification(execCommand);
    } catch {
      // Automatic notifications must never interrupt or pollute normal Pi usage.
    }
  });

  pi.registerCommand("zellij-attention-test", {
    description: "Send zellij-attention tab and desktop notifications for this pane",
    handler: async (_args, ctx) => {
      try {
        const result = await sendCompletedNotification(execZellij);
        if (!result.ok) {
          if (result.reason === "not-in-zellij") {
            ctx.ui.notify("Not running inside a Zellij pane", "error");
            return;
          }

          ctx.ui.notify(`zellij-attention failed: ${result.message}`, "error");
          return;
        }

        const desktopResult = await sendDesktopNotification(execCommand);
        if (desktopResult.ok) {
          const clickSuffix = desktopResult.clickAction
            ? " (click-to-pane enabled)"
            : " (click-to-pane unavailable — requires terminal-notifier)";
          ctx.ui.notify(
            `zellij-attention tab and desktop notifications sent via ${desktopResult.notifier}${clickSuffix}`,
            "info",
          );
          return;
        }

        ctx.ui.notify(
          `zellij-attention tab notification sent, desktop failed: ${desktopResult.message}`,
          "error",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`zellij-attention failed: ${message}`, "error");
      }
    },
  });
}
