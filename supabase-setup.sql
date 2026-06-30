-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Drop the Husband/Wife constraint on the spender column so usernames can be stored
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_spender_check;

-- 2. Transactions RLS — update & delete own rows only
--    (Skip if these policies already exist)
CREATE POLICY "users update own transactions"
  ON transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users delete own transactions"
  ON transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
