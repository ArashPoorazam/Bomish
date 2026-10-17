package app

import (
	"bomish/internal/domain"
	"bomish/internal/packing"
	"context"
	"errors"
	"testing"
)

func TestShippingWithoutSetupDoesNotUseTariffs(t *testing.T) {
	// No database or carrier is needed: incomplete setup must stop before either.
	a := &App{}
	_, err := a.calculateShipping(context.Background(), domain.Cart{}, shippingQuoteInput{}, calculatedConfig{}, "customer")
	var failure *packing.Failure
	if !errors.As(err, &failure) || failure.Code != "shipping_not_configured" {
		t.Fatalf("expected clear setup error, got %v", err)
	}
}
