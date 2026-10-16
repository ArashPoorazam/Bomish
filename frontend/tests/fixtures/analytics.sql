-- Apply once to a fresh, disposable SEED_DEMO database only.
-- Run analytics-redesign.spec.ts with ANALYTICS_FIXTURE=1 and BASE_URL pointing to that database-backed app.
INSERT INTO users(id,phone) SELECT 'analytics-customer-'||n,'0912'||lpad(n::text,7,'0') FROM generate_series(1,40) n;
INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at,paid_at,discount_rials)
SELECT 'analytics-order-'||n,'analytics-customer-'||(1+n%40),'analytics-key-'||n,'paid',jsonb_build_object('recipient','مشتری نمونه '||(1+n%40)),(1+n%6)*150000,50000,(1+n%6)*150000+50000,now(),now()-(n%30)*interval '1 day',0 FROM generate_series(1,240) n;
WITH products_numbered AS (SELECT id,name,row_number() OVER(ORDER BY id) rn FROM products WHERE status='published')
INSERT INTO order_items(order_id,product_id,name,grams,price_rials,total_rials,package_id,package_label,quantity)
SELECT 'analytics-order-'||n,p.id,p.name,200,150000,(1+n%6)*150000,'analytics-pack','۲۰۰ گرم',1+n%6 FROM generate_series(1,240) n JOIN products_numbered p ON p.rn=1+n%30;
WITH products_numbered AS (SELECT id,row_number() OVER(ORDER BY id) rn FROM products WHERE status='published')
INSERT INTO analytics_events(kind,product_id,session_hash,created_at)
SELECT CASE WHEN n%3=0 THEN 'click' ELSE 'view' END,p.id,'analytics-session-'||n,now()-(n%30)*interval '1 day' FROM generate_series(1,1800) n JOIN products_numbered p ON p.rn=1+n%30;
INSERT INTO analytics_events(kind,query,session_hash,created_at) SELECT 'search',(ARRAY['چای سبز','زردچوبه','فلفل سیاه','دارچین','چای, سبز','زعفران','نعناع','هل','زنجبیل','ادویه پلویی'])[1+n%10],'analytics-search-'||n,now()-(n%30)*interval '1 day' FROM generate_series(1,300) n;
INSERT INTO price_history(product_id,package_id,package_label,new_rials,new_discount,old_rials,old_discount,created_at)
SELECT p.id,x->>'id',(x->>'amount')||' '||(x->>'unit'),(x->>'priceRials')::bigint,10,(x->>'priceRials')::bigint,0,now()-interval '10 days' FROM products p CROSS JOIN LATERAL jsonb_array_elements(p.content->'packages') x WHERE p.status='published';
