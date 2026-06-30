import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type Transaction = {
  id: string;
  created_at: string;
  date: string;
  amount: number;
  category: string;
  note: string;
  spender: "Husband" | "Wife";
  user_id: string;
};
