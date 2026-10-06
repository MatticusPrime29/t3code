# Running this fork locally

The source launchers rebuild the checkout, update dependencies, and stage the local
Whisper runtime before starting. They open an authenticated loopback browser session
so microphone recording and local editor launching work on the same machine.

On macOS, run `scripts/t3-fork.command restart`. It uses port 13773 and this
checkout's `.t3` data directory. A desktop `.command` wrapper can call that script
with `start`, `restart`, or `stop`; Node 24 and `vp` must be on its PATH.

On Windows, run `scripts/restart-fork.cmd`, or make a desktop shortcut to it.
The tracked `scripts/t3-fork-production.ps1` controller preserves the existing
production setup: port 3773, `.t3/production` data, background execution, and logs.
It accepts `enable`, `disable`, `restart`, and `pair`, plus `-NoBrowser` for diagnostics.
If your existing desktop command points into `.t3/production/control`, change it once
to call `scripts/t3-fork-production.ps1`; files in `.t3` do not update with Git.

The first Whisper build requires CMake and a C++ compiler: Xcode command-line tools
on macOS, or Visual Studio Build Tools with the C++ workload on Windows. Model and
source downloads are cached, so subsequent restarts reuse the native build.

For other source launchers, use `node scripts/start-fork.ts` after stopping their
server. `--base-dir` and `--port` preserve a custom deployment's state and port;
`--prepare-only` performs the build and voice staging without starting a server.
When starting separately, set `T3CODE_WHISPER_RESOURCE_DIR` to the checkout's
`.t3/runtime/whisper` directory.

Use `http://localhost:<port>` on the computer running the server. HTTP LAN and
Tailscale IP addresses remain useful for other devices, but browser recording there
requires HTTPS. The server still binds all interfaces. Editor selection defaults to
PhpStorm when installed; choosing another editor in the picker saves that preference.
