//go:build !linux && !windows

// Stubs so the binary still builds and serves the dashboard on other platforms.
package main

import "runtime"

func cpuTimes() []coreTime            { return nil }
func memInfo() (uint64, uint64)       { return 0, 0 }
func readNet() (int64, int64, bool)   { return 0, 0, false }
func uptimeSeconds() int64            { return 0 }
func osName() string                  { return runtime.GOOS }
func cpuModel() string                { return "" }
func diskUsage() (uint64, uint64, bool) { return 0, 0, false }
