package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

func TOTP(secret string, step int64) string {
	key, e := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if e != nil {
		return ""
	}
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, uint64(step))
	m := hmac.New(sha1.New, key)
	m.Write(b)
	sum := m.Sum(nil)
	off := sum[len(sum)-1] & 15
	v := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", v%1000000)
}

func NewTOTPSecret() string {
	b := make([]byte, 20)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
}

// SealTOTP uses the standard library nonce generator. Its nonce-prefixed output
// preserves the existing v1 ciphertext format, including old stored secrets.
func SealTOTP(key []byte, secret string) (string, error) {
	if len(key) != 32 {
		return "", errors.New("TOTP encryption key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCMWithRandomNonce(block)
	if err != nil {
		return "", err
	}
	return "v1:" + hex.EncodeToString(gcm.Seal(nil, nil, []byte(secret), []byte("bomish-owner-totp-v1"))), nil
}

func OpenTOTP(key []byte, development bool, stored string) (string, error) {
	if !strings.HasPrefix(stored, "v1:") {
		if development {
			return stored, nil
		}
		return "", errors.New("unencrypted owner authenticator")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCMWithRandomNonce(block)
	if err != nil {
		return "", err
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(stored, "v1:"))
	if err != nil || len(raw) < gcm.Overhead() {
		return "", errors.New("invalid authenticator ciphertext")
	}
	plain, err := gcm.Open(nil, nil, raw, []byte("bomish-owner-totp-v1"))
	return string(plain), err
}

func ValidTOTPStep(secret, code string, last int64, now time.Time) int64 {
	if len(code) != 6 || secret == "" {
		return 0
	}
	step := now.Unix() / 30
	for _, candidate := range []int64{step - 1, step, step + 1} {
		if candidate > last && subtle.ConstantTimeCompare([]byte(TOTP(secret, candidate)), []byte(code)) == 1 {
			return candidate
		}
	}
	return 0
}
