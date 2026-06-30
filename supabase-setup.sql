-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Profiles table: maps each Google account to Husband or Wife
CREATE TABLE IF NOT EXISTS profiles (
  id   UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('Husband', 'Wife'))
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles readable by authenticated"
  ON profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "users insert own profile"
  ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "users update own profile"
  ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- 2. Insert your family members
--    Replace the UUIDs below with the real ones from:
--    Supabase Dashboard -> Authentication -> Users -> copy the "User UID" column
INSERT INTO profiles (id, role)
SELECT '83b0afeb-b0f9-4e99-a3aa-fbd63c59e2ab', 'Husband'
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = '83b0afeb-b0f9-4e99-a3aa-fbd63c59e2ab');

INSERT INTO profiles (id, role)
SELECT 'YOUR-WIFE-UUID-HERE', 'Wife'
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'YOUR-WIFE-UUID-HERE');

-- 3. Transactions RLS — update & delete own rows only
--    (Skip if these policies already exist)
CREATE POLICY "users update own transactions"
  ON transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users delete own transactions"
  ON transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
