// server-monitor — zero-dependency system monitor
// Serves a dashboard on http://localhost:3000 and live stats on /api/stats
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // all interfaces — reachable via the server's IP
const HISTORY_SIZE = 120; // 2 minutes of 1s samples

// friendly OS name (on linux, os.version() is a kernel string)
let osName = os.version();
if (process.platform === 'linux') {
  try {
    const m = fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+?)"?$/m);
    if (m) osName = m[1];
  } catch {}
}

// ---- CPU sampling (usage = 1 - idle delta / total delta) ----
function cpuTimes() {
  return os.cpus().map((c) => ({
    idle: c.times.idle,
    total: c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq,
  }));
}

let last = cpuTimes();
let cpu = 0;

// ---- network: cumulative bytes since boot + current speed (B/s) ----
// win32: `netstat -e` (first line ending in two integers = bytes rx/tx, locale-proof)
// linux: /proc/net/dev — darwin: `netstat -ib`
const net = { rx: 0, tx: 0, rxs: 0, txs: 0 };
let prevNet = null;

function readNet(cb) {
  if (process.platform === 'win32') {
    execFile('netstat', ['-e'], (err, out) => {
      if (err) return cb(null);
      for (const line of out.split('\n')) {
        const m = line.trim().match(/(\d+)\s+(\d+)$/);
        if (m) return cb({ rx: +m[1], tx: +m[2] });
      }
      cb(null);
    });
  } else if (process.platform === 'linux') {
    fs.readFile('/proc/net/dev', 'utf8', (err, txt) => {
      if (err) return cb(null);
      let rx = 0, tx = 0;
      for (const line of txt.split('\n').slice(2)) {
        const p = line.trim().split(/\s+/);
        if (p.length < 10 || p[0].startsWith('lo')) continue;
        rx += +p[1];
        tx += +p[9];
      }
      cb({ rx, tx });
    });
  } else if (process.platform === 'darwin') {
    execFile('netstat', ['-ib'], (err, out) => {
      if (err) return cb(null);
      let rx = 0, tx = 0;
      for (const line of out.split('\n')) {
        const p = line.trim().split(/\s+/);
        if (p.length < 10 || !p[2].startsWith('<Link') || p[0].startsWith('lo')) continue;
        rx += +p[6];
        tx += +p[9];
      }
      cb({ rx, tx });
    });
  } else cb(null);
}

function sampleNet() {
  readNet((n) => {
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
  });
}
sampleNet();
setInterval(sampleNet, 2000);

// ---- disk (volume of the current drive / root) ----
let disk = { total: 0, free: 0 };
const ROOT = process.platform === 'win32' ? path.parse(__dirname).root : '/';

function readDisk() {
  fs.statfs(ROOT, (err, s) => {
    if (!err) disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  });
}
if (fs.statfs) {
  readDisk();
  setInterval(readDisk, 15000);
} else {
  console.warn(`node ${process.version}: fs.statfs unavailable (needs >= 18.15) — DISK tile will stay empty`);
}

// ---- 1s sampler → ring buffer ----
const history = [];

setInterval(() => {
  const now = cpuTimes();
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

function stats() {
  return {
    hostname: os.hostname(),
    os: osName,
    platform: `${os.platform()} ${os.arch()}`,
    node: process.version,
    uptime: Math.round(os.uptime()),
    cpuModel: os.cpus()[0].model.trim(),
    coreCount: os.cpus().length,
    cpu,
    mem: { total: os.totalmem(), free: os.freemem() },
    disk,
    net,
    history,
  };
}

http
  .createServer((req, res) => {
    if (req.url === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(stats()));
    }
    fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, html) => {
      if (err) {
        res.writeHead(500);
        return res.end('dashboard not found');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  })
  .listen(PORT, HOST, () => {
    console.log(`server-monitor → http://localhost:${PORT}`);
    for (const ifaces of Object.values(os.networkInterfaces()))
      for (const i of ifaces)
        if (i.family === 'IPv4' && !i.internal) console.log(`                 http://${i.address}:${PORT}`);
  });
