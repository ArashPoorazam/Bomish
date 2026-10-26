//go:build !linux

package app

func monitorSystem() (*cpuCounters, *systemMemory) { return nil, nil }
