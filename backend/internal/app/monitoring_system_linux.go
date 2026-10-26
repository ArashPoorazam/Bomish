package app

import (
	"os"
	"strconv"
	"strings"
)

// /proc describes the system visible to the API, not the container's cgroup quota.
func monitorSystem() (*cpuCounters, *systemMemory) {
	stat, _ := os.ReadFile("/proc/stat")
	mem, _ := os.ReadFile("/proc/meminfo")
	return parseCPU(string(stat)), parseMemory(string(mem))
}

func parseCPU(raw string) *cpuCounters {
	line, _, _ := strings.Cut(raw, "\n")
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return nil
	}
	var result cpuCounters
	// guest and guest_nice are already included in user and nice.
	for i := 1; i < len(fields) && i <= 8; i++ {
		value, err := strconv.ParseUint(fields[i], 10, 64)
		if err != nil {
			return nil
		}
		result.total += value
		if i == 4 || i == 5 {
			result.idle += value
		}
	}
	return &result
}

func parseMemory(raw string) *systemMemory {
	values := map[string]uint64{}
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 3 || fields[2] != "kB" {
			continue
		}
		if fields[0] != "MemTotal:" && fields[0] != "MemAvailable:" {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return nil
		}
		values[fields[0]] = value * 1024
	}
	total, available := values["MemTotal:"], values["MemAvailable:"]
	if _, ok := values["MemAvailable:"]; !ok || total == 0 || available > total {
		return nil
	}
	return &systemMemory{TotalBytes: total, AvailableBytes: available}
}
