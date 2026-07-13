-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Reflects the current schema. Safe to re-run (CREATE/ADD use
-- IF NOT EXISTS, policies are dropped and recreated, seeds skip
-- rows that already exist).
-- ============================================================

-- ------------------------------------------------------------
-- Transactions
-- Base table is managed via the Supabase dashboard (not created
-- here). This section only brings its column types and RLS in
-- line with the current app.
-- ------------------------------------------------------------
ALTER TABLE transactions ALTER COLUMN date TYPE timestamptz USING date::timestamptz;

DROP POLICY IF EXISTS "users update own transactions" ON transactions;
CREATE POLICY "users update own transactions"
  ON transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users delete own transactions" ON transactions;
CREATE POLICY "users delete own transactions"
  ON transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Payment Method (added for existing installs; the base table is managed
-- via the dashboard, not created here). Every existing row and any new row
-- that doesn't specify one defaults to 'Cash'. Income transactions are
-- always 'Cash' (enforced app-side — LINE bot and web form both refuse to
-- set 'Credit Card' on an income row).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'Cash';
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_payment_method_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_payment_method_check
  CHECK (payment_method IN ('Cash', 'Credit Card'));

-- ------------------------------------------------------------
-- Profiles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  first_name text,
  last_name text,
  phone text,
  dob date,
  photo_url text,
  photo_offset_x numeric DEFAULT 0,
  photo_offset_y numeric DEFAULT 0,
  theme_preference text DEFAULT 'system' CHECK (theme_preference IN ('system', 'dark', 'light')),
  monthly_budget numeric DEFAULT 0,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  line_user_id text UNIQUE,
  line_link_token text UNIQUE,
  line_link_token_expires_at timestamptz,
  line_last_response text,
  line_pending_action text,
  line_pending_data jsonb,
  line_last_transaction_id bigint,
  line_last_deleted jsonb,
  daily_summary_time text DEFAULT '22:00',
  summary_preferences jsonb DEFAULT '["income", "expense", "category_breakdown", "budget"]'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- transactions.id is bigint, not uuid — this column was originally created
-- as uuid, which made every write to it fail silently (LINE edit/delete
-- could never find a "last transaction"). Fixes existing installs; no-op
-- on a fresh CREATE TABLE above since there's nothing to convert yet.
ALTER TABLE profiles ALTER COLUMN line_last_transaction_id TYPE bigint USING NULL;

-- Customizable daily summary push (added for existing installs; the
-- CREATE TABLE above only applies to a brand-new table).
-- daily_summary_time is "HH:MM" in Asia/Bangkok local time, or NULL to
-- opt out of the push entirely. Default '22:00' matches the old fixed-time
-- push so existing installs keep working after this column is added.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_summary_time text DEFAULT '22:00';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS summary_preferences jsonb
  DEFAULT '["income", "expense", "category_breakdown", "budget"]'::jsonb;

-- Snapshot of the last transaction removed via LINE "delete", so "undo" can
-- restore it (added for existing installs; the CREATE TABLE above only
-- applies to a brand-new table).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS line_last_deleted jsonb;

-- Contact info card on the Profile page (added for existing installs; the
-- CREATE TABLE above only applies to a brand-new table). full_name is left
-- as-is (still the source of truth for spender attribution everywhere else
-- in the app) — first_name/last_name/phone are additional contact fields.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;

-- Avatar positioning for drag-to-adjust (added for existing installs; the
-- CREATE TABLE above only applies to a brand-new table). photo_offset_x and
-- photo_offset_y store the relative position of the image within the circular
-- avatar preview (in pixels, relative to center). Default 0,0 = centered.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS photo_offset_x numeric DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS photo_offset_y numeric DEFAULT 0;

-- Theme preference (added for existing installs; the CREATE TABLE above only
-- applies to a brand-new table). Allows users to select 'system' (follow device
-- preference), 'dark', or 'light' mode. Defaults to 'system'.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS theme_preference text DEFAULT 'system';

-- Backfill: existing rows predate the column default above and would
-- otherwise be NULL (i.e. silently stop receiving the push they already
-- have). Only touches rows that haven't set a value yet.
UPDATE profiles SET daily_summary_time = '22:00' WHERE daily_summary_time IS NULL AND line_user_id IS NOT NULL;
UPDATE profiles SET summary_preferences = '["income", "expense", "category_breakdown", "budget"]'::jsonb
  WHERE summary_preferences IS NULL AND line_user_id IS NOT NULL;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own profile" ON profiles;
CREATE POLICY "users manage own profile"
  ON profiles FOR ALL TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Needed for the admin user list; INSERT/UPDATE/DELETE stay restricted
-- to the user's own row via the policy above.
DROP POLICY IF EXISTS "authenticated users can read all profiles" ON profiles;
CREATE POLICY "authenticated users can read all profiles"
  ON profiles FOR SELECT TO authenticated
  USING (true);

-- ------------------------------------------------------------
-- Categories
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense'))
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own categories" ON categories;
CREATE POLICY "users manage own categories"
  ON categories FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Default categories for any user who doesn't have them yet
-- (income categories have no other seeding path — the app only
-- lazily creates expense defaults on first use).
INSERT INTO categories (id, name, user_id, type)
SELECT gen_random_uuid(), v.name, u.id, v.type
FROM auth.users u
CROSS JOIN (VALUES
  ('food', 'expense'), ('fuel', 'expense'),
  ('healthcare', 'expense'), ('entertainment', 'expense'), ('shopping', 'expense'), ('education', 'expense'), ('other', 'expense'),
  ('invest', 'expense'), ('goods', 'expense'), ('phone', 'expense'), ('epass', 'expense'),
  ('salary', 'income'), ('teach', 'income'), ('bonus', 'income')
) AS v(name, type)
WHERE NOT EXISTS (
  SELECT 1 FROM categories c WHERE c.user_id = u.id AND c.name = v.name
);

-- Merge case-duplicate categories (e.g. "Food" and "food" for the same
-- user + type) into one canonical row before enforcing uniqueness below.
-- Canonical pick: the all-lowercase spelling if one exists in the group,
-- otherwise the lowest id. Re-running this after duplicates are gone is
-- a no-op (the dupes CTEs come back empty).
WITH ranked AS (
  SELECT id, name, user_id, type, lower(name) AS lname,
    first_value(id) OVER w AS canonical_id,
    first_value(name) OVER w AS canonical_name
  FROM categories
  WINDOW w AS (
    PARTITION BY user_id, type, lower(name)
    ORDER BY (name <> lower(name)), id
  )
), dupes AS (
  SELECT * FROM ranked WHERE id <> canonical_id
)
UPDATE transactions t
SET category = d.canonical_name
FROM dupes d
WHERE t.user_id = d.user_id AND lower(t.category) = d.lname;

WITH ranked AS (
  SELECT id, name, user_id, type, lower(name) AS lname,
    first_value(id) OVER w AS canonical_id,
    first_value(name) OVER w AS canonical_name
  FROM categories
  WINDOW w AS (
    PARTITION BY user_id, type, lower(name)
    ORDER BY (name <> lower(name)), id
  )
), dupes AS (
  SELECT * FROM ranked WHERE id <> canonical_id
)
UPDATE category_rules cr
SET category = d.canonical_name
FROM dupes d
WHERE cr.user_id = d.user_id AND lower(cr.category) = d.lname;

-- Drop the now-redundant duplicate category rows, keeping only the
-- canonical (lowercase-preferred, else lowest id) row per group.
DELETE FROM categories c
USING categories c2
WHERE c.user_id = c2.user_id
  AND c.type = c2.type
  AND lower(c.name) = lower(c2.name)
  AND (
    (c.name = lower(c.name)) < (c2.name = lower(c2.name))
    OR (c.name = lower(c.name)) = (c2.name = lower(c2.name)) AND c.id > c2.id
  );

-- Enforce it going forward: one category name per user+type, case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS categories_user_type_lower_name_idx
  ON categories (user_id, type, lower(name));

-- ------------------------------------------------------------
-- Category rules (smart auto-categorization for LINE chat text
-- and OCR receipt parsing — kept as separate rule sets via source_type)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  category text NOT NULL,
  source_type text NOT NULL DEFAULT 'ocr' CHECK (source_type IN ('ocr', 'chat')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own category rules" ON category_rules;
CREATE POLICY "users manage own category rules"
  ON category_rules FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Subscriptions (recurring monthly expenses). Web-only CRUD
-- (Settings UI); the daily cron (chargeSubscriptions() in
-- app/api/cron/line-daily-push/route.ts) auto-inserts a real
-- transactions row once a month on billing_day, clamped to the
-- last day of the month for short months (e.g. day 31 -> Feb 28/29).
-- last_charged_month ('YYYY-MM', Asia/Bangkok) is the idempotency
-- guard so a cron retry/redeploy never double-charges. category is
-- free text, matching the category_rules.category convention (not
-- FK'd to categories.id).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  billing_day int NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
  category text NOT NULL,
  payment_method text NOT NULL DEFAULT 'Cash' CHECK (payment_method IN ('Cash', 'Credit Card')),
  active boolean NOT NULL DEFAULT true,
  last_charged_month text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own subscriptions" ON subscriptions;
CREATE POLICY "users manage own subscriptions"
  ON subscriptions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- LINE bot reply text, split by category and transaction type.
-- No RLS — only ever accessed via the service-role key
-- (the webhook and /api/admin/line-responses route).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS line_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  response_text text NOT NULL,
  type text NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
  created_at timestamptz DEFAULT now()
);

-- Seed witty income replies for salary / teach / bonus categories (skips rows that already exist)
INSERT INTO line_responses (category, response_text, type)
SELECT v.category, v.response_text, v.type
FROM (VALUES
  ('salary', 'เงินเดือนเข้าแล้ว! เตรียมตัวเสียภาษีให้รัฐอย่างภาคภูมิใจได้เลยจ้าาา', 'income'),
  ('salary', 'โอ้โห! เงินเดือนออกแล้วครับคุณพี่ เห็นตัวเลขแล้วอยากจะกราบงามๆ 3 ที', 'income'),
  ('salary', 'ยอดเงินเดือนเข้าบัญชีแล้วนะ รีบใช้ก่อนที่มันจะระเหยหายไปในพริบตา!', 'income'),
  ('salary', 'เงินเดือนเข้าแล้ว! วันนี้คุณพี่จะเป็นเศรษฐีชั่วคราวซักกี่นาทีดีครับ?', 'income'),
  ('salary', 'บันทึกรายรับให้แล้วนะ เงินเดือนเข้าเยอะขนาดนี้ มื้อเย็นขอจัดเต็มนะ!', 'income'),
  ('teach', 'ค่าสอนมาแล้ว! รวยแล้วจ้าาา วันนี้จะซื้ออะไรเปย์ตัวเองดีครับ?', 'income'),
  ('teach', 'บันทึกรายรับให้แล้วครับ นี่คือค่าตอบแทนจากการปล่อยพลังสอนใช่ไหมเนี่ย สุดยอด!', 'income'),
  ('teach', 'เงินค่าสอนเข้าบัญชีแล้วครับคุณครู เก่งมาก! เดี๋ยวบอทเก็บเงินไว้ให้ (อย่าเพิ่งเผลอใช้หมดนะ)', 'income'),
  ('teach', 'รายรับจากการสอนเข้าแล้วนะ ได้เงินจากความรู้เนี่ยมันภูมิใจจริงๆ เลยเนอะ', 'income'),
  ('teach', 'บวกเลขเพิ่มให้แล้วครับ! เงินค่าสอนเข้าแล้ว ยอดนี้เก็บไว้ยามฉุกเฉินหรือเอาไปช็อปปิ้งดีครับ?', 'income'),
  ('bonus', 'โบนัสราชการมาแล้ว! โอ้ววววว ความรวยเป็นเหตุสังเกตได้', 'income'),
  ('bonus', 'บันทึกรายรับโบนัสให้แล้วครับ! อย่าเพิ่งรีบเอาไปละลายหมดนะ เก็บไว้เป็นขวัญถุงบ้าง!', 'income'),
  ('bonus', 'โบนัสออกแล้วครับท่าน! ยินดีด้วยนะที่ความขยันเข้าตาเบื้องบนซักที!', 'income'),
  ('bonus', 'ว้าว! โบนัสเข้า บอทกดบันทึกรัวๆ เลยครับ ยอดนี้ขอให้เก็บไว้ใช้ให้มีความสุขนะ', 'income'),
  ('bonus', 'โบนัสราชการเข้าแล้วจ้า! รวยๆ เฮงๆ แล้วอย่าลืมเลี้ยงกาแฟบอทบ้างนะ 555', 'income')
) AS v(category, response_text, type)
WHERE NOT EXISTS (
  SELECT 1 FROM line_responses lr
  WHERE lr.category = v.category AND lr.response_text = v.response_text
);

-- Seed witty expense replies for invest / goods / phone / epass categories
-- (skips rows that already exist). Amount + category are appended
-- automatically by buildSuccessMessage() in the webhook — response_text
-- here is only the personality line, same convention as the income seed above.
INSERT INTO line_responses (category, response_text, type)
SELECT v.category, v.response_text, v.type
FROM (VALUES
  ('invest', 'นักลงทุนผู้ยิ่งใหญ่... หวังว่ายอดนี้จะไม่พาไปติดดอยนะ! 🥶', 'expense'),
  ('invest', 'ลงทุนวันนี้ เป็นเศรษฐีวันหน้า... หรือเป็นยาจกก็ไม่รู้สินะ! 📉', 'expense'),
  ('invest', 'จัดพอร์ตไปแล้วนะครับ ขอให้กราฟเขียวไปตลอดชาตินะ (ขอร้อง) 📈', 'expense'),
  ('invest', 'เงินเข้าไปอยู่ในตลาดแล้วจ้า เดี๋ยวคืนนี้นอนไม่หลับเช็คกราฟทั้งคืนแน่ๆ 😅', 'expense'),
  ('goods', 'ของมันต้องมี(อีกแล้วหรอ)! ซื้อสบู่มาอาบหรือมาต้มกินเนี่ยยย 🧼', 'expense'),
  ('goods', 'หมดไวจริงๆ ซื้อมาตุนหรือเอาไปถมที่ครับเจ้านาย! 📦', 'expense'),
  ('goods', 'ของใช้จำเป็น(ที่จำเป็นจริงป่ะเนี่ย)หมดอีกแล้ว บ้านนี้ใช้ของกันยังไงเนี่ย 🤔', 'expense'),
  ('goods', 'ซื้ออีกแล้วเหรอ เดี๋ยวบ้านจะกลายเป็นโกดังของใช้นะครับเนี่ย 📦', 'expense'),
  ('phone', 'จ่ายค่าเน็ตแล้ว ก็อย่ามัวแต่ไถ TikTok จนลืมหาเงินเข้าบ้านล่ะ! 💸', 'expense'),
  ('phone', 'ต่อชีวิตให้สมาร์ทโฟนสำเร็จ! ไถฟีดต่อได้เลยวัยรุ่น 📱', 'expense'),
  ('phone', 'จ่ายค่าเน็ตแล้วนะ อย่าลืมว่าโลกจริงก็มีคนให้คุยด้วยเหมือนกัน 😂', 'expense'),
  ('phone', 'ค่าโทรศัพท์หมดไปอีกเดือน คุยกับใครจนบิลบานขนาดนี้เนี่ย 📞', 'expense'),
  ('epass', 'จ่ายค่าทางด่วน เพื่อไปรถติดบนทางด่วนสินะ... ชีวิตคนเมือง! 🚦', 'expense'),
  ('epass', 'Easy Pass ปลิวไปอีกยอด! ซื้อเวลาหรือซื้อความหัวร้อนครับเนี่ย 🏎️', 'expense'),
  ('epass', 'เติมเงินทางด่วนแล้วนะ ขอให้ไม่เจอรถติดจนต้องนั่งมองมิเตอร์เวลาไปเรื่อยๆ 🚗', 'expense'),
  ('epass', 'จ่ายค่า Easy Pass ไปแล้วจ้า วิ่งทางด่วนให้คุ้มๆ อย่าวิ่งไปงีบหลับบนทางด่วนล่ะ 😴', 'expense')
) AS v(category, response_text, type)
WHERE NOT EXISTS (
  SELECT 1 FROM line_responses lr
  WHERE lr.category = v.category AND lr.response_text = v.response_text
);

-- ------------------------------------------------------------
-- Bot copy that admins can edit without a code change (starting
-- with the "help" command reply).
-- No RLS policies — only the service-role key (the webhook and
-- /api/admin/bot-settings route) can read/write it.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bot_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE bot_settings ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- Kanban boards. One user's projects/tasks are never visible to
-- another user — user_id is denormalized onto kanban_tasks (not
-- just kanban_projects) so RLS/ownership checks on a task never
-- need to join back to its parent project.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kanban_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE kanban_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own kanban projects" ON kanban_projects;
CREATE POLICY "users manage own kanban projects"
  ON kanban_projects FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS kanban_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES kanban_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  due_date date,
  priority text NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High', 'Medium', 'Low')),
  status text NOT NULL DEFAULT 'To do' CHECK (status IN ('To do', 'In Progress', 'Done')),
  color text,
  position double precision NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kanban_tasks_project_status_position_idx
  ON kanban_tasks (project_id, status, position);

ALTER TABLE kanban_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own kanban tasks" ON kanban_tasks;
CREATE POLICY "users manage own kanban tasks"
  ON kanban_tasks FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

INSERT INTO bot_settings (key, value) VALUES ('help_message',
'📖 คำสั่งที่ใช้ได้ทั้งหมด
━━━━━━━━━━━━━
💸 บันทึกรายจ่าย:
[จำนวน] [หมวดหมู่/คำค้น] สลับที่กันได้ (เช่น 20 กาแฟ หรือ กาแฟ 20)

✏️ แก้ไขยอด/หมวดหมู่ของรายการล่าสุด:
edit [จำนวน] [หมวดหมู่] สลับที่กันได้ เช่น edit 150 food หรือ edit food 150
หรือพิมพ์ edit เฉยๆ บอทจะถามว่าต้องการแก้ไขเป็นอะไร

📝 เพิ่ม/แก้ไข Note ของรายการล่าสุด:
note [ข้อความ] เช่น note กินข้าวกับเพื่อน

🗑️ ลบรายการล่าสุด (ลบทันที ไม่ถาม):
delete หรือ ลบ
↩️ กู้คืนรายการที่เพิ่งลบ:
undo หรือ กู้คืน

🧾 ดูรายการล่าสุด 5 รายการ:
show หรือ แสดง

📂 ดูหมวดหมู่ทั้งหมด:
cats (แสดงรายชื่อหมวดหมู่)

📂 เพิ่มหมวดหมู่ใหม่:
cat (บอทจะถามว่าต้องการเพิ่มหมวดอะไร)

🔖 เพิ่มกฎผ่านแชท:
rule chat: [keyword] = [category]

🧾 เพิ่มกฎผ่านสลิป:
rule slip: [keyword] = [category]

📊 ดูสรุปวันนี้:
สรุปรายวัน, รายวัน หรือ daily

📊 ดูสรุปเดือนนี้:
สรุปรายเดือน, รายเดือน หรือ monthly

📊 ดูสรุป (เลือกวัน/เดือน):
summary หรือ สรุป
━━━━━━━━━━━━━
❓ พิมพ์ help หรือ ช่วยด้วย เพื่อดูคำสั่งนี้อีกครั้ง')
ON CONFLICT (key) DO NOTHING;
