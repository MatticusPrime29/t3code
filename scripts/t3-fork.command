#!/bin/zsh

set -u

readonly REPO_ROOT="${0:A:h:h}"
readonly PORT="13773"
readonly APP_URL="http://localhost:${PORT}"
readonly ACTION="${1:-start}"

fail() {
  echo
  echo "T3 Fork launcher: $1"
  echo
  read -r "?Press Return to close."
  exit 1
}

listener_pid() {
  /usr/sbin/lsof -nP -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | sort -u | head -n 1
}

is_fork_server() {
  local pid="$1"
  local cwd
  local command

  cwd="$(/usr/sbin/lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  command="$(ps -p "${pid}" -o command= 2>/dev/null)"

  [[ "${cwd}" == "${REPO_ROOT}" || "${cwd}" == "${REPO_ROOT}/apps/server" ]] &&
    [[ "${command}" == *"dist/bin.mjs"* ]]
}

stop_server() {
  local pid="$1"

  if ! is_fork_server "${pid}"; then
    fail "Port ${PORT} belongs to another application (PID ${pid}); refusing to stop it."
  fi

  echo "Stopping T3 Fork on port ${PORT} (PID ${pid})..."
  kill -TERM "${pid}" || fail "Could not stop PID ${pid}."

  for _ in {1..50}; do
    [[ -z "$(listener_pid)" ]] && return 0
    sleep 0.1
  done

  fail "The server did not release port ${PORT}."
}

pid="$(listener_pid)"

if [[ "${ACTION}" == "stop" ]]; then
  if [[ -z "${pid}" ]]; then
    echo "T3 Fork is already stopped."
    exit 0
  fi
  stop_server "${pid}"
  echo "T3 Fork stopped."
  exit 0
fi

if [[ -n "${pid}" ]]; then
  if [[ "${ACTION}" == "restart" ]]; then
    stop_server "${pid}"
  elif is_fork_server "${pid}"; then
    echo "T3 Fork is already running on port ${PORT}. Opening it now."
    /usr/bin/open "${APP_URL}"
    exit 0
  else
    fail "Port ${PORT} is already used by another application (PID ${pid})."
  fi
fi

cd "${REPO_ROOT}" || fail "Could not open ${REPO_ROOT}."

exec node scripts/start-fork.ts --port "${PORT}" --base-dir "${REPO_ROOT}/.t3"
