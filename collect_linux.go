//go:build linux

package main

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"syscall"
)

// per-core lines of /proc/stat: cpuN user nice system idle iowait irq softirq steal
func cpuTimes() []coreTime {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return nil
	}
	var out []coreTime
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "cpu") || len(line) < 4 || line[3] < '0' || line[3] > '9' {
			continue
		}
		var idle, total uint64
		for i, f := range strings.Fields(line)[1:] {
			v, _ := strconv.ParseUint(f, 10, 64)
			total += v
			if i == 3 || i == 4 { // idle + iowait
				idle += v
			}
		}
		out = append(out, coreTime{idle, total})
	}
	return out
}

// (total, free) bytes; free = MemAvailable
func memInfo() (uint64, uint64) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	get := func(key string) uint64 {
		m := regexp.MustCompile(`(?m)^` + key + `:\s+(\d+)`).FindStringSubmatch(string(data))
		if m == nil {
			return 0
		}
		v, _ := strconv.ParseUint(m[1], 10, 64)
		return v * 1024
	}
	total := get("MemTotal")
	free := get("MemAvailable")
	if free == 0 {
		free = get("MemFree")
	}
	return total, free
}

// cumulative bytes since boot, all interfaces except lo
func readNet() (int64, int64, bool) {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return 0, 0, false
	}
	var rx, tx int64
	lines := strings.Split(string(data), "\n")
	if len(lines) < 3 {
		return 0, 0, false
	}
	for _, line := range lines[2:] {
		f := strings.Fields(line)
		if len(f) < 10 || strings.HasPrefix(f[0], "lo") {
			continue
		}
		r, _ := strconv.ParseInt(f[1], 10, 64)
		t, _ := strconv.ParseInt(f[9], 10, 64)
		rx += r
		tx += t
	}
	return rx, tx, true
}

func uptimeSeconds() int64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	v, _ := strconv.ParseFloat(strings.Fields(string(data))[0], 64)
	return int64(v)
}

func osName() string {
	if data, err := os.ReadFile("/etc/os-release"); err == nil {
		if m := regexp.MustCompile(`(?m)^PRETTY_NAME="?([^"\n]+?)"?$`).FindStringSubmatch(string(data)); m != nil {
			return m[1]
		}
	}
	return "linux"
}

func cpuModel() string {
	if data, err := os.ReadFile("/proc/cpuinfo"); err == nil {
		if m := regexp.MustCompile(`(?m)^model name\s*:\s*(.+)$`).FindStringSubmatch(string(data)); m != nil {
			return strings.TrimSpace(m[1])
		}
	}
	return ""
}

func diskUsage() (uint64, uint64, bool) {
	var st syscall.Statfs_t
	if err := syscall.Statfs("/", &st); err != nil {
		return 0, 0, false
	}
	bsize := uint64(st.Bsize)
	return st.Blocks * bsize, st.Bavail * bsize, true
}
