#!/usr/bin/env python3
"""server-monitor — nothing to install: Python 3 stdlib only (preinstalled on Ubuntu).

    python3 server.py       → dashboard on http://localhost:3000
    PORT=8080 HOST=127.0.0.1 python3 server.py
"""
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PORT", "3000"))
HOST = os.environ.get("HOST", "0.0.0.0")  # all interfaces — reachable via the server's IP
HISTORY_SIZE = 120  # 2 minutes of 1s samples

IS_LINUX = sys.platform.startswith("linux")
IS_WIN = os.name == "nt"

HTML = (Path(__file__).resolve().parent / "public" / "index.html").read_bytes()


# ---- OS name ----------------------------------------------------------------
def os_name():
    if IS_LINUX:
        try:
            m = re.search(r'^PRETTY_NAME="?([^"\n]+?)"?$', Path("/etc/os-release").read_text(), re.M)
            if m:
                return m.group(1)
        except OSError:
            pass
    if IS_WIN:
        build = sys.getwindowsversion().build
        return f"Windows {'11' if build >= 22000 else '10'} (build {build})"
    return f"{platform.system()} {platform.release()}"


def cpu_model():
    if IS_LINUX:
        try:
            m = re.search(r"^model name\s*:\s*(.+)$", Path("/proc/cpuinfo").read_text(), re.M)
            if m:
                return m.group(1).strip()
        except OSError:
            pass
    return platform.processor()


# ---- CPU (usage = 1 - idle delta / total delta) ------------------------------
def cpu_times():
    """[(idle, total)] per core on linux; one global entry elsewhere."""
    if IS_LINUX:
        out = []
        with open("/proc/stat") as f:
            for line in f:
                if re.match(r"cpu\d", line):
                    v = [int(x) for x in line.split()[1:]]
                    out.append((v[3] + (v[4] if len(v) > 4 else 0), sum(v)))
        return out
    if IS_WIN:  # dev fallback
        import ctypes
        idle, kern, user = (ctypes.c_uint64() for _ in range(3))
        ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kern), ctypes.byref(user))
        return [(idle.value, kern.value + user.value)]  # kernel time includes idle
    return [(0, 0)]


# ---- memory ------------------------------------------------------------------
def mem_info():
    """(total, free) in bytes; free = MemAvailable on linux."""
    if IS_LINUX:
        info = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, _, v = line.partition(":")
                info[k] = int(v.split()[0]) * 1024
        return info["MemTotal"], info.get("MemAvailable", info["MemFree"])
    if IS_WIN:  # dev fallback
        import ctypes

        class MemStatus(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_uint32), ("dwMemoryLoad", ctypes.c_uint32)] + [
                (n, ctypes.c_uint64)
                for n in ("ullTotalPhys", "ullAvailPhys", "ullTotalPageFile",
                          "ullAvailPageFile", "ullTotalVirtual", "ullAvailVirtual",
                          "ullAvailExtendedVirtual")
            ]

        st = MemStatus(dwLength=ctypes.sizeof(MemStatus))
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
        return st.ullTotalPhys, st.ullAvailPhys
    return 0, 0


# ---- network: cumulative bytes since boot ------------------------------------
def read_net():
    try:
        if IS_LINUX:
            rx = tx = 0
            with open("/proc/net/dev") as f:
                for line in list(f)[2:]:
                    p = line.split()
                    if len(p) < 10 or p[0].startswith("lo"):
                        continue
                    rx += int(p[1])
                    tx += int(p[9])
            return rx, tx
        if IS_WIN:  # dev fallback: first `netstat -e` line ending in two integers
            # localized netstat output is OEM-encoded; digits are ASCII so decode loosely
            raw = subprocess.run(["netstat", "-e"], capture_output=True, timeout=10).stdout
            for line in raw.decode("ascii", "replace").splitlines():
                m = re.search(r"(\d+)\s+(\d+)$", line.strip())
                if m:
                    return int(m.group(1)), int(m.group(2))
    except Exception:  # a collector must never kill the sampler
        pass
    return None


def uptime_seconds():
    if IS_LINUX:
        with open("/proc/uptime") as f:
            return int(float(f.read().split()[0]))
    if IS_WIN:
        import ctypes
        ctypes.windll.kernel32.GetTickCount64.restype = ctypes.c_uint64
        return int(ctypes.windll.kernel32.GetTickCount64()) // 1000
    return 0


DISK_ROOT = (Path(__file__).drive + "\\") if IS_WIN else "/"

# ---- sampler thread → ring buffer ---------------------------------------------
state = {"cpu": 0, "net": {"rx": 0, "tx": 0, "rxs": 0, "txs": 0}, "disk": {"total": 0, "free": 0}}
history = []
_lock = threading.Lock()


def sampler():
    last = cpu_times()
    prev_net = None
    tick = 0
    while True:
        time.sleep(1)
        tick += 1

        try:
            now = cpu_times()
        except Exception:
            continue
        usage = []
        for (idle0, total0), (idle1, total1) in zip(last, now):
            total = total1 - total0
            usage.append(1 - (idle1 - idle0) / total if total > 0 else 0)
        cpu = round(sum(usage) / len(usage) * 100) if usage else 0
        last = now

        if tick % 2 == 0:
            n = read_net()
            if n:
                t = time.time()
                if prev_net:
                    dt = t - prev_net[0]
                    state["net"]["rxs"] = max(0, round((n[0] - prev_net[1]) / dt))
                    state["net"]["txs"] = max(0, round((n[1] - prev_net[2]) / dt))
                state["net"]["rx"], state["net"]["tx"] = n
                prev_net = (t, n[0], n[1])

        if tick % 15 == 1:
            try:
                d = shutil.disk_usage(DISK_ROOT)
                state["disk"] = {"total": d.total, "free": d.free}
            except OSError:
                pass

        total, free = mem_info()
        with _lock:
            state["cpu"] = cpu
            history.append({
                "t": int(time.time() * 1000),
                "cpu": cpu,
                "mem": round((1 - free / total) * 100) if total else 0,
                "rxs": state["net"]["rxs"],
                "txs": state["net"]["txs"],
            })
            del history[:-HISTORY_SIZE]


OS_NAME = os_name()
CPU_MODEL = cpu_model()


def stats():
    total, free = mem_info()
    with _lock:
        return {
            "hostname": socket.gethostname(),
            "os": OS_NAME,
            "platform": f"{sys.platform} {platform.machine().lower()}".strip(),
            "runtime": f"python {sys.version.split()[0]}",
            "uptime": uptime_seconds(),
            "cpuModel": CPU_MODEL,
            "coreCount": os.cpu_count(),
            "cpu": state["cpu"],
            "mem": {"total": total, "free": free},
            "disk": state["disk"],
            "net": dict(state["net"]),
            "history": list(history),
        }


# ---- http --------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] == "/api/stats":
            body = json.dumps(stats()).encode()
            ctype = "application/json"
        else:
            body = HTML
            ctype = "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # keep stdout clean
        pass


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 80))  # no packet is actually sent
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


if __name__ == "__main__":
    threading.Thread(target=sampler, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"server-monitor -> http://localhost:{PORT}")
    ip = lan_ip()
    if ip:
        print(f"                  http://{ip}:{PORT}")
    server.serve_forever()
