package carrier

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"
)

// SnappContract is supplied only after the merchant's current B2B wire schema is
// verified. In particular, old SDK routes, currency, cancellation rules and auth
// must not be guessed from the pricing example. Tests supply a fixture contract.
// The production application deliberately does not install an unverified contract.
type SnappContract interface {
	Encode(operation string, request Request, reference string) (method, path string, payload any, err error)
	DecodeQuote(json.RawMessage) (Quote, error)
	DecodeBooking(json.RawMessage) (Booking, error)
	Authenticate(*http.Request)
}
type Snapp struct {
	Client   *http.Client
	BaseURL  string
	Contract SnappContract
}

func (s Snapp) call(ctx context.Context, op string, in Request, reference string) (json.RawMessage, error) {
	if s.Contract == nil || s.Client == nil {
		return nil, ErrUnavailable
	}
	method, path, payload, e := s.Contract.Encode(op, in, reference)
	if e != nil {
		return nil, e
	}
	base, e := url.Parse(s.BaseURL)
	if e != nil || base.Host == "" || base.User != nil {
		return nil, ErrUnavailable
	}
	relative, e := url.Parse(path)
	if e != nil || relative.IsAbs() || relative.Host != "" {
		return nil, ErrUnavailable
	}
	target := base.ResolveReference(relative)
	raw, e := json.Marshal(payload)
	if e != nil {
		return nil, ErrUnavailable
	}
	req, e := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewReader(raw))
	if e != nil {
		return nil, ErrUnavailable
	}
	req.Header.Set("Content-Type", "application/json")
	s.Contract.Authenticate(req)
	// Never follow a redirect with credentials or retry a side-effecting request.
	client := *s.Client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if client.Timeout == 0 {
		client.Timeout = 12 * time.Second
	}
	res, e := client.Do(req)
	if e != nil {
		return nil, ErrUnknown
	}
	defer res.Body.Close()
	body, e := io.ReadAll(io.LimitReader(res.Body, (1<<20)+1))
	if e != nil || len(body) > 1<<20 || res.StatusCode < 200 || res.StatusCode >= 300 || !json.Valid(body) {
		return nil, ErrUnavailable
	}
	return body, nil
}
func (s Snapp) Quote(ctx context.Context, in Request) (Quote, error) {
	raw, e := s.call(ctx, "quote", in, "")
	if e != nil {
		return Quote{}, e
	}
	v, e := s.Contract.DecodeQuote(raw)
	if e != nil || v.CostRials < 0 || v.CostRials > 100000000000 {
		return Quote{}, ErrUnavailable
	}
	return v, nil
}
func (s Snapp) Create(ctx context.Context, in Request) (Booking, error) {
	raw, e := s.call(ctx, "create", in, in.Reference)
	if e != nil {
		return Booking{}, ErrUnknown
	}
	return s.booking(raw, in.Reference)
}
func (s Snapp) Lookup(ctx context.Context, ref string) (Booking, error) {
	raw, e := s.call(ctx, "lookup", Request{}, ref)
	if e != nil {
		return Booking{}, ErrUnknown
	}
	return s.booking(raw, ref)
}
func (s Snapp) Cancel(ctx context.Context, ref string) (Booking, error) {
	raw, e := s.call(ctx, "cancel", Request{}, ref)
	if e != nil {
		return Booking{}, ErrUnknown
	}
	return s.booking(raw, ref)
}
func (s Snapp) booking(raw json.RawMessage, ref string) (Booking, error) {
	v, e := s.Contract.DecodeBooking(raw)
	if e != nil || v.ID == "" || v.Reference != ref || (v.CostRials != nil && (*v.CostRials < 0 || *v.CostRials > 100000000000)) {
		return Booking{}, ErrUnknown
	}
	return v, nil
}
