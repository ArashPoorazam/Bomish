package app

import "syscall"

// Reports the filesystem containing local uploads, never a guessed host disk.
func monitorDisk(path string) *diskStatus {
	var stat syscall.Statfs_t
	if syscall.Statfs(path, &stat) != nil || stat.Blocks == 0 || stat.Bsize <= 0 {
		return nil
	}
	return &diskStatus{TotalBytes: stat.Blocks * uint64(stat.Bsize), AvailableBytes: stat.Bavail * uint64(stat.Bsize)}
}
