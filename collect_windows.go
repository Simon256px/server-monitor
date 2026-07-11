//go:build windows

// Dev-machine fallbacks so the dashboard can be tested on Windows.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"syscall"
	"unsafe"
)

var (
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	ntdll             = syscall.NewLazyDLL("ntdll.dll")
	pGetSystemTimes   = kernel32.NewProc("GetSystemTimes")
	pGlobalMemStatus  = kernel32.NewProc("GlobalMemoryStatusEx")
	pGetTickCount64   = kernel32.NewProc("GetTickCount64")
	pGetDiskFreeSpace = kernel32.NewProc("GetDiskFreeSpaceExW")
	pRtlGetVersion    = ntdll.NewProc("RtlGetVersion")
)

// one global entry: kernel time includes idle time
func cpuTimes() []coreTime {
	var idle, kern, user uint64
	r, _, _ := pGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idle)), uintptr(unsafe.Pointer(&kern)), uintptr(unsafe.Pointer(&user)))
	if r == 0 {
		return nil
	}
	return []coreTime{{idle, kern + user}}
}

type memStatusEx struct {
	length, memoryLoad                    uint32
	totalPhys, availPhys, totalPage       uint64
	availPage, totalVirt, availVirt, ext  uint64
}

func memInfo() (uint64, uint64) {
	st := memStatusEx{length: uint32(unsafe.Sizeof(memStatusEx{}))}
	if r, _, _ := pGlobalMemStatus.Call(uintptr(unsafe.Pointer(&st))); r == 0 {
		return 0, 0
	}
	return st.totalPhys, st.availPhys
}

// first `netstat -e` line ending in two integers = bytes rx/tx (locale-proof)
func readNet() (int64, int64, bool) {
	out, err := exec.Command("netstat", "-e").Output()
	if err != nil {
		return 0, 0, false
	}
	re := regexp.MustCompile(`(\d+)\s+(\d+)\s*$`)
	for _, line := range regexp.MustCompile(`\r?\n`).Split(string(out), -1) {
		if m := re.FindStringSubmatch(line); m != nil {
			rx, _ := strconv.ParseInt(m[1], 10, 64)
			tx, _ := strconv.ParseInt(m[2], 10, 64)
			return rx, tx, true
		}
	}
	return 0, 0, false
}

func uptimeSeconds() int64 {
	ms, _, _ := pGetTickCount64.Call()
	return int64(ms) / 1000
}

type osVersionInfo struct {
	size, major, minor, build, platformID uint32
	csd                                   [128]uint16
}

func osName() string {
	vi := osVersionInfo{size: uint32(unsafe.Sizeof(osVersionInfo{}))}
	if r, _, _ := pRtlGetVersion.Call(uintptr(unsafe.Pointer(&vi))); r == 0 {
		name := "10"
		if vi.build >= 22000 {
			name = "11"
		}
		return fmt.Sprintf("Windows %s (build %d)", name, vi.build)
	}
	return "windows"
}

func cpuModel() string {
	return os.Getenv("PROCESSOR_IDENTIFIER")
}

func diskUsage() (uint64, uint64, bool) {
	root, _ := syscall.UTF16PtrFromString("C:\\")
	var avail, total, totalFree uint64
	r, _, _ := pGetDiskFreeSpace.Call(uintptr(unsafe.Pointer(root)),
		uintptr(unsafe.Pointer(&avail)), uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&totalFree)))
	if r == 0 {
		return 0, 0, false
	}
	return total, avail, true
}
