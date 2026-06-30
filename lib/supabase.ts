import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type Profile = {
  id: string;
  full_name: string | null;
  dob: string | null;
  photo_url: string | null;
  monthly_budget: number | null;
  updated_at: string;
};

export type Category = {
  id: string;
  name: string;
  user_id: string;
};

export type Transaction = {
  id: string;
  created_at: string;
  date: string;
  amount: number;
  category: string;
  note: string;
  spender: string;
  user_id: string;
};
