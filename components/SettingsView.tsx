"use client";

import { useState, useEffect } from "react";
import { Loader2, Pencil, Trash2, Check, X, Plus, Shield, User } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Category = { id: string; name: string };
type Role = "admin" | "user";
type UserEntry = { id: string; email: string; full_name: string; role: Role };

export default function SettingsView() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<Role>("user");

  // Budget
  const [budget, setBudget] = useState("");
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetSaved, setBudgetSaved] = useState(false);

  // Categories
  const [categories, setCategories] = useState<Category[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [newCatName, setNewCatName] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [catError, setCatError] = useState("");

  // Admin: user management
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [usersError, setUsersError] = useState("");

  useEffect(() => {
    fetchProfile();
    fetchCategories();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCurrentUserId(user.id);
    const { data } = await supabase
      .from("profiles")
      .select("monthly_budget, role")
      .eq("id", user.id)
      .single();
    if (data?.monthly_budget) setBudget(String(data.monthly_budget));
    const role = (data?.role ?? "user") as Role;
    setUserRole(role);
    if (role === "admin") fetchUsers();
  }

  async function fetchUsers() {
    setUsersLoading(true);
    setUsersError("");
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      const body = await res.json();
      setUsersError(body.error ?? "Failed to load users.");
      setUsersLoading(false);
      return;
    }
    const { users: list } = await res.json();
    setUsers(list);
    setUsersLoading(false);
  }

  async function changeRole(userId: string, role: Role) {
    setChangingRole(userId);
    setUsersError("");
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    if (!res.ok) {
      const body = await res.json();
      setUsersError(body.error ?? "Failed to update role.");
    } else {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
    }
    setChangingRole(null);
  }

  async function saveBudget() {
    const amount = parseFloat(budget);
    if (isNaN(amount) || amount < 0) return;
    setBudgetLoading(true);
    setBudgetSaved(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBudgetLoading(false); return; }
    await supabase.from("profiles").upsert({ id: user.id, monthly_budget: amount });
    setBudgetLoading(false);
    setBudgetSaved(true);
    setTimeout(() => setBudgetSaved(false), 2000);
  }

  async function fetchCategories() {
    setCatLoading(true);
    const { data } = await supabase.from("categories").select("id, name").order("name");
    setCategories((data as Category[]) ?? []);
    setCatLoading(false);
  }

  async function addCategory() {
    const name = newCatName.trim();
    if (!name) return;
    setAddingCat(true);
    setCatError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setAddingCat(false); return; }
    const { data, error: err } = await supabase
      .from("categories")
      .insert({ name, user_id: user.id })
      .select("id, name")
      .single();
    if (err) { setCatError(err.message); setAddingCat(false); return; }
    setCategories(prev =>
      [...prev, data as Category].sort((a, b) => a.name.localeCompare(b.name))
    );
    setNewCatName("");
    setAddingCat(false);
  }

  async function saveEdit(id: string) {
    const name = editName.trim();
    if (!name) return;
    setCatError("");
    const { error: err } = await supabase.from("categories").update({ name }).eq("id", id);
    if (err) { setCatError(err.message); return; }
    setCategories(prev =>
      prev.map(c => c.id === id ? { ...c, name } : c)
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setEditingId(null);
    setEditName("");
  }

  async function deleteCategory(id: string) {
    setDeletingId(id);
    setCatError("");
    const { error: err } = await supabase.from("categories").delete().eq("id", id);
    if (err) { setCatError(err.message); setDeletingId(null); return; }
    setCategories(prev => prev.filter(c => c.id !== id));
    setDeletingId(null);
  }

  const roleBadge = (role: Role) => (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-extrabold"
      style={
        role === "admin"
          ? { background: "linear-gradient(135deg, #ec4899, #8b5cf6)", color: "#fff" }
          : { background: "#f3e8ff", color: "#7c3aed" }
      }
    >
      {role === "admin" ? <Shield size={10} /> : <User size={10} />}
      {role}
    </span>
  );

  return (
    <div className="flex flex-col h-full">
      <div
        className="sticky top-0 z-10 bg-white px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid #f3e8ff" }}
      >
        <h1 className="text-lg font-black" style={{ color: "#1f2937" }}>Settings ⚙️</h1>
        {roleBadge(userRole)}
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Admin: User Management */}
        {userRole === "admin" && (
          <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <h2 className="text-sm font-black mb-1" style={{ color: "#1f2937" }}>User Management</h2>
            <p className="text-xs font-semibold mb-4" style={{ color: "#9ca3af" }}>
              Manage roles for all accounts
            </p>

            {usersError && (
              <p
                className="text-xs font-semibold px-3 py-2 rounded-xl mb-3"
                style={{ background: "#fef2f2", color: "#ef4444" }}
              >
                {usersError}
              </p>
            )}

            {usersLoading ? (
              <div className="flex items-center justify-center py-6">
                <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
              </div>
            ) : (
              <div className="space-y-2">
                {users.map(u => (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 rounded-xl px-3 py-3"
                    style={{ background: "#fafafa", border: "1px solid #f3e8ff" }}
                  >
                    {/* Avatar placeholder */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold flex-shrink-0 text-white"
                      style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)" }}
                    >
                      {(u.full_name?.[0] ?? u.email?.[0] ?? "?").toUpperCase()}
                    </div>

                    {/* Name + email */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-extrabold truncate" style={{ color: "#374151" }}>
                        {u.full_name}
                        {u.id === currentUserId && (
                          <span className="ml-1.5 text-xs font-bold" style={{ color: "#9ca3af" }}>(you)</span>
                        )}
                      </p>
                      <p className="text-xs font-semibold truncate" style={{ color: "#9ca3af" }}>
                        {u.email}
                      </p>
                    </div>

                    {/* Role selector */}
                    {u.id === currentUserId ? (
                      roleBadge(u.role as Role)
                    ) : (
                      <div className="relative flex-shrink-0">
                        {changingRole === u.id ? (
                          <Loader2 size={14} className="animate-spin" style={{ color: "#a78bfa" }} />
                        ) : (
                          <select
                            value={u.role}
                            onChange={e => changeRole(u.id, e.target.value as Role)}
                            className="text-xs font-extrabold rounded-lg px-2 py-1 cursor-pointer outline-none appearance-none pr-5"
                            style={{
                              border: "2px solid #f3e8ff",
                              color: u.role === "admin" ? "#7c3aed" : "#6b7280",
                              fontFamily: "Nunito",
                              background: u.role === "admin" ? "#faf5ff" : "#f9fafb",
                            }}
                          >
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Monthly Budget */}
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <h2 className="text-sm font-black mb-1" style={{ color: "#1f2937" }}>Monthly Budget</h2>
          <p className="text-xs font-semibold mb-4" style={{ color: "#9ca3af" }}>
            Set your monthly spending limit
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span
                className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-extrabold"
                style={{ color: "#9ca3af" }}
              >
                ฿
              </span>
              <input
                type="number"
                min="0"
                step="100"
                placeholder="35000"
                value={budget}
                onChange={e => setBudget(e.target.value)}
                onKeyDown={e => e.key === "Enter" && saveBudget()}
                className="w-full rounded-xl pl-7 pr-3 py-2.5 text-sm font-semibold outline-none"
                style={{ border: "2px solid #f3e8ff", color: "#374151" }}
              />
            </div>
            <button
              onClick={saveBudget}
              disabled={budgetLoading}
              className="px-5 py-2.5 rounded-xl text-sm font-extrabold text-white flex items-center gap-2 transition-all"
              style={{
                background: budgetSaved
                  ? "linear-gradient(135deg, #10b981, #059669)"
                  : "linear-gradient(135deg, #ec4899, #8b5cf6)",
                boxShadow: "0 3px 12px rgba(236,72,153,0.3)",
                opacity: budgetLoading ? 0.7 : 1,
              }}
            >
              {budgetLoading
                ? <Loader2 size={14} className="animate-spin" />
                : budgetSaved ? "Saved ✓" : "Save"
              }
            </button>
          </div>
        </div>

        {/* Expense Categories */}
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <h2 className="text-sm font-black mb-1" style={{ color: "#1f2937" }}>Expense Categories</h2>
          <p className="text-xs font-semibold mb-4" style={{ color: "#9ca3af" }}>
            Customize your expense categories
          </p>

          {/* Add new */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder="New category name…"
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addCategory()}
              className="flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
              style={{ border: "2px solid #f3e8ff", color: "#374151" }}
            />
            <button
              onClick={addCategory}
              disabled={addingCat || !newCatName.trim()}
              className="px-4 py-2.5 rounded-xl text-sm font-extrabold text-white flex items-center gap-1.5"
              style={{
                background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                opacity: addingCat || !newCatName.trim() ? 0.5 : 1,
              }}
            >
              {addingCat
                ? <Loader2 size={14} className="animate-spin" />
                : <><Plus size={14} /> Add</>
              }
            </button>
          </div>

          {catError && (
            <p
              className="text-xs font-semibold px-3 py-2 rounded-xl mb-3"
              style={{ background: "#fef2f2", color: "#ef4444" }}
            >
              {catError}
            </p>
          )}

          {catLoading ? (
            <div className="flex items-center justify-center py-6">
              <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
            </div>
          ) : categories.length === 0 ? (
            <p className="text-xs font-semibold text-center py-4" style={{ color: "#9ca3af" }}>
              No categories yet. Add one above.
            </p>
          ) : (
            <div className="space-y-2">
              {categories.map(cat => (
                <div
                  key={cat.id}
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                  style={{ background: "#fafafa", border: "1px solid #f3e8ff" }}
                >
                  {editingId === cat.id ? (
                    <>
                      <input
                        autoFocus
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") saveEdit(cat.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="flex-1 text-sm font-semibold bg-transparent outline-none"
                        style={{ color: "#374151" }}
                      />
                      <button onClick={() => saveEdit(cat.id)} className="p-1 rounded-lg" style={{ color: "#10b981" }}>
                        <Check size={14} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-1 rounded-lg" style={{ color: "#9ca3af" }}>
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-semibold" style={{ color: "#374151" }}>
                        {cat.name}
                      </span>
                      <button
                        onClick={() => { setEditingId(cat.id); setEditName(cat.name); setCatError(""); }}
                        className="p-1 rounded-lg"
                        style={{ color: "#7c3aed" }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => deleteCategory(cat.id)}
                        disabled={deletingId === cat.id}
                        className="p-1 rounded-lg"
                        style={{ color: "#ef4444" }}
                      >
                        {deletingId === cat.id
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Trash2 size={13} />
                        }
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sign out */}
        <div className="pb-4">
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/login";
            }}
            className="w-full px-6 py-2.5 rounded-xl text-sm font-extrabold"
            style={{ background: "#fef2f2", color: "#ef4444", border: "2px solid #fecaca" }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
