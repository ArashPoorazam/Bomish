package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"sort"
	"strings"
)

// Only integration settings belong in the file. Merchant settings stay in the UI.
type shippingTechnical struct {
	Mode           string            `json:"mode"`
	Localities     []locality        `json:"localities"`
	Snapp          providerConfig    `json:"snapp"`
	Tapin          providerConfig    `json:"tapin"`
	PackagingGrams int64             `json:"packagingGrams"`
	Rules          []shippingRule    `json:"rules"`
	PostalBoxSizes map[string]string `json:"postalBoxSizes"`
}

// Use stable stock-box IDs, not mutable names or supplier dimensions.
func postalBoxSizes(c calculatedConfig) map[string]string {
	sizes := make(map[string]string, len(c.Boxes))
	for _, box := range c.Boxes {
		sizes[box.ID] = box.PostalSizeID
	}
	return sizes
}

func applyPostalBoxSizes(c *calculatedConfig, sizes map[string]string) error {
	known := postalBoxSizes(*c)
	for id, size := range sizes {
		if _, ok := known[id]; !ok {
			return fmt.Errorf("postalBoxSizes: unknown stocked box %q; save the carton in the interface first", id)
		}
		if len(size) > 200 || strings.TrimSpace(size) != size {
			return fmt.Errorf("postalBoxSizes: invalid provider size for box %q", id)
		}
	}
	for i := range c.Boxes {
		if size, ok := sizes[c.Boxes[i].ID]; ok {
			c.Boxes[i].PostalSizeID = size
		}
	}
	return nil
}

func readShippingTechnical(ctx context.Context, q querier, c calculatedConfig) (shippingTechnical, error) {
	v := shippingTechnical{Mode: c.Mode, Localities: c.Localities, Snapp: c.Snapp, Tapin: c.Tapin, Rules: []shippingRule{}, PostalBoxSizes: postalBoxSizes(c)}
	if err := q.QueryRow(ctx, "SELECT packaging_grams FROM settings WHERE id=true").Scan(&v.PackagingGrams); err != nil {
		return v, err
	}
	rows, err := q.Query(ctx, "SELECT province,max_grams,fee_rials FROM shipping_rules ORDER BY province COLLATE \"C\",max_grams")
	if err != nil {
		return v, err
	}
	defer rows.Close()
	for rows.Next() {
		var r shippingRule
		if err = rows.Scan(&r.Province, &r.MaxGrams, &r.FeeRials); err != nil {
			return v, err
		}
		v.Rules = append(v.Rules, r)
	}
	return v, rows.Err()
}

func mergeShippingFile(raw []byte, previous shippingTechnical) (shippingTechnical, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return previous, err
	}
	if fields == nil {
		return previous, errors.New("shipping config must be a JSON object")
	}
	for name, value := range fields {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return previous, fmt.Errorf("%s must not be null", name)
		}
	}
	// Clone slices so a failed parse cannot mutate the saved configuration.
	base, _ := json.Marshal(previous)
	var next shippingTechnical
	if err := json.Unmarshal(base, &next); err != nil {
		return next, err
	}
	// Arrays replace their lists; do not let encoding/json reuse old entries.
	if _, ok := fields["localities"]; ok {
		next.Localities = nil
	}
	if _, ok := fields["rules"]; ok {
		next.Rules = nil
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&next); err != nil {
		return next, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return next, errors.New("expected a single JSON object")
	}
	for i := range next.Rules {
		next.Rules[i].ID = ""
	}
	sort.Slice(next.Rules, func(i, j int) bool {
		if next.Rules[i].Province == next.Rules[j].Province {
			return next.Rules[i].MaxGrams < next.Rules[j].MaxGrams
		}
		return next.Rules[i].Province < next.Rules[j].Province
	})
	return next, nil
}

func validateShippingTariffs(v shippingTechnical) error {
	if v.PackagingGrams < 0 || v.PackagingGrams > 10000 || len(v.Rules) > 500 {
		return errors.New("invalid packaging weight or tariff count")
	}
	seen := map[string]bool{}
	for _, r := range v.Rules {
		key := fmt.Sprintf("%s/%d", r.Province, r.MaxGrams)
		if seen[key] || r.Province == "" || r.MaxGrams < 1 || r.MaxGrams > 10000000 || r.FeeRials < 0 || r.FeeRials > 10000000000 {
			return errors.New("invalid or duplicate shipping tariff")
		}
		seen[key] = true
	}
	return nil
}

// ExportShippingConfig produces an editable snapshot without secrets or merchant settings.
func (a *App) ExportShippingConfig(ctx context.Context, w io.Writer) error {
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	c, err := readShippingConfig(ctx, tx, true)
	if err != nil {
		return err
	}
	v, err := readShippingTechnical(ctx, tx, c)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// ApplyShippingConfig atomically imports file settings and invalidates old quotes
// only when values change. Omitted fields retain the existing store setup.
func (a *App) ApplyShippingConfig(ctx context.Context, path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read shipping config: %w", err)
	}
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var c calculatedConfig
	var saved []byte
	var version int64
	if err = tx.QueryRow(ctx, "SELECT version,content FROM shipping_configuration WHERE id=true FOR UPDATE").Scan(&version, &saved); err != nil {
		return err
	}
	if err = json.Unmarshal(saved, &c); err != nil {
		return err
	}
	previous, err := readShippingTechnical(ctx, tx, c)
	if err != nil {
		return err
	}
	next, err := mergeShippingFile(raw, previous)
	if err != nil {
		return fmt.Errorf("parse shipping config: %w", err)
	}
	if reflect.DeepEqual(previous, next) {
		return nil
	}
	c.Mode, c.Localities, c.Snapp, c.Tapin = next.Mode, next.Localities, next.Snapp, next.Tapin
	if err = applyPostalBoxSizes(&c, next.PostalBoxSizes); err != nil {
		return err
	}
	if err = validateConfig(c); err != nil {
		return err
	}
	if err = validateShippingTariffs(next); err != nil {
		return err
	}
	if c.Mode == "calculated" {
		blockers, e := a.activationBlockers(ctx, tx, c)
		if e != nil {
			return e
		}
		if len(blockers) > 0 {
			return fmt.Errorf("shipping activation blocked: %v", blockers)
		}
	}
	c.Version = version + 1
	content, err := json.Marshal(c)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO shipping_configuration_history(version,content) VALUES($1,$2)", c.Version, content); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE shipping_configuration SET version=$1,content=$2,updated_at=now() WHERE id=true", c.Version, content); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE settings SET packaging_grams=$1 WHERE id=true", next.PackagingGrams); err != nil {
		return err
	}
	if !reflect.DeepEqual(previous.Rules, next.Rules) {
		if _, err = tx.Exec(ctx, "DELETE FROM shipping_rules"); err != nil {
			return err
		}
		for _, r := range next.Rules {
			if _, err = tx.Exec(ctx, "INSERT INTO shipping_rules(id,province,max_grams,fee_rials) VALUES($1,$2,$3,$4)", token(), r.Province, r.MaxGrams, r.FeeRials); err != nil {
				return err
			}
		}
	}
	detail, _ := json.Marshal(map[string]any{"configVersion": c.Version, "technical": next})
	if _, err = tx.Exec(ctx, "INSERT INTO audit_events(action,entity_id,detail) VALUES('shipping.config_file','settings',$1)", detail); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
