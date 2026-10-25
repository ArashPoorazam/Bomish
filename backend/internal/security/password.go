package security

import (
	"crypto/pbkdf2"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
)

func PasswordHash(password string) string {
	salt := Token()
	key, _ := pbkdf2.Key(sha256.New, password, []byte(salt), 600000, 32)
	return salt + ":" + hex.EncodeToString(key)
}

func CheckPassword(stored, password string) bool {
	salt, digest, ok := strings.Cut(stored, ":")
	if !ok || len(salt) != 64 || len(digest) != 64 {
		return false
	}
	key, e := pbkdf2.Key(sha256.New, password, []byte(salt), 600000, 32)
	return e == nil && subtle.ConstantTimeCompare([]byte(hex.EncodeToString(key)), []byte(digest)) == 1
}
