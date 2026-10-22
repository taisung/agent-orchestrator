# Part A: which socket does the 0.9.5 CLI use? No server runs; each call only names its socket.
import sys; sys.path.insert(0, "/tmp/aohd2/scripts")
from r5lib import cap
H = ["herdr"]
cases = [
  ("path_base", {}, [], ["status", "server", "--json"]),
  ("path_base_pane_get", {}, [], ["pane", "get", "w1:p1"]),
  ("path_flag_session", {}, [], ["--session", "aohd2-flag", "status", "server", "--json"]),
  ("path_env_session", {"HERDR_SESSION": "aohd2-env"}, [], ["status", "server", "--json"]),
  ("path_env_session_pane_get", {"HERDR_SESSION": "aohd2-env"}, [], ["pane", "get", "w1:p1"]),
  ("path_env_socket", {"HERDR_SOCKET_PATH": "/tmp/aohd2/s/custom.sock"}, [], ["status", "server", "--json"]),
  ("path_env_socket_pane_get", {"HERDR_SOCKET_PATH": "/tmp/aohd2/s/custom.sock"}, [], ["pane", "get", "w1:p1"]),
  ("path_env_socket_and_flag_session", {"HERDR_SOCKET_PATH": "/tmp/aohd2/s/custom.sock"}, [], ["--session", "aohd2-flag", "pane", "get", "w1:p1"]),
  ("path_env_socket_and_env_session", {"HERDR_SOCKET_PATH": "/tmp/aohd2/s/custom.sock", "HERDR_SESSION": "aohd2-env"}, [], ["pane", "get", "w1:p1"]),
  ("path_no_xdg_config_home", {}, ["XDG_CONFIG_HOME"], ["pane", "get", "w1:p1"]),
  ("path_env_herdr_home", {"HERDR_HOME": "/tmp/aohd2/hh"}, [], ["pane", "get", "w1:p1"]),
  ("path_env_herdr_config_path", {"HERDR_CONFIG_PATH": "/tmp/aohd2/cfg/config.toml"}, [], ["pane", "get", "w1:p1"]),
  ("path_env_herdr_env_pane_id", {"HERDR_ENV": "1", "HERDR_PANE_ID": "w7:p7"}, [], ["pane", "get", "w1:p1"]),
]
for name, extra, unset, args in cases:
    code, out, err = cap(name, H + args, extra, unset)
    print(f"{name}: exit={code} stdout={out.strip()[:300]!r} stderr={err.strip()[:300]!r}")
