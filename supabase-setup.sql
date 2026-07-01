-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Drop the Husband/Wife constraint on the spender column so usernames can be stored
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_spender_check;

-- 2. Transactions RLS — update & delete own rows only
DROP POLICY IF EXISTS "users update own transactions" ON transactions;
CREATE POLICY "users update own transactions"
  ON transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users delete own transactions" ON transactions;
CREATE POLICY "users delete own transactions"
  ON transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 3. Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  dob date,
  photo_url text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own profile" ON profiles;
CREATE POLICY "users manage own profile"
  ON profiles FOR ALL TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 4. Add monthly_budget to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS monthly_budget numeric DEFAULT 0;

-- 5. Categories table with RLS
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own categories" ON categories;
CREATE POLICY "users manage own categories"
  ON categories FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 7. Add role column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'
  CHECK (role IN ('admin', 'user'));

-- 8. Allow all authenticated users to SELECT all profiles (needed for admin user list)
--    INSERT/UPDATE/DELETE remain restricted to own row via the existing "users manage own profile" policy
DROP POLICY IF EXISTS "authenticated users can read all profiles" ON profiles;
CREATE POLICY "authenticated users can read all profiles"
  ON profiles FOR SELECT TO authenticated
  USING (true);

-- 6. Seed 10 default categories for all existing users
INSERT INTO categories (id, name, user_id)
SELECT gen_random_uuid(), v.name, u.id
FROM auth.users u
CROSS JOIN (VALUES
  ('Food & Dining'), ('Groceries'), ('Transportation'), ('Utilities'),
  ('Healthcare'), ('Entertainment'), ('Shopping'), ('Education'), ('Travel'), ('Other')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM categories c WHERE c.user_id = u.id AND c.name = v.name
);

-- 9. Back-fill old Husband/Wife spender values to the user's actual profile name
UPDATE transactions t
SET spender = COALESCE(
  (SELECT p.full_name FROM profiles p WHERE p.id = t.user_id AND p.full_name IS NOT NULL),
  split_part((SELECT u.email FROM auth.users u WHERE u.id = t.user_id), '@', 1),
  'Unknown'
)
WHERE t.spender IN ('Husband', 'Wife');

-- 10. LINE bot integration columns on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS line_user_id text UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS line_link_token text UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS line_link_token_expires_at timestamptz;

-- 11. Category rules for smart auto-categorization (iOS Shortcut receipt parsing)
CREATE TABLE IF NOT EXISTS category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  category text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 15. category_rules: split by source so OCR receipt parsing (iOS Shortcut)
-- and LINE chat text commands maintain separate rule sets
ALTER TABLE category_rules ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'ocr' CHECK (source_type IN ('ocr', 'chat'));

ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own category rules" ON category_rules;
CREATE POLICY "users manage own category rules"
  ON category_rules FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 12b. Track last LINE response per user to avoid consecutive repeats
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS line_last_response text;

-- 12. Change transactions.date from date to timestamptz to store time of transaction
ALTER TABLE transactions ALTER COLUMN date TYPE timestamptz USING date::timestamptz;

-- 13. line_responses: split bot replies by transaction type (income vs expense)
CREATE TABLE IF NOT EXISTS line_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  response_text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Existing rows were all written for expense replies, so default them to 'expense'
ALTER TABLE line_responses ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'expense'
  CHECK (type IN ('income', 'expense'));

-- Seed witty income replies for Salary / Teach / Bonus categories (skips rows that already exist)
INSERT INTO line_responses (category, response_text, type)
SELECT v.category, v.response_text, v.type
FROM (VALUES
  ('Salary', 'เงินเดือนเข้าแล้ว! เตรียมตัวเสียภาษีให้รัฐอย่างภาคภูมิใจได้เลยจ้าาา', 'income'),
  ('Salary', 'โอ้โห! เงินเดือนออกแล้วครับคุณพี่ เห็นตัวเลขแล้วอยากจะกราบงามๆ 3 ที', 'income'),
  ('Salary', 'ยอดเงินเดือนเข้าบัญชีแล้วนะ รีบใช้ก่อนที่มันจะระเหยหายไปในพริบตา!', 'income'),
  ('Salary', 'เงินเดือนเข้าแล้ว! วันนี้คุณพี่จะเป็นเศรษฐีชั่วคราวซักกี่นาทีดีครับ?', 'income'),
  ('Salary', 'บันทึกรายรับให้แล้วนะ เงินเดือนเข้าเยอะขนาดนี้ มื้อเย็นขอจัดเต็มนะ!', 'income'),
  ('Teach', 'ค่าสอนมาแล้ว! รวยแล้วจ้าาา วันนี้จะซื้ออะไรเปย์ตัวเองดีครับ?', 'income'),
  ('Teach', 'บันทึกรายรับให้แล้วครับ นี่คือค่าตอบแทนจากการปล่อยพลังสอนใช่ไหมเนี่ย สุดยอด!', 'income'),
  ('Teach', 'เงินค่าสอนเข้าบัญชีแล้วครับคุณครู เก่งมาก! เดี๋ยวบอทเก็บเงินไว้ให้ (อย่าเพิ่งเผลอใช้หมดนะ)', 'income'),
  ('Teach', 'รายรับจากการสอนเข้าแล้วนะ ได้เงินจากความรู้เนี่ยมันภูมิใจจริงๆ เลยเนอะ', 'income'),
  ('Teach', 'บวกเลขเพิ่มให้แล้วครับ! เงินค่าสอนเข้าแล้ว ยอดนี้เก็บไว้ยามฉุกเฉินหรือเอาไปช็อปปิ้งดีครับ?', 'income'),
  ('Bonus', 'โบนัสราชการมาแล้ว! โอ้ววววว ความรวยเป็นเหตุสังเกตได้', 'income'),
  ('Bonus', 'บันทึกรายรับโบนัสให้แล้วครับ! อย่าเพิ่งรีบเอาไปละลายหมดนะ เก็บไว้เป็นขวัญถุงบ้าง!', 'income'),
  ('Bonus', 'โบนัสออกแล้วครับท่าน! ยินดีด้วยนะที่ความขยันเข้าตาเบื้องบนซักที!', 'income'),
  ('Bonus', 'ว้าว! โบนัสเข้า บอทกดบันทึกรัวๆ เลยครับ ยอดนี้ขอให้เก็บไว้ใช้ให้มีความสุขนะ', 'income'),
  ('Bonus', 'โบนัสราชการเข้าแล้วจ้า! รวยๆ เฮงๆ แล้วอย่าลืมเลี้ยงกาแฟบอทบ้างนะ 555', 'income')
) AS v(category, response_text, type)
WHERE NOT EXISTS (
  SELECT 1 FROM line_responses lr
  WHERE lr.category = v.category AND lr.response_text = v.response_text
);

-- 14. categories: split expense vs income so the dashboard and transaction
--     forms can filter by transaction type instead of showing one mixed list.
--     Existing categories were all created for expenses, so they backfill as 'expense'.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'expense'
  CHECK (type IN ('income', 'expense'));

-- Seed default income categories for all existing users (matches the income
-- bot-response categories from the LINE personality feature)
INSERT INTO categories (id, name, user_id, type)
SELECT gen_random_uuid(), v.name, u.id, 'income'
FROM auth.users u
CROSS JOIN (VALUES ('Salary'), ('Teach'), ('Bonus')) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM categories c WHERE c.user_id = u.id AND c.name = v.name
);

-- 16. bot_settings: generic key/value store so admins can edit bot copy
--     (starting with the "help" command reply) without a code change.
--     No RLS policies are defined, so only the service-role key (used by
--     the webhook and the /api/admin/bot-settings route) can read/write it.
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

🔖 เพิ่มกฎผ่านแชท:
rule chat: [keyword] = [category]

🧾 เพิ่มกฎผ่านสลิป:
rule slip: [keyword] = [category]

📊 ดูสรุปเดือนนี้:
summary หรือ สรุป
━━━━━━━━━━━━━
❓ พิมพ์ help หรือ ช่วยด้วย เพื่อดูคำสั่งนี้อีกครั้ง')
ON CONFLICT (key) DO NOTHING;
