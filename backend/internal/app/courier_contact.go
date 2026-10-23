package app

import (
	"bomish/internal/carrier"
	"bomish/internal/domain"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
)

// Only the assigned courier's public contact is exposed, never the staff ID or carrier response.
func orderCourierContact(ctx context.Context, q querier, orderID string) (*domain.CourierContact, error) {
	var contact domain.CourierContact
	var assigned bool
	err := q.QueryRow(ctx, "SELECT courier_staff_id IS NOT NULL,courier_name,courier_phone FROM order_shipping WHERE order_id=$1", orderID).Scan(&assigned, &contact.Name, &contact.Phone)
	if err != nil {
		return nil, err
	}
	if assigned {
		return &contact, nil
	}
	var raw []byte
	err = q.QueryRow(ctx, "SELECT response FROM shipment_attempts WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", orderID).Scan(&raw)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, nil
	}
	var booking carrier.Booking
	if err = json.Unmarshal(raw, &booking); err != nil {
		return nil, err
	}
	if booking.DriverName == "" && booking.DriverPhone == "" {
		return nil, nil
	}
	contact.Name, contact.Phone = booking.DriverName, domain.Phone(booking.DriverPhone)
	return &contact, nil
}
