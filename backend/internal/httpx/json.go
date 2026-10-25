package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"
)

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func Error(w http.ResponseWriter, status int, msg string) {
	JSON(w, status, map[string]string{"error": msg})
}

func Decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		Error(w, 400, "اطلاعات ارسالی معتبر نیست")
		return false
	}
	// A single JSON value is the entire request, including the body limit.
	// Reject concatenated documents and trailing garbage instead of ignoring them.
	if err := d.Decode(new(any)); err != io.EOF {
		Error(w, 400, "اطلاعات ارسالی معتبر نیست")
		return false
	}
	return true
}

func DatabaseError(w http.ResponseWriter, e error) {
	// PostgreSQL error messages can contain input values. Log only the SQLSTATE.
	code := "unavailable"
	if pgErr, ok := errors.AsType[*pgconn.PgError](e); ok {
		code = pgErr.Code
	}
	slog.Error("database operation failed", "sqlstate", code)
	Error(w, 500, "ذخیره یا دریافت اطلاعات انجام نشد")
}
