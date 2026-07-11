// server-monitor — single-binary system monitor built with Deno
//   deno task dev            → run from source
//   deno task compile:linux  → standalone Linux binary (no runtime needed on the server)
import os from "node:os";
import { statfs } from "node:fs/promises";

const PORT = Number(Deno.env.get("PORT") ?? 3000);
const HOST = Deno.env.get("HOST") ?? "0.0.0.0"; // all interfaces — reachable via the server's IP
const HISTORY_SIZE = 120; // 2 minutes of 1s samples

const isLinux = Deno.build.os === "linux";
const isWindows = Deno.build.os === "windows";

// embedded at compile time via --include (works from source too)
const HTML = await Deno.readTextFile(`${import.meta.dirname}/public/index.html`);

// friendly OS name (kernel string otherwise)
let osName = `${Deno.build.os} ${Deno.osRelease()}`;
try {
  osName = os.version();
} catch { /* keep fallback */ }
if (isWindows) {
  const m = osName.match(/^10\.0\.(\d+)$/); // deno's os.version() returns the bare build number
  if (m) osName = `Windows ${+m[1] >= 22000 ? "11" : "10"} (build ${m[1]})`;
}
if (isLinux) {
  try {
    const m = (await Deno.readTextFile("/etc/os-release")).match(/^PRETTY_NAME="?([^"\n]+?)"?$/m);
    if (m) osName = m[1];
  } catch { /* keep kernel string */ }
}

// ---- CPU sampling (usage = 1 - idle delta / total delta) ----
type CoreTimes = { idle: number; total: number };

async function cpuTimes(): Promise<CoreTimes[]> {
  if (isLinux) {
    // per-core lines of /proc/stat: cpuN user nice system idle iowait irq softirq steal
    const txt = await Deno.readTextFile("/proc/stat");
    const out: CoreTimes[] = [];
    for (const line of txt.split("\n")) {
      if (!/^cpu\d/.test(line)) continue;
      const v = line.trim().split(/\s+/).slice(1).map(Number);
      out.push({ idle: v[3] + (v[4] ?? 0), total: v.reduce((a, b) => a + b, 0) });
    }
    return out;
  }
  return os.cpus().map((c) => ({
    idle: c.times.idle,
    total: c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq,
  }));
}

let last = await cpuTimes();
let cpu = 0;

// ---- network: cumulative bytes since boot + current speed (B/s) ----
const net = { rx: 0, tx: 0, rxs: 0, txs: 0 };
let prevNet: { t: number; rx: number; tx: number } | null = null;

async function readNet(): Promise<{ rx: number; tx: number } | null> {
  try {
    if (isLinux) {
      const txt = await Deno.readTextFile("/proc/net/dev");
      let rx = 0, tx = 0;
      for (const line of txt.split("\n").slice(2)) {
        const p = line.trim().split(/\s+/);
        if (p.length < 10 || p[0].startsWith("lo")) continue;
        rx += +p[1];
        tx += +p[9];
      }
      return { rx, tx };
    }
    if (isWindows) {
      // first `netstat -e` line ending in two integers = bytes rx/tx (locale-proof)
      const { stdout } = await new Deno.Command("netstat", { args: ["-e"] }).output();
      for (const line of new TextDecoder().decode(stdout).split("\n")) {
        const m = line.trim().match(/(\d+)\s+(\d+)$/);
        if (m) return { rx: +m[1], tx: +m[2] };
      }
      return null;
    }
    if (Deno.build.os === "darwin") {
      const { stdout } = await new Deno.Command("netstat", { args: ["-ib"] }).output();
      let rx = 0, tx = 0;
      for (const line of new TextDecoder().decode(stdout).split("\n")) {
        const p = line.trim().split(/\s+/);
        if (p.length < 10 || !p[2]?.startsWith("<Link") || p[0].startsWith("lo")) continue;
        rx += +p[6];
        tx += +p[9];
      }
      return { rx, tx };
    }
  } catch { /* counters stay at 0 */ }
  return null;
}

async function sampleNet() {
  const n = await readNet();
  if (!n) return;
  const t = Date.now();
  if (prevNet) {
    const dt = (t - prevNet.t) / 1000;
    net.rxs = Math.max(0, Math.round((n.rx - prevNet.rx) / dt));
    net.txs = Math.max(0, Math.round((n.tx - prevNet.tx) / dt));
  }
  net.rx = n.rx;
  net.tx = n.tx;
  prevNet = { t, rx: n.rx, tx: n.tx };
}
sampleNet();
setInterval(sampleNet, 2000);

// ---- disk (volume of the current drive / root) ----
let disk = { total: 0, free: 0 };
const ROOT = isWindows ? Deno.cwd().slice(0, 3) : "/";

async function readDisk() {
  try {
    const s = await statfs(ROOT);
    disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
    return;
  } catch { /* fall through */ }
  if (!isWindows) {
    try {
      const { stdout } = await new Deno.Command("df", { args: ["-kP", "/"] }).output();
      const p = new TextDecoder().decode(stdout).trim().split("\n").at(-1)!.split(/\s+/);
      disk = { total: +p[1] * 1024, free: +p[3] * 1024 };
    } catch { /* DISK tile stays empty */ }
  }
}
readDisk();
setInterval(readDisk, 15000);

// ---- 1s sampler → ring buffer ----
const history: { t: number; cpu: number; mem: number; rxs: number; txs: number }[] = [];

setInterval(async () => {
  const now = await cpuTimes();
  const usage = now.map((c, i) => {
    const idle = c.idle - last[i].idle;
    const total = c.total - last[i].total;
    return total > 0 ? 1 - idle / total : 0;
  });
  cpu = Math.round((usage.reduce((a, b) => a + b, 0) / usage.length) * 100);
  last = now;
  history.push({
    t: Date.now(),
    cpu,
    mem: Math.round((1 - os.freemem() / os.totalmem()) * 100),
    rxs: net.rxs,
    txs: net.txs,
  });
  if (history.length > HISTORY_SIZE) history.shift();
}, 1000);

let cpuModel = "";
try {
  cpuModel = os.cpus()[0]?.model.split("\0")[0].trim() ?? ""; // deno pads with NULs on windows
} catch { /* tile shows core count only */ }

function stats() {
  return {
    hostname: Deno.hostname(),
    os: osName,
    platform: `${Deno.build.os} ${Deno.build.arch}`,
    runtime: `deno ${Deno.version.deno}`,
    uptime: Math.round(Deno.osUptime()),
    cpuModel,
    coreCount: navigator.hardwareConcurrency,
    cpu,
    mem: { total: os.totalmem(), free: os.freemem() },
    disk,
    net,
    history,
  };
}

Deno.serve({
  port: PORT,
  hostname: HOST,
  onListen: ({ port }) => {
    console.log(`server-monitor → http://localhost:${port}`);
    try {
      for (const i of Deno.networkInterfaces()) {
        if (i.family === "IPv4" && !i.address.startsWith("127.")) {
          console.log(`                 http://${i.address}:${port}`);
        }
      }
    } catch { /* interface list is cosmetic */ }
  },
}, (req) => {
  if (new URL(req.url).pathname === "/api/stats") {
    return new Response(JSON.stringify(stats()), {
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
});
