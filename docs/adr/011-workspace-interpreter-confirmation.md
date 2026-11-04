# ADR 011: Confirming workspace interpreters from the Python extension

- Status: Accepted
- Date: 2026-11-04

## Context

[ADR 004](004-interpreter-discovery.md) left a known limit: in a trusted workspace, and therefore
always in editors that ship with Workspace Trust disabled such as Cursor, Hearback ran the Python
extension's active environment without a prompt. A repository can steer that choice, for example
with a committed `.venv` or `python.defaultInterpreterPath` in its settings. A workspace virtual
environment runs attacker code at startup even under `-I -S`, because its `pyvenv.cfg` can point
the standard library at files in the repository, so probing such an interpreter is already code
execution. A `hearback.engine.pythonPath` from workspace settings already needed a one-time
confirmation per (workspace, path). The review finding SEC-2 raised the gap, and on 2026-11-04 the
owner decided to require a confirmation for such interpreters too.

## Decision

- **Which interpreters:** an executable from the Python extension's active environment whose
  reported path or real path lies inside a workspace folder, compared with the folders as opened
  and with their real paths, under the platform rules of Restricted Mode (case-insensitive on
  Windows and macOS). The real paths of the folders matter because a venv's `python` links to a
  base interpreter outside the workspace, so only its own path shows where it lives.
- **When Hearback asks:** before anything runs, the probe included, once per (workspace, path),
  with a modal warning: 'The Python extension selected "…", which lies inside this workspace.',
  'Hearback will run this program to analyze your code. Only allow it if you trust the files in
  this workspace.', with **Allow** and **Don't Allow**. Only interactive starts ask (a command the
  user ran); automatic restarts and other non-interactive starts treat an interpreter without
  approval as not confirmed, as they treat a workspace value of the setting.
- **What the engine runs:** the probed `sys.executable`. If it differs from a reported path that
  lies outside the workspace, it is checked the same way before the engine starts. An approval of
  the reported path covers its `sys.executable`, since the approved program already ran.
- **Storage:** approvals go to `globalState` under `hearback.approvedPythonExtensionInterpreters`,
  a list of at most 200 entries of its own, so they never mix with the approvals of
  `hearback.engine.pythonPath`. A decline, or a dismissed dialog, holds for the rest of the session;
  a later session asks again.
- **Fallback:** without a confirmation the resolution continues with PATH, and Hearback: Show
  Engine Status names the reason ("inside the workspace, not confirmed" or "inside the workspace,
  declined in this session").
- **Unchanged:** interpreters outside the workspace folders (a system Python, pyenv or conda in the
  home folder) and the user's own `hearback.engine.pythonPath` run without a prompt, and Restricted
  Mode does not consult the Python extension at all.
- **Hearback: Select Python Interpreter** does not probe an unconfirmed interpreter inside the
  workspace either. It lists it without a version as "Python (inside the workspace)"; picking it is
  the user's explicit choice, which goes to the user settings like any pick and needs no further
  confirmation.

## Consequences

- A repository can no longer make Hearback run one of its programs without the user's consent, in
  editors without Workspace Trust too: not through `hearback.engine.pythonPath` and not through the
  Python extension's choice. The Python extension may still run the interpreter itself for its own
  features; this decision covers what Hearback runs.
- A project's own `.venv` costs one confirmation per workspace. After a decline the engine uses
  PATH for that session; Select Python Interpreter picks the environment anyway.
- An approval covers the path, not the file's content: a later change of the environment, for
  example after a pull, is not asked about again, as with the setting's approval.
- Until the user confirms it, the picker shows such an interpreter without its version.

## Alternatives considered

- **Keeping the known limit and relying on Workspace Trust:** a cloned repository could run code
  through Hearback in Cursor as soon as the user opened Show Engine Status.
- **Never using interpreters inside the workspace:** safe, but the project's environment can be
  the only Python 3.10 or newer on the machine.
- **Probing first and asking afterwards:** the probe of a workspace virtual environment already
  runs its code.
- **Asking on every start:** more prompts without more safety; the setting's confirmation is
  one-time too.
- **One list for both confirmations:** an approval for one source would apply to the other, and
  ignoring a workspace value in Select Python Interpreter would revoke the other's approval.
