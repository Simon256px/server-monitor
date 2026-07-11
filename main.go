// server-monitor — compiled variant: one static binary, ~5 MB RAM.
//
//	go build -ldflags "-s -w" -o dist/server-monitor .
//
// Same API and dashboard as server.py; the HTML is embedded in the binary.
package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"
)

//go:embed public/index.html
var html []byte

const historySize = 120 // 2 minutes of 1s samples

type coreTime struct{ idle, total uint64 }

type sample struct {
	T   int64 `json:"t"`
	CPU int   `json:"cpu"`
	Mem int   `json:"mem"`
	Rxs int64 `json:"rxs"`
	Txs int64 `json:"txs"`
}

type netState struct {
	Rx  int64 `json:"rx"`
	Tx  int64 `json:"tx"`
	Rxs int64 `json:"rxs"`
	Txs int64 `json:"txs"`
}

type sizePair struct {
	Total uint64 `json:"total"`
	Free  uint64 `json:"free"`
}

var (
	mu      sync.Mutex
	cpuPct  int
	netCur  netState
	diskCur sizePair
	history []sample
)

func sampler() {
	last := cpuTimes()
	var prevT time.Time
	var prevRx, prevTx int64
	tick := 0
	for range time.Tick(time.Second) {
		tick++

		now := cpuTimes()
		usage, n := 0.0, 0
		for i := range now {
			if i >= len(last) {
				break
			}
			total := float64(now[i].total - last[i].total)
			if total > 0 {
				usage += 1 - float64(now[i].idle-last[i].idle)/total
				n++
			}
		}
		cpu := 0
		if n > 0 {
			cpu = int(usage/float64(n)*100 + 0.5)
		}
		last = now

		if tick%2 == 0 {
			if rx, tx, ok := readNet(); ok {
				t := time.Now()
				mu.Lock()
				if !prevT.IsZero() {
					dt := t.Sub(prevT).Seconds()
					netCur.Rxs = max64(0, int64(float64(rx-prevRx)/dt))
					netCur.Txs = max64(0, int64(float64(tx-prevTx)/dt))
				}
				netCur.Rx, netCur.Tx = rx, tx
				mu.Unlock()
				prevT, prevRx, prevTx = t, rx, tx
			}
		}

		if tick%15 == 1 {
			if total, free, ok := diskUsage(); ok {
				mu.Lock()
				diskCur = sizePair{total, free}
				mu.Unlock()
			}
		}

		memPct := 0
		if total, free := memInfo(); total > 0 {
			memPct = int((1-float64(free)/float64(total))*100 + 0.5)
		}
		mu.Lock()
		cpuPct = cpu
		history = append(history, sample{time.Now().UnixMilli(), cpu, memPct, netCur.Rxs, netCur.Txs})
		if len(history) > historySize {
			history = history[len(history)-historySize:]
		}
		mu.Unlock()
	}
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func stats() map[string]any {
	hostname, _ := os.Hostname()
	total, free := memInfo()
	mu.Lock()
	defer mu.Unlock()
	return map[string]any{
		"hostname":  hostname,
		"os":        osName(),
		"platform":  runtime.GOOS + " " + runtime.GOARCH,
		"runtime":   strings.Replace(runtime.Version(), "go", "go ", 1),
		"uptime":    uptimeSeconds(),
		"cpuModel":  cpuModel(),
		"coreCount": runtime.NumCPU(),
		"cpu":       cpuPct,
		"mem":       sizePair{total, free},
		"disk":      diskCur,
		"net":       netCur,
		"history":   append([]sample(nil), history...),
	}
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	host := os.Getenv("HOST") // empty = all interfaces

	go sampler()

	http.HandleFunc("/api/stats", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(stats())
	})
	http.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(html)
	})

	fmt.Printf("server-monitor -> http://localhost:%s\n", port)
	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, a := range addrs {
			if ip, ok := a.(*net.IPNet); ok && ip.IP.To4() != nil && !ip.IP.IsLoopback() {
				fmt.Printf("                  http://%s:%s\n", ip.IP, port)
			}
		}
	}
	if err := http.ListenAndServe(host+":"+port, nil); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
