package app

import (
	"net/http"

	"bomish/internal/domain"
	"bomish/internal/httpx"
	"bomish/internal/security"
)

func (a *App) addresses(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	rows, e := a.Pool.Query(r.Context(), "SELECT id,recipient,phone,province,city,street,postal_code,latitude,longitude,province_id,city_id,pin_confirmed FROM addresses WHERE user_id=$1", current(r).UserID)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer rows.Close()
	out := []domain.Address{}
	for rows.Next() {
		var v domain.Address
		if e = rows.Scan(&v.ID, &v.Recipient, &v.Phone, &v.Province, &v.City, &v.Street, &v.PostalCode, &v.Latitude, &v.Longitude, &v.ProvinceID, &v.CityID, &v.PinConfirmed); e != nil {
			httpx.DatabaseError(w, e)
			return
		}
		out = append(out, v)
	}
	httpx.JSON(w, 200, out)
}

func (a *App) saveAddress(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	var in domain.Address
	if !httpx.Decode(w, r, &in) {
		return
	}
	in.Phone = domain.Phone(in.Phone)
	in.PostalCode = domain.Normalize(in.PostalCode)
	if e := in.Validate(); e != nil {
		httpx.Error(w, 400, e.Error())
		return
	}
	in.ID = security.Token()
	_, e := a.Pool.Exec(r.Context(), "INSERT INTO addresses(id,user_id,recipient,phone,province,city,street,postal_code,latitude,longitude,province_id,city_id,pin_confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", in.ID, current(r).UserID, in.Recipient, in.Phone, in.Province, in.City, in.Street, in.PostalCode, in.Latitude, in.Longitude, in.ProvinceID, in.CityID, in.PinConfirmed)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 201, in)
}
