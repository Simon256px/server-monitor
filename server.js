// server-monitor — zero-dependency system monitor
// Serves a dashboard on http://localhost:3000 and live stats on /api/stats
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const HISTORY_SIZE = 120; // 2 minutes of 1s samples

// ---- CPU sampling (usage = 1 - idle delta / total delta) ----
function cpuTimes() {
  return os.cpus().map((c) => ({
    idle: c.times.idle,
    total: c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq,
  }));
}

let last = cpuTimes();
let cores = last.map(() => 0);
let cpu = 0;
const history = [];

setInterval(() => {
  const now = cpuTimes();
  cores = now.map((c, i) => {
    const idle = c.idle - last[i].idle;
    const total = c.total - last[i].total;
    return total > 0 ? Math.round((1 - idle / total) * 100) : 0;
  });
  cpu = Math.round(cores.reduce((a, b) => a + b, 0) / cores.length);
  last = now;
  history.push({
    t: Date.now(),
    cpu,
    mem: Math.round((1 - os.freemem() / os.totalmem()) * 100),
    peak: Math.max(...cores),
  });
  if (history.length > HISTORY_SIZE) history.shift();
}, 1000);

function stats() {
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.arch()}`,
    node: process.version,
    uptime: Math.round(os.uptime()),
    cpuModel: os.cpus()[0].model.trim(),
    cpu,
    cores,
    mem: { total: os.totalmem(), free: os.freemem() },
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
  .listen(PORT, () => console.log(`server-monitor → http://localhost:${PORT}`));
