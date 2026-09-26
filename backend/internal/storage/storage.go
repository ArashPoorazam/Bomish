package storage

import (
	"context"
	"os"
	"path/filepath"
)

// Store is the upload boundary. S3 deployments implement Put with the same public /uploads/ URL contract.
type Store interface {
	Put(context.Context, string, []byte, string) (string, error)
}
type Local struct{ Root string }

func (l Local) Put(_ context.Context, key string, data []byte, _ string) (string, error) {
	if e := os.MkdirAll(l.Root, 0700); e != nil {
		return "", e
	}
	if e := os.WriteFile(filepath.Join(l.Root, filepath.Base(key)), data, 0600); e != nil {
		return "", e
	}
	return "/uploads/" + filepath.Base(key), nil
}
