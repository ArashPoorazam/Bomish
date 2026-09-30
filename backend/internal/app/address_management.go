package app

import (
	"bomish/internal/domain"
	"net/http"
)

func (a *App) updateAddress(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	var in domain.Address
	if !decode(w, r, &in) {
		return
	}
	in.ID = r.PathValue("id")
	in.Phone = domain.Phone(in.Phone)
	in.PostalCode = domain.Normalize(in.PostalCode)
	if e := in.Validate(); e != nil {
		fail(w, 400, e.Error())
		return
	}
	result, e := a.Pool.Exec(r.Context(), `UPDATE addresses SET recipient=$3,phone=$4,province=$5,city=$6,street=$7,postal_code=$8,latitude=$9,longitude=$10 WHERE id=$1 AND user_id=$2`, in.ID, current(r).UserID, in.Recipient, in.Phone, in.Province, in.City, in.Street, in.PostalCode, in.Latitude, in.Longitude)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if result.RowsAffected() == 0 {
		fail(w, 404, "نشانی پیدا نشد")
		return
	}
	write(w, 200, in)
}
func (a *App) deleteAddress(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	result, e := a.Pool.Exec(r.Context(), "DELETE FROM addresses WHERE id=$1 AND user_id=$2", r.PathValue("id"), current(r).UserID)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if result.RowsAffected() == 0 {
		fail(w, 404, "نشانی پیدا نشد")
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
