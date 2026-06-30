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

ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own category rules" ON category_rules;
CREATE POLICY "users manage own category rules"
  ON category_rules FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
