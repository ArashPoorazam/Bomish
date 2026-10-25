//go:build !linux

package app

func monitorDisk(string) *diskStatus { return nil }
