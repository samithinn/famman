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
