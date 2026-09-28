package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"github.com/jackc/pgx/v5"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

func (a *App) createExport(w http.ResponseWriter, r *http.Request) {
	var params map[string]string
	if !decode(w, r, &params) {
		return
	}
	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}
	check := r.Clone(r.Context())
	check.URL = &url.URL{RawQuery: q.Encode()}
	if _, _, _, _, ok := reportQuery(check); !ok {
		fail(w, 400, "گزارش معتبر نیست")
		return
	}
	if !a.limit(r, "export:"+current(r).StaffID, 10, time.Hour) {
		fail(w, 429, "تعداد گزارش‌ها زیاد است؛ کمی بعد تلاش کنید")
		return
	}
	b, _ := json.Marshal(params)
	id := token()
	_, e := a.Pool.Exec(r.Context(), "INSERT INTO report_exports(id,owner_id,params) VALUES($1,$2,$3)", id, current(r).StaffID, b)
	if e != nil {
		a.dbError(w, e)
		return
	}
	a.logEvent(r.Context(), current(r).StaffID, "export.requested", id, params)
	write(w, 202, map[string]string{"id": id})
}
func (a *App) getExport(w http.ResponseWriter, r *http.Request) {
	out, e := queryMaps(r.Context(), a.Pool, `SELECT id,status,progress,error,created_at AS "createdAt" FROM report_exports WHERE id=$1 AND owner_id=$2`, r.PathValue("id"), current(r).StaffID)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if len(out) == 0 {
		fail(w, 404, "گزارش پیدا نشد")
		return
	}
	write(w, 200, out[0])
}
func (a *App) retryExport(w http.ResponseWriter, r *http.Request) {
	tag, e := a.Pool.Exec(r.Context(), "UPDATE report_exports SET status='pending',progress=0,error='',updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='failed'", r.PathValue("id"), current(r).StaffID)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 409, "گزارش قابل تکرار نیست")
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) downloadExport(w http.ResponseWriter, r *http.Request) {
	var content []byte
	e := a.Pool.QueryRow(r.Context(), "SELECT content FROM report_exports WHERE id=$1 AND owner_id=$2 AND status='ready'", r.PathValue("id"), current(r).StaffID).Scan(&content)
	if e != nil {
		fail(w, 404, "گزارش هنوز آماده نیست")
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="omnisire.xlsx"`)
	w.Write(content)
}
func (a *App) ProcessExports(ctx context.Context) error {
	// Claim/recover work with a lease. A bounded timeout is shorter than the lease.
	var id, owner string
	var raw []byte
	e := a.Pool.QueryRow(ctx, `UPDATE report_exports SET status='running',attempts=attempts+1,updated_at=now() WHERE id=(SELECT id FROM report_exports WHERE status='pending' OR (status='running' AND updated_at<now()-interval '10 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,owner_id,params`).Scan(&id, &owner, &raw)
	if e == pgx.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	jobCtx, cancel := context.WithTimeout(ctx, 8*time.Minute)
	defer cancel()
	data, e := a.buildWorkbook(jobCtx, id, raw)
	if e != nil {
		_, err := a.Pool.Exec(ctx, "UPDATE report_exports SET status='failed',error='ساخت گزارش انجام نشد؛ دوباره تلاش کنید',updated_at=now() WHERE id=$1", id)
		return err
	}
	_, e = a.Pool.Exec(ctx, "UPDATE report_exports SET status='ready',content=$2,progress=100,updated_at=now() WHERE id=$1", id, data)
	if e == nil {
		a.logEvent(ctx, owner, "export.ready", id, map[string]string{})
	}
	return e
}
func xmlText(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}
func excelColumn(n int) string {
	s := ""
	for n++; n > 0; n = (n - 1) / 26 {
		s = string(rune('A'+(n-1)%26)) + s
	}
	return s
}
func cell(w io.Writer, row, col int, v any, kind string) {
	ref := excelColumn(col) + strconv.Itoa(row)
	if v == nil {
		fmt.Fprintf(w, `<c r="%s"/>`, ref)
		return
	}
	if kind == "number" || kind == "money" {
		text := fmt.Sprint(v)
		n, e := strconv.ParseFloat(text, 64)
		if e == nil {
			if kind == "money" {
				n /= 10
			}
			fmt.Fprintf(w, `<c r="%s"><v>%s</v></c>`, ref, strconv.FormatFloat(n, 'f', -1, 64))
			return
		}
	}
	if t, ok := v.(time.Time); ok {
		zone, _ := time.LoadLocation("Asia/Tehran")
		v = t.In(zone).Format("2006-01-02 15:04:05")
	}
	fmt.Fprintf(w, `<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, xmlText(fmt.Sprint(v)))
}
func (a *App) buildWorkbook(ctx context.Context, id string, raw []byte) ([]byte, error) {
	var params map[string]string
	if e := json.Unmarshal(raw, &params); e != nil {
		return nil, e
	}
	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}
	r := &http.Request{URL: &url.URL{RawQuery: q.Encode()}}
	spec, sql, args, sort, ok := reportQuery(r)
	if !ok {
		return nil, fmt.Errorf("invalid report")
	}
	tx, e := a.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	var total int64
	if e = tx.QueryRow(ctx, "SELECT count(*) FROM ("+sql+") x", args...).Scan(&total); e != nil {
		return nil, e
	}
	rows, e := tx.Query(ctx, sql+" ORDER BY "+sort, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	files := map[string]string{
		"[Content_Types].xml":        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
		"_rels/.rels":                `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
		"xl/workbook.xml":            `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="گزارش امنیسایر" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
	}
	for name, body := range files {
		f, err := z.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err = io.WriteString(f, body); err != nil {
			return nil, err
		}
	}
	f, e := z.Create("xl/worksheets/sheet1.xml")
	if e != nil {
		return nil, e
	}
	io.WriteString(f, `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"><pane ySplit="3" topLeftCell="A4" state="frozen"/></sheetView></sheetViews><sheetData>`)
	fmt.Fprint(f, `<row r="1">`)
	cell(f, 1, 0, "Omnisire · مبالغ به تومان · زمان تهران", "text")
	fmt.Fprint(f, `</row><row r="2">`)
	cell(f, 2, 0, q.Encode(), "text")
	fmt.Fprint(f, `</row><row r="3">`)
	for i, c := range spec.Columns {
		cell(f, 3, i, c.Label, "text")
	}
	fmt.Fprint(f, `</row>`)
	fields := rows.FieldDescriptions()
	count := 0
	for rows.Next() {
		count++
		if count > 1048573 {
			return nil, fmt.Errorf("report exceeds worksheet capacity; narrow filters")
		}
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		v := map[string]any{}
		for i, field := range fields {
			v[string(field.Name)] = vals[i]
		}
		fmt.Fprintf(f, `<row r="%d">`, count+3)
		for i, c := range spec.Columns {
			cell(f, count+3, i, v[c.Key], c.Kind)
		}
		fmt.Fprint(f, `</row>`)
		if count%1000 == 0 && total > 0 {
			_, _ = a.Pool.Exec(ctx, "UPDATE report_exports SET progress=$2,updated_at=now() WHERE id=$1", id, int64(count)*95/total)
		}
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	io.WriteString(f, `</sheetData></worksheet>`)
	if e = z.Close(); e != nil {
		return nil, e
	}
	return buf.Bytes(), nil
}
