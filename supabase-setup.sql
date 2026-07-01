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

-- ------------------------------------------------------------
-- Profiles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  dob date,
  photo_url text,
  monthly_budget numeric DEFAULT 0,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  line_user_id text UNIQUE,
  line_link_token text UNIQUE,
  line_link_token_expires_at timestamptz,
  line_last_response text,
  line_pending_action text,
  line_pending_data jsonb,
  line_last_transaction_id bigint,
  updated_at timestamptz DEFAULT now()
);

-- transactions.id is bigint, not uuid — this column was originally created
-- as uuid, which made every write to it fail silently (LINE edit/delete
-- could never find a "last transaction"). Fixes existing installs; no-op
-- on a fresh CREATE TABLE above since there's nothing to convert yet.
ALTER TABLE profiles ALTER COLUMN line_last_transaction_id TYPE bigint USING NULL;

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
  ('Food & Dining', 'expense'), ('Groceries', 'expense'), ('Transportation', 'expense'), ('Utilities', 'expense'),
  ('Healthcare', 'expense'), ('Entertainment', 'expense'), ('Shopping', 'expense'), ('Education', 'expense'), ('Travel', 'expense'), ('Other', 'expense'),
  ('Salary', 'income'), ('Teach', 'income'), ('Bonus', 'income')
) AS v(name, type)
WHERE NOT EXISTS (
  SELECT 1 FROM categories c WHERE c.user_id = u.id AND c.name = v.name
);

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

-- Seed witty income replies for Salary / Teach / Bonus categories (skips rows that already exist)
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

INSERT INTO bot_settings (key, value) VALUES ('help_message',
'📖 คำสั่งที่ใช้ได้ทั้งหมด
━━━━━━━━━━━━━
💸 บันทึกรายจ่าย:
[จำนวน] [รายการ] (เช่น 20 ข้าว)

✏️ แก้ไขรายการล่าสุด:
edit (บอทจะถามว่าต้องการแก้ไขเป็นอะไร)

🗑️ ลบรายการล่าสุด:
delete หรือ ลบ

📂 ดูหมวดหมู่ทั้งหมด:
cats (แสดงรายชื่อหมวดหมู่)

📂 เพิ่มหมวดหมู่ใหม่:
cat (บอทจะถามว่าต้องการเพิ่มหมวดอะไร)

🔖 เพิ่มกฎผ่านแชท:
rule chat: [keyword] = [category]

🧾 เพิ่มกฎผ่านสลิป:
rule slip: [keyword] = [category]

📊 ดูสรุปเดือนนี้:
summary หรือ สรุป
━━━━━━━━━━━━━
❓ พิมพ์ help หรือ ช่วยด้วย เพื่อดูคำสั่งนี้อีกครั้ง')
ON CONFLICT (key) DO NOTHING;
