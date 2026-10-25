package security

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

func TestTOTPStoredCiphertextCompatibility(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	secret := "JBSWY3DPEHPK3PXP"
	block, _ := aes.NewCipher(key)
	oldGCM, _ := cipher.NewGCM(block)
	nonce := bytes.Repeat([]byte{3}, oldGCM.NonceSize())
	legacy := "v1:" + hex.EncodeToString(oldGCM.Seal(nonce, nonce, []byte(secret), []byte("bomish-owner-totp-v1")))
	encrypted, err := SealTOTP(key, secret)
	if err != nil {
		t.Fatal(err)
	}
	for _, stored := range []string{legacy, encrypted} {
		got, err := OpenTOTP(key, false, stored)
		if err != nil || got != secret {
			t.Fatalf("decrypt: %q, %v", got, err)
		}
		if _, err := OpenTOTP(bytes.Repeat([]byte{8}, 32), false, stored); err == nil {
			t.Fatal("wrong key accepted")
		}
	}
	// Existing binaries can still read newly written secrets during rollback.
	raw, _ := hex.DecodeString(strings.TrimPrefix(encrypted, "v1:"))
	plain, err := oldGCM.Open(nil, raw[:oldGCM.NonceSize()], raw[oldGCM.NonceSize():], []byte("bomish-owner-totp-v1"))
	if err != nil || string(plain) != secret {
		t.Fatal("legacy reader incompatible", err)
	}
	for _, invalid := range []string{secret, "v1:", "v1:xyz", encrypted[:len(encrypted)-2]} {
		if _, err := OpenTOTP(key, false, invalid); err == nil {
			t.Fatalf("accepted %q", invalid)
		}
	}
	if got, err := OpenTOTP(nil, true, secret); err != nil || got != secret {
		t.Fatal("development secret", err)
	}
	if _, err := SealTOTP(key[:16], secret); err == nil {
		t.Fatal("short key accepted")
	}
}

func TestTOTPWindowAndReplay(t *testing.T) {
	// RFC 6238 SHA-1 vector at Unix 59, truncated to the existing six digits.
	secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	if got := TOTP(secret, 1); got != "287082" {
		t.Fatal(got)
	}
	now := time.Unix(600, 0)
	for _, step := range []int64{19, 20, 21} {
		if got := ValidTOTPStep(secret, TOTP(secret, step), 0, now); got != step {
			t.Fatal(got, step)
		}
		if got := ValidTOTPStep(secret, TOTP(secret, step), step, now); got != 0 {
			t.Fatal("replay accepted")
		}
	}
	if ValidTOTPStep(secret, TOTP(secret, 18), 0, now) != 0 {
		t.Fatal("expired code accepted")
	}
}

func TestPasswordStorage(t *testing.T) {
	stored := PasswordHash("a-long-private-password")
	if !CheckPassword(stored, "a-long-private-password") || CheckPassword(stored, "wrong") {
		t.Fatal("password verification")
	}
	for _, invalid := range []string{"", "salt:hash", stored + ":extra"} {
		if CheckPassword(invalid, "a-long-private-password") {
			t.Fatal("invalid password record accepted")
		}
	}
}
