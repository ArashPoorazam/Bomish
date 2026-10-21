package app

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
)

func auditJSON(ctx context.Context, detail any) ([]byte, error) {
	b, err := json.Marshal(detail)
	if err != nil {
		return nil, err
	}
	if requestID, ok := ctx.Value(requestIDKey{}).(string); ok {
		var fields map[string]any
		if json.Unmarshal(b, &fields) == nil && fields != nil {
			fields["requestId"] = requestID
			return json.Marshal(fields)
		}
	}
	return b, nil
}
func auditDetail(ctx context.Context, tx pgx.Tx, actor, action, id string, detail any) error {
	b, e := auditJSON(ctx, detail)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "INSERT INTO audit_events(staff_id,action,entity_id,detail) VALUES(nullif($1,''),$2,$3,$4)", actor, action, id, b)
	return e
}
func (a *App) logEvent(ctx context.Context, actor, action, id string, detail any) {
	b, _ := auditJSON(ctx, detail)
	_, _ = a.Pool.Exec(ctx, "INSERT INTO audit_events(staff_id,action,entity_id,detail) VALUES(nullif($1,''),$2,$3,$4)", actor, action, id, b)
}
